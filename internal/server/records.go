package server

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"olai/internal/ai"
	"olai/internal/httpx"
	"olai/internal/media"
	"olai/internal/store"
)

const (
	maxRecordBytes = 64 * 1024 * 1024
	recordChunk    = 128 * 1024
	// Mirror the gallery projection limits so stored tags always fit the public
	// shape instead of being silently dropped later.
	maxWorkTags     = 8
	maxWorkTagRunes = 24
	// maxWorkTitleRunes matches the public title cap; maxWorkPromptRunes matches
	// the gallery's prompt projection so an editable description is not silently
	// cut off when it is published.
	maxWorkTitleRunes  = 80
	maxWorkPromptRunes = 16000
)

var recordIDRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

var workflowStages = map[string]bool{
	"init": true, "script": true, "shotlist": true, "keyframes": true,
	"videos": true, "music": true, "assembly": true, "complete": true,
}

func (s *Server) allowedStores() []string {
	if s.Settings.Get("AI_SHORT_FILM") == "true" {
		return []string{"conversations", "assets", "workflows"}
	}
	return []string{"conversations", "assets"}
}

func storeAllowed(stores []string, name string) bool {
	for _, item := range stores {
		if item == name {
			return true
		}
	}
	return false
}

func recordError(value map[string]any, storeName string) string {
	id, ok := value["id"].(string)
	if !ok || !recordIDRE.MatchString(id) {
		return "记录编号无效。"
	}
	if _, ok := value["createdAt"].(float64); !ok {
		return "记录缺少有效的创建时间。"
	}
	if storeName == "workflows" {
		title, ok := value["title"].(string)
		if !ok || len([]rune(title)) > 100 {
			return "短片标题无效或超过 100 个字符。"
		}
		if _, ok := value["updatedAt"].(float64); !ok {
			return "短片创意或更新时间无效。"
		}
		if _, ok := value["idea"].(string); !ok {
			return "短片创意或更新时间无效。"
		}
		stage, _ := value["stage"].(string)
		if !workflowStages[stage] {
			return "短片阶段无效。"
		}
		if raw, exists := value["elements"]; exists {
			elements, ok := raw.([]any)
			if !ok {
				return "短片元素格式无效。"
			}
			for _, item := range elements {
				element, ok := item.(map[string]any)
				if !ok {
					return "短片元素格式无效。"
				}
				elementID, _ := element["id"].(string)
				kind, _ := element["kind"].(string)
				if elementID == "" || (kind != "character" && kind != "scene" && kind != "prop") {
					return "短片元素格式无效。"
				}
				if _, ok := element["name"].(string); !ok {
					return "短片元素格式无效。"
				}
				if _, ok := element["description"].(string); !ok {
					return "短片元素格式无效。"
				}
			}
		}
		if raw, exists := value["shots"]; exists {
			shots, ok := raw.([]any)
			if !ok {
				return "短片镜头格式无效。"
			}
			for _, item := range shots {
				shot, ok := item.(map[string]any)
				if !ok {
					return "短片镜头格式无效。"
				}
				shotID, _ := shot["id"].(string)
				duration, _ := shot["duration"].(float64)
				if shotID == "" || duration <= 0 || duration > 30 {
					return "短片镜头格式无效。"
				}
				if _, ok := shot["sceneDescription"].(string); !ok {
					return "短片镜头格式无效。"
				}
				if rawIDs, exists := shot["elementIds"]; exists {
					ids, ok := rawIDs.([]any)
					if !ok {
						return "短片镜头格式无效。"
					}
					for _, value := range ids {
						if _, ok := value.(string); !ok {
							return "短片镜头格式无效。"
						}
					}
				}
			}
		}
		return ""
	}
	if storeName == "conversations" {
		title, ok := value["title"].(string)
		if !ok || len([]rune(title)) > 100 {
			return "会话标题无效或超过 100 个字符。"
		}
		if _, ok := value["updatedAt"].(float64); !ok {
			return "会话缺少有效的更新时间。"
		}
		messages, ok := value["messages"].([]any)
		if !ok {
			return "会话消息需要是数组。"
		}
		for index, item := range messages {
			message, ok := item.(map[string]any)
			if !ok {
				return "会话第 " + strconv.Itoa(index+1) + " 条消息的编号、角色或内容格式无效。"
			}
			if _, ok := message["id"].(string); !ok {
				return "会话第 " + strconv.Itoa(index+1) + " 条消息的编号、角色或内容格式无效。"
			}
			role, _ := message["role"].(string)
			if role != "user" && role != "assistant" {
				return "会话第 " + strconv.Itoa(index+1) + " 条消息的编号、角色或内容格式无效。"
			}
			if _, ok := message["content"].(string); !ok {
				return "会话第 " + strconv.Itoa(index+1) + " 条消息的编号、角色或内容格式无效。"
			}
		}
		return ""
	}
	kind, _ := value["kind"].(string)
	if kind != "image" && kind != "music" && kind != "video" {
		return "作品类型无效。"
	}
	status, _ := value["status"].(string)
	if status != "pending" && status != "completed" && status != "failed" {
		return "作品状态无效。"
	}
	if _, ok := value["prompt"].(string); !ok {
		return "作品描述需要是文本。"
	}
	if raw, exists := value["title"]; exists {
		title, ok := raw.(string)
		if !ok || utf8.RuneCountInString(strings.TrimSpace(title)) > maxWorkTitleRunes {
			return "作品名称无效或超过 80 个字符。"
		}
	}
	if _, ok := value["options"].(map[string]any); !ok {
		return "作品参数需要是 JSON 对象。"
	}
	if raw, exists := value["tags"]; exists {
		tags, ok := raw.([]any)
		if !ok || len(tags) > maxWorkTags {
			return "作品标签格式无效。"
		}
		for _, item := range tags {
			tag, ok := item.(string)
			if !ok || strings.TrimSpace(tag) == "" || utf8.RuneCountInString(tag) > maxWorkTagRunes {
				return "作品标签需为 1–24 个字符。"
			}
		}
	}
	return ""
}

