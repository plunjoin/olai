package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"olai/internal/httpx"
	"olai/internal/models"
	"olai/internal/secure"
	"olai/internal/settings"
	"olai/internal/store"
	appversion "olai/internal/version"
)

func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	ctx := r.Context()
	now := time.Now()
	today := httpx.DayStart(now)
	weekAgo := now.UnixMilli() - 7*86_400_000
	overview, err := s.DB.Overview(ctx, today, weekAgo)
	if err != nil {
		s.adminFailure(w)
		return
	}
	ledger, err := s.DB.LedgerSince(ctx, now.UnixMilli()-14*86_400_000)
	if err != nil {
		s.adminFailure(w)
		return
	}
	type daily struct{ points, generations int64 }
	byDay := map[string]*daily{}
	for _, entry := range ledger {
		day := httpx.DayKey(time.UnixMilli(entry.CreatedAt))
		bucket := byDay[day]
		if bucket == nil {
			bucket = &daily{}
			byDay[day] = bucket
		}
		if entry.Delta < 0 {
			bucket.points += -entry.Delta
		}
		if entry.Reason == "spend" {
			bucket.generations++
		}
	}
	days := make([]string, 0, 14)
	for index := 13; index >= 0; index-- {
		days = append(days, httpx.DayKey(now.Add(-time.Duration(index)*24*time.Hour)))
	}
	series := make([]any, 0, len(days))
	for _, day := range days {
		bucket := byDay[day]
		if bucket == nil {
			bucket = &daily{}
		}
		series = append(series, map[string]any{"day": day, "points": bucket.points, "generations": bucket.generations})
	}
	recent, err := s.DB.RecentUsers(ctx, 8)
	if err != nil {
		s.adminFailure(w)
		return
	}
	if recent == nil {
		recent = []store.RecentUser{}
	}
	openReports, err := s.DB.CountOpenGalleryReports(ctx)
	if err != nil {
		s.adminFailure(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users": map[string]any{
			"total": overview.UsersTotal, "today": overview.UsersToday, "week": overview.UsersWeek,
		},
		"points": map[string]any{
			"circulating": overview.PointsCirc, "issued": overview.PointsIssued, "spent": overview.PointsSpent,
		},
		"today":   map[string]any{"generations": overview.TodayGenerations, "points": overview.TodayPoints},
		"invites": map[string]any{"total": overview.InvitesTotal, "rewarded": overview.InvitesRewarded},
		"media":   map[string]any{"count": overview.MediaCount, "bytes": overview.MediaBytes},
		"records": overview.RecordCount,
		"reports": map[string]any{"open": openReports},
		"series":  series, "recentUsers": recent,
	})
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	offset := pageParam(r, 20)
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 200 {
		query = string([]rune(query)[:200])
	}
	rows, total, err := s.DB.AdminUsers(r.Context(), query, 20, offset)
	if err != nil {
		s.adminFailure(w)
		return
	}
	users := make([]any, 0, len(rows))
	for _, row := range rows {
		users = append(users, map[string]any{
			"id": row.ID, "email": row.Email, "createdAt": row.CreatedAt, "balance": row.Balance,
			"bannedAt": row.BannedAt, "banReason": row.BanReason,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users": users, "total": total, "nextPage": nextPage(offset, len(rows), total, 20),
	})
}

func (s *Server) handleAdminUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	ctx := r.Context()
	id := r.PathValue("id")
	user, err := s.DB.AdminUser(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "账号不存在。")
		return
	}
	if err != nil {
		s.adminFailure(w)
		return
	}
	ledgerRows, err := s.DB.RecentPoints(ctx, id, 30)
	if err != nil {
		s.adminFailure(w)
		return
	}
	ledger := make([]any, 0, len(ledgerRows))
	for _, row := range ledgerRows {
		ledger = append(ledger, map[string]any{
			"delta": row.Delta, "reason": row.Reason, "refId": row.RefID, "createdAt": row.CreatedAt,
		})
	}
	invites, err := s.DB.AdminInvitesFor(ctx, id, 50)
	if err != nil {
		s.adminFailure(w)
		return
	}
	invitedBy, err := s.DB.AdminInvitedBy(ctx, id)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		s.adminFailure(w)
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		invitedBy = nil
	}
	oauth, err := s.DB.AdminOAuthAccounts(ctx, id)
	if err != nil {
		s.adminFailure(w)
		return
	}
	spendCount, spendPoints, err := s.DB.AdminUserSpend(ctx, id)
	if err != nil {
		s.adminFailure(w)
		return
	}
	mediaCount, mediaBytes, err := s.DB.CountUserMedia(ctx, "user:"+id)
	if err != nil {
		s.adminFailure(w)
		return
	}
	recordCount, err := s.DB.AdminUserRecordCount(ctx, id)
	if err != nil {
		s.adminFailure(w)
		return
	}
	ids := make([]string, 0, len(invites)+1)
	for _, invite := range invites {
		ids = append(ids, invite.InviteeID)
	}
	if invitedBy != nil {
		ids = append(ids, invitedBy.InviterID)
	}
	emails, err := s.DB.EmailsByIDs(ctx, uniqueStrings(ids))
	if err != nil {
		s.adminFailure(w)
		return
	}
	inviteList := make([]any, 0, len(invites))
	for _, invite := range invites {
		inviteList = append(inviteList, map[string]any{
			"inviteeId": invite.InviteeID, "email": emails[invite.InviteeID],
			"code": invite.Code, "createdAt": invite.CreatedAt, "rewardedAt": invite.RewardedAt,
			"rewarded": invite.RewardedAt != nil,
		})
	}
	var banned any
	if user.BannedAt != nil {
		banned = map[string]any{"reason": user.BanReason, "bannedAt": *user.BannedAt}
	}
	var invitedByValue any
	if invitedBy != nil {
		invitedByValue = map[string]any{
			"email": emails[invitedBy.InviterID], "code": invitedBy.Code,
			"createdAt": invitedBy.CreatedAt, "rewardedAt": invitedBy.RewardedAt,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id": user.ID, "email": user.Email, "createdAt": user.CreatedAt,
			"balance": user.Balance, "banned": banned,
		},
		"oauth": oauth,
		"stats": map[string]any{
			"spendCount": spendCount, "spendPoints": spendPoints,
			"mediaCount": mediaCount, "mediaBytes": mediaBytes, "recordCount": recordCount,
		},
		"ledger": ledger, "invites": inviteList, "invitedBy": invitedByValue,
	})
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func (s *Server) handleAdminBan(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "请求内容过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	userID := r.PathValue("id")
	if _, err := s.DB.UserByID(r.Context(), userID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "账号不存在。")
		return
	} else if err != nil {
		s.adminFailure(w)
		return
	}
	banned, _ := input["banned"].(bool)
	if banned {
		reason, _ := input["reason"].(string)
		reason = strings.TrimSpace(reason)
		if reason == "" || utf8.RuneCountInString(reason) > 200 {
			writeError(w, http.StatusBadRequest, "请填写 1–200 字的停用原因。")
			return
		}
		if err := s.DB.BanUser(r.Context(), userID, reason, admin.ID, time.Now().UnixMilli()); err != nil {
			s.adminFailure(w)
			return
		}
		_ = s.logAdmin(r, admin, "user.ban", userID, map[string]any{"reason": reason})
	} else {
		if err := s.DB.UnbanUser(r.Context(), userID); err != nil {
			s.adminFailure(w)
			return
		}
		_ = s.logAdmin(r, admin, "user.unban", userID, map[string]any{})
	}
	writeJSON(w, http.StatusOK, map[string]any{"banned": banned})
}