func (s *Server) recordSecrets() []string {
	return s.AI.PrivateValues(nil)
}

func (s *Server) scrubRecord(value any) any {
	secrets := s.recordSecrets()
	return scrubRecordPrivacy(value, func(text string) string { return ai.RedactText(text, secrets) })
}

func (s *Server) handleRecords(w http.ResponseWriter, r *http.Request) {
	storeName := r.PathValue("store")
	if !storeAllowed(s.allowedStores(), storeName) {
		writeError(w, http.StatusNotFound, "接口不存在。")
		return
	}
	if r.Method != http.MethodGet && !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	ctx := r.Context()
	user, err := s.Auth.CurrentUser(ctx, r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
		return
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "登录已过期，请重新登录后保存。")
		return
	}
	if r.Header.Get("X-Olai-User") != user.ID {
		writeError(w, http.StatusConflict, "账号已切换，请刷新页面后继续。")
		return
	}
	switch r.Method {
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if !recordIDRE.MatchString(id) {
			writeError(w, http.StatusBadRequest, "记录编号无效。")
			return
		}
		key := httpx.Hash(user.ID + ":" + storeName + ":" + id)
		if err := s.DB.DeleteRecord(ctx, key, user.ID, storeName); err != nil {
			writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case http.MethodGet:
		records, err := s.DB.RecordsFor(ctx, user.ID, storeName)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
			return
		}
		var identity media.Identity
		if s.ossEnabled() {
			value, err := s.Media.Identify(ctx, w, r)
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
				return
			}
			identity = value
		}
		output := make([]any, 0, len(records))
		for _, record := range records {
			var value any
			if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
				writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
				return
			}
			value = s.scrubRecord(value)
			if s.ossEnabled() {
				value = s.Media.PublicRecordMedia(value, identity)
			}
			if storeName == "assets" {
				// Visibility lives in a column so a stale body can never
				// republish or withdraw a work. The owner's client still needs
				// the current value to show the publish action after a reload.
				if object, ok := value.(map[string]any); ok {
					object["visibility"] = record.Visibility
				}
			}
			output = append(output, value)
		}
		writeJSON(w, http.StatusOK, map[string]any{"records": output})
	case http.MethodPost:
		s.migrateRecords(w, r, user, storeName)
	case http.MethodPut:
		s.saveRecord(w, r, user, storeName)
	}
}

// handleStoredRecordVisibility publishes or withdraws one of the signed-in
// owner's works by its record id. The portal knows each asset by that id, so
// the action does not need the gallery alias or a full record rewrite.
func (s *Server) handleStoredRecordVisibility(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if r.PathValue("store") != "assets" {
		writeError(w, http.StatusNotFound, "接口不存在。")
		return
	}
	if r.Header.Get("X-Olai-User") != user.ID {
		writeError(w, http.StatusConflict, "账号已切换，请刷新页面后继续。")
		return
	}
	id := r.PathValue("id")
	if !recordIDRE.MatchString(id) {
		writeError(w, http.StatusBadRequest, "记录编号无效。")
		return
	}
	input, err := readJSONObject(r, 2*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "公开设置格式无效。")
		return
	}
	visibility, _ := input["visibility"].(string)
	if visibility != "public" && visibility != "private" {
		writeError(w, http.StatusBadRequest, "公开设置只能是公开或私密。")
		return
	}
	key := httpx.Hash(user.ID + ":assets:" + id)
	changed, err := s.DB.SetRecordVisibility(r.Context(), key, user.ID, visibility)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "公开设置暂不可用，请稍后重试。")
		return
	}
	if !changed {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"visibility": visibility})
}

func (s *Server) migrateRecords(w http.ResponseWriter, r *http.Request, user *store.SessionUser, storeName string) {
	ctx := r.Context()
	if !s.ossEnabled() {
		writeError(w, http.StatusServiceUnavailable, "媒体云存储尚未启用。")
		return
	}
	identity, err := s.Media.Identify(ctx, w, r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
		return
	}
	if err := s.Media.ReserveUpload(ctx, identity); err != nil {
		writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
		return
	}
	records, err := s.DB.RecordsFor(ctx, user.ID, storeName)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
		return
	}
	failures := []string{}
	migratedIDs := []string{}
	migrated := 0
	for _, record := range records {
		var value any
		if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
			failures = append(failures, "记录「"+record.RecordID+"」的附件尚未迁移，原始记录已保留，请稍后重试。")
			continue
		}
		value = s.scrubRecord(value)
		before, err := json.Marshal(value)
		if err != nil {
			failures = append(failures, "记录「"+record.RecordID+"」的附件尚未迁移，原始记录已保留，请稍后重试。")
			continue
		}
		updatedValue, err := s.Media.PersistServerRecordMedia(ctx, value, identity)
		if err != nil {
			failures = append(failures, "记录「"+record.RecordID+"」的附件尚未迁移，原始记录已保留，请稍后重试。")
			continue
		}
		after, err := json.Marshal(updatedValue)
		if err != nil || len(after) > maxRecordBytes {
			failures = append(failures, "记录「"+record.RecordID+"」的附件尚未迁移，原始记录已保留，请稍后重试。")
			continue
		}
		if string(before) == string(after) {
			continue
		}
		status := store.WorkStatusUnknown
		if storeName == "assets" {
			if updated, ok := updatedValue.(map[string]any); ok {
				status = workRecordStatus(updated)
			}
		}
		ok, err := s.DB.UpdateRecordData(ctx, record.Key, user.ID, storeName, record.UpdatedAt, string(after), status)
		if err != nil || !ok {
			failures = append(failures, "记录「"+record.RecordID+"」的附件尚未迁移，原始记录已保留，请稍后重试。")
			continue
		}
		migrated++
		migratedIDs = append(migratedIDs, record.RecordID)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"migrated": migrated, "migratedIds": migratedIDs, "failures": failures,
	})
}

func splitRecord(value []byte) (string, []store.RecordChunk) {
	if len(value) <= recordChunk {
		return string(value), nil
	}
	var chunks []store.RecordChunk
	for start := 0; start < len(value); {
		end := start + recordChunk
		if end > len(value) {
			end = len(value)
		}
		// Never split a UTF-8 rune across chunks.
		for end < len(value) && value[end]&0xc0 == 0x80 {
			end--
		}
		if end <= start {
			end = start + recordChunk
		}
		chunks = append(chunks, store.RecordChunk{ChunkIndex: len(chunks), Data: string(value[start:end])})
		start = end
	}
	return "", chunks
}

// workRecordStatus reads the work status that is mirrored into a column so
// the portal can count published works without reading record bodies. An
// unknown status is reported as store.WorkStatusUnknown.
func workRecordStatus(value map[string]any) string {
	status, _ := value["status"].(string)
	switch status {
	case "pending", "completed", "failed":
		return status
	}
	return store.WorkStatusUnknown
}

// workRecordKind reads the asset kind that is mirrored into the admin listing.
func workRecordKind(value map[string]any) string {
	kind, _ := value["kind"].(string)
	switch kind {
	case "image", "video", "music":
		return kind
	}
	return ""
}

// workRecordTitle returns the name a work is displayed under: the explicit
// title, then the song title, then the first line of the prompt. It is clamped
// to the public cap so the stored projection never differs from the feed.
func workRecordTitle(value map[string]any) string {
	title, _ := value["title"].(string)
	if strings.TrimSpace(title) == "" {
		if song, ok := value["song"].(map[string]any); ok {
			title, _ = song["title"].(string)
		}
	}
	if strings.TrimSpace(title) == "" {
		title, _ = value["prompt"].(string)
	}
	title = strings.TrimSpace(title)
	if index := strings.IndexByte(title, '\n'); index >= 0 {
		title = strings.TrimSpace(title[:index])
	}
	runes := []rune(title)
	if len(runes) > maxWorkTitleRunes {
		runes = runes[:maxWorkTitleRunes]
	}
	return strings.TrimSpace(string(runes))
}