func (s *Server) handleAdminPoints(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "请求内容过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	delta, ok := safeInt(input["delta"])
	if !ok || delta == 0 || delta > 1_000_000 || delta < -1_000_000 {
		writeError(w, http.StatusBadRequest, "调整数量必须是非零整数。")
		return
	}
	note, _ := input["note"].(string)
	note = strings.TrimSpace(note)
	if note == "" || utf8.RuneCountInString(note) > 200 {
		writeError(w, http.StatusBadRequest, "请填写 1–200 字的调整原因。")
		return
	}
	userID := r.PathValue("id")
	if _, err := s.DB.UserByID(r.Context(), userID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "账号不存在。")
		return
	} else if err != nil {
		s.adminFailure(w)
		return
	}
	ref := "admin:" + admin.ID + ":" + secure.ID()
	balance, err := s.DB.AdjustPoints(r.Context(), userID, delta, ref, note, int64(s.Pricing.SignupBonus()))
	if err != nil {
		s.adminFailure(w)
		return
	}
	if balance == nil {
		writeError(w, http.StatusConflict, "余额不足，不能扣减为负数。")
		return
	}
	_ = s.logAdmin(r, admin, "points.adjust", userID, map[string]any{"delta": delta, "balance": *balance, "note": note})
	writeJSON(w, http.StatusOK, map[string]any{"balance": *balance})
}