func (s *Server) saveRecord(w http.ResponseWriter, r *http.Request, user *store.SessionUser, storeName string) {
	ctx := r.Context()
	data, ok := readBody(r, maxRecordBytes)
	if !ok {
		writeError(w, http.StatusRequestEntityTooLarge, "单条云端记录不能超过 64 MB，请下载较大的作品备份。")
		return
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		writeError(w, http.StatusBadRequest, "记录格式无效。")
		return
	}
	if _, ok := value.(map[string]any); !ok {
		writeError(w, http.StatusBadRequest, "记录需要是 JSON 对象。")
		return
	}
	scrubbed := s.scrubRecord(value)
	recordMap, _ := scrubbed.(map[string]any)
	if message := recordError(recordMap, storeName); message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	if s.ossEnabled() {
		key := httpx.Hash(user.ID + ":" + storeName + ":" + recordMap["id"].(string))
		if r.URL.Query().Get("import") == "guest" {
			if existing, err := s.DB.RecordByKey(ctx, key); err == nil && existing.UserID == user.ID && existing.Store == storeName {
				writeJSON(w, http.StatusOK, map[string]any{"ok": true, "existing": true})
				return
			}
		}
		identity, err := s.Media.Identify(ctx, w, r)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
			return
		}
		if err := s.Media.ReserveUpload(ctx, identity); err != nil {
			writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
			return
		}
		persisted, err := s.Media.PersistServerRecordMedia(ctx, scrubbed, identity)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
			return
		}
		scrubbed = persisted
		recordMap, _ = scrubbed.(map[string]any)
	}
	serialized, err := json.Marshal(scrubbed)
	if err != nil {
		writeError(w, http.StatusBadRequest, "记录格式无效。")
		return
	}
	id, _ := recordMap["id"].(string)
	key := httpx.Hash(user.ID + ":" + storeName + ":" + id)
	now := time.Now().UnixMilli()
	// The public feed orders by the client-side creation time. It is validated
	// as a number above; clamp the future (before converting, so an
	// out-of-range float cannot overflow into a negative) so a work cannot pin
	// itself to the top of 最新 by writing a bogus timestamp.
	createdAt := now
	if created, ok := recordMap["createdAt"].(float64); ok && created > 0 && created <= float64(now) {
		createdAt = int64(created)
	}
	record := store.StudioRecord{Key: key, UserID: user.ID, Store: storeName, RecordID: id, CreatedAt: createdAt, UpdatedAt: now}
	if storeName == "assets" {
		// Visibility is server state that changes only through
		// PUT /api/records/{store}/{id}/visibility. A full-record save may pick
		// it when the row is first created (an importer's explicit value,
		// otherwise private), but never on update: a stale client echoing a
		// record it fetched earlier must not republish or withdraw a work.
		record.CreateVisibility = "private"
		switch recordMap["visibility"] {
		case "public":
			record.CreateVisibility = "public"
		case "private":
			record.CreateVisibility = "private"
		}
		// Mirror the fields the admin console lists and searches. The effective
		// title falls back exactly like the portal does, so a work added by an
		// older client is still searchable by the name people see.
		record.Kind = workRecordKind(recordMap)
		record.Title = workRecordTitle(recordMap)
		record.Status = workRecordStatus(recordMap)
	}
	directData, chunks := splitRecord(serialized)
	record.Data = directData
	for i := range chunks {
		chunks[i].ID = key + ":" + strconv.Itoa(chunks[i].ChunkIndex)
		chunks[i].RecordKey = key
	}
	if r.URL.Query().Get("import") == "guest" {
		guestOwner := ""
		if storeName == "assets" {
			if kind, _ := recordMap["kind"].(string); kind == "video" {
				if remoteID, _ := recordMap["remoteId"].(string); remoteID != "" {
					if peerIP, err := s.clientIP(r); err == nil {
						guestOwner = "ip:" + httpx.Hash(peerIP)
					}
				}
			}
		}
		remoteID, _ := recordMap["remoteId"].(string)
		if _, err := s.DB.InsertRecordIfAbsent(ctx, record, chunks, guestOwner, "user:"+user.ID, remoteID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if err := s.DB.SaveRecord(ctx, record, chunks); err != nil {
		writeError(w, http.StatusServiceUnavailable, "云端记录暂时无法读取或保存，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