func (s *Server) handleAdminGenerations(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	ctx := r.Context()
	offset := pageParam(r, 30)
	spends, total, err := s.DB.AdminSpends(ctx, 30, offset)
	if err != nil {
		s.adminFailure(w)
		return
	}
	_, spendPoints, err := s.DB.AdminSpendSummary(ctx)
	if err != nil {
		s.adminFailure(w)
		return
	}
	records, err := s.DB.AdminRecentRecords(ctx, 30)
	if err != nil {
		s.adminFailure(w)
		return
	}
	recordTotal, err := s.DB.CountRecords(ctx, "assets")
	if err != nil {
		s.adminFailure(w)
		return
	}
	spendList := make([]any, 0, len(spends))
	for _, row := range spends {
		spendList = append(spendList, map[string]any{
			"id": row.ID, "userId": row.UserID, "email": row.Email,
			"delta": row.Delta, "refId": row.RefID, "createdAt": row.CreatedAt,
		})
	}
	recordList := make([]any, 0, len(records))
	for _, row := range records {
		recordList = append(recordList, map[string]any{
			"key": row.Key, "userId": row.UserID, "email": row.Email,
			"recordId": row.RecordID, "updatedAt": row.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"spends":   spendList,
		"totals":   map[string]any{"generations": total, "points": spendPoints, "records": recordTotal},
		"records":  recordList,
		"nextPage": nextPage(offset, len(spends), total, 30),
	})
}

func (s *Server) handleAdminInvites(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	ctx := r.Context()
	offset := pageParam(r, 30)
	rows, err := s.DB.ListInvites(ctx, 30, offset)
	if err != nil {
		s.adminFailure(w)
		return
	}
	total, err := s.DB.CountInvites(ctx)
	if err != nil {
		s.adminFailure(w)
		return
	}
	top, err := s.DB.AdminTopInviters(ctx, 10)
	if err != nil {
		s.adminFailure(w)
		return
	}
	ids := make([]string, 0, len(rows)*2+len(top))
	for _, row := range rows {
		ids = append(ids, row.InviterID, row.InviteeID)
	}
	for _, row := range top {
		ids = append(ids, row.InviterID)
	}
	emails, err := s.DB.EmailsByIDs(ctx, uniqueStrings(ids))
	if err != nil {
		s.adminFailure(w)
		return
	}
	invites := make([]any, 0, len(rows))
	for _, row := range rows {
		invites = append(invites, map[string]any{
			"id": row.ID, "code": row.Code, "createdAt": row.CreatedAt, "rewardedAt": row.RewardedAt,
			"inviterId": row.InviterID, "inviterEmail": emails[row.InviterID],
			"inviteeId": row.InviteeID, "inviteeEmail": emails[row.InviteeID],
		})
	}
	topList := make([]any, 0, len(top))
	for _, row := range top {
		topList = append(topList, map[string]any{
			"inviterId": row.InviterID, "email": emails[row.InviterID],
			"total": row.Total, "rewarded": row.Rewarded,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"invites": invites, "top": topList, "total": total,
		"nextPage": nextPage(offset, len(rows), total, 30),
	})
}

func (s *Server) handleAdminLogs(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	offset := pageParam(r, 40)
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 200 {
		query = string([]rune(query)[:200])
	}
	logs, total, err := s.DB.AdminLogs(r.Context(), query, 40, offset)
	if err != nil {
		s.adminFailure(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"logs": logs, "total": total, "nextPage": nextPage(offset, len(logs), total, 40),
	})
}

func (s *Server) handleAdminMedia(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	ctx := r.Context()
	offset := pageParam(r, 24)
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 200 {
		query = string([]rune(query)[:200])
	}
	rows, total, err := s.DB.AdminMediaPage(ctx, query, 24, offset)
	if err != nil {
		s.adminFailure(w)
		return
	}
	totalBytes, err := s.DB.MediaBytes(ctx)
	if err != nil {
		s.adminFailure(w)
		return
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		if strings.HasPrefix(row.Owner, "user:") {
			ids = append(ids, strings.TrimPrefix(row.Owner, "user:"))
		}
	}
	emails, err := s.DB.EmailsByIDs(ctx, uniqueStrings(ids))
	if err != nil {
		s.adminFailure(w)
		return
	}
	media := make([]any, 0, len(rows))
	for _, row := range rows {
		ownerEmail := ""
		if strings.HasPrefix(row.Owner, "user:") {
			ownerEmail = emails[strings.TrimPrefix(row.Owner, "user:")]
		}
		media = append(media, map[string]any{
			"id": row.ID, "owner": row.Owner, "ownerEmail": ownerEmail,
			"mime": row.Mime, "size": row.Size, "createdAt": row.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"media": media, "total": total, "bytes": totalBytes,
		"nextPage": nextPage(offset, len(rows), total, 24),
	})
}

func (s *Server) handleAdminMediaDelete(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	id := strings.ToLower(r.PathValue("id"))
	row, err := s.DB.MediaByID(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "媒体不存在。")
		return
	}
	if err != nil {
		s.adminFailure(w)
		return
	}
	if s.ossEnabled() {
		if err := s.OSS.Delete(row.ObjectKey); err != nil {
			writeError(w, http.StatusBadGateway, "对象存储删除失败，记录已保留，请稍后重试。")
			return
		}
	}
	if err := s.DB.DeleteMediaObject(ctx, id); err != nil {
		s.adminFailure(w)
		return
	}
	_ = s.logAdmin(r, admin, "media.delete", id, map[string]any{
		"owner": row.Owner, "mime": row.Mime, "size": row.Size,
	})
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func catalogMap(catalog models.AdminCatalog) map[string]any {
	return map[string]any{
		"kinds": catalog.Kinds, "defaults": catalog.Defaults, "models": catalog.Models,
	}
}

func (s *Server) handleAdminModels(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	catalog, err := s.Models.CatalogForAdmin(r.Context())
	if err != nil {
		s.adminFailure(w)
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (s *Server) handleAdminModelsSync(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	result, err := s.Models.Sync(r.Context())
	if err != nil {
		var modelErr *models.Error
		if errors.As(err, &modelErr) {
			writeError(w, http.StatusBadRequest, modelErr.Message)
			return
		}
		s.adminFailure(w)
		return
	}
	_ = s.logAdmin(r, admin, "models.sync", "models", map[string]any{
		"added": result.Added, "removed": result.Removed, "updated": result.Updated, "upstream": result.Upstream,
	})
	catalog, err := s.Models.CatalogForAdmin(r.Context())
	if err != nil {
		s.adminFailure(w)
		return
	}
	response := catalogMap(catalog)
	response["sync"] = result
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleAdminModelsSave(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	input, err := readJSONObject(r, 256*1024)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "请求内容过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	items, _ := input["models"].([]any)
	updated, err := s.Models.Save(r.Context(), items)
	if err != nil {
		var modelErr *models.Error
		if errors.As(err, &modelErr) {
			writeError(w, http.StatusBadRequest, modelErr.Message)
			return
		}
		s.adminFailure(w)
		return
	}
	_ = s.logAdmin(r, admin, "models.update", "models", map[string]any{"updated": updated})
	catalog, err := s.Models.CatalogForAdmin(r.Context())
	if err != nil {
		s.adminFailure(w)
		return
	}
	response := catalogMap(catalog)
	response["updated"] = updated
	writeJSON(w, http.StatusOK, response)
}

type adminSettingsResponse struct {
	settings.PublicSettings
	Changed []string `json:"changed"`
}

// handleAdminSession is the admin SPA's own gate: it reports the console
// account behind the admin cookie without exposing any admin state through the
// portal API.
func (s *Server) handleAdminSession(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.currentAdmin(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"admin": map[string]any{"id": admin.ID, "email": admin.Email, "name": admin.Name},
		"build": appversion.Current(),
	})
}

func (s *Server) handleAdminSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	s.Settings.Refresh(r.Context(), true)
	response := s.Settings.ForClient()
	s.attachModelOptions(r.Context(), &response)
	writeJSON(w, http.StatusOK, response)
}

// attachModelOptions backs the default-model settings with the enabled models
// of the matching kind, so the console offers a list instead of free text. The
// stored value stays the upstream model ID used by the server.
func (s *Server) attachModelOptions(ctx context.Context, response *settings.PublicSettings) {
	catalog, err := s.Models.CatalogForAdmin(ctx)
	if err != nil {
		return
	}
	options := map[string][]settings.Option{}
	for _, model := range catalog.Models {
		if !model.Enabled || model.UpstreamID == "" {
			continue
		}
		label := model.Alias
		if model.UpstreamID != model.Alias {
			label += " · " + model.UpstreamID
		}
		key := "AI_" + strings.ToUpper(string(model.Kind)) + "_MODEL"
		options[key] = append(options[key], settings.Option{Value: model.UpstreamID, Label: label})
	}
	for index := range response.Settings {
		if list, ok := options[response.Settings[index].Key]; ok {
			response.Settings[index].Options = list
		}
	}
}

func (s *Server) handleAdminSettingsSave(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	input, err := readJSONObject(r, 64*1024)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusBadRequest, "请求内容过长。")
		} else {
			writeError(w, http.StatusBadRequest, "请求内容无效。")
		}
		return
	}
	values, _ := input["values"].(map[string]any)
	if values == nil {
		values = map[string]any{}
	}
	resetRaw, _ := input["reset"].([]any)
	reset := make([]any, 0, len(resetRaw))
	for _, item := range resetRaw {
		reset = append(reset, item)
	}
	changed, err := s.Settings.Save(r.Context(), values, reset, admin.ID)
	if err != nil {
		var settingsErr *settings.Error
		if errors.As(err, &settingsErr) {
			writeError(w, http.StatusBadRequest, settingsErr.Message)
			return
		}
		s.adminFailure(w)
		return
	}
	if len(changed) > 0 {
		_ = s.logAdmin(r, admin, "settings.update", "settings", map[string]any{"keys": changed})
	}
	if changed == nil {
		changed = []string{}
	}
	writeJSON(w, http.StatusOK, adminSettingsResponse{PublicSettings: s.Settings.ForClient(), Changed: changed})
}
