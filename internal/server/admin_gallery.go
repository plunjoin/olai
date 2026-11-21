package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"olai/internal/store"
)

const adminReportPage = 20

func adminTruncate(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}

// handleAdminReports lists moderation reports together with enough work
// context to triage them without leaving the console.
func (s *Server) handleAdminReports(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	ctx := r.Context()
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	switch status {
	case "", "all":
		status = ""
	case "open", "resolved", "dismissed":
	default:
		status = "open"
	}
	offset := pageParam(r, adminReportPage)
	rows, total, err := s.DB.GalleryReports(ctx, status, adminReportPage, offset)
	if err != nil {
		s.adminFailure(w)
		return
	}
	openCount, err := s.DB.CountOpenGalleryReports(ctx)
	if err != nil {
		s.adminFailure(w)
		return
	}
	hidden, err := s.DB.GalleryHiddenKeys(ctx)
	if err != nil {
		s.adminFailure(w)
		return
	}
	keys := make([]string, 0, len(rows))
	for _, row := range rows {
		keys = append(keys, row.RecordKey)
	}
	records, err := s.DB.RecordsByKeys(ctx, uniqueStrings(keys))
	if err != nil {
		s.adminFailure(w)
		return
	}
	ownerIDs := make([]string, 0, len(records))
	for _, record := range records {
		ownerIDs = append(ownerIDs, record.UserID)
	}
	emails, err := s.DB.EmailsByIDs(ctx, uniqueStrings(ownerIDs))
	if err != nil {
		s.adminFailure(w)
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		work := map[string]any{
			"recordKey": row.RecordKey, "assetId": "gallery_" + row.RecordKey,
			"hidden": hidden[row.RecordKey], "exists": false,
		}
		if record, ok := records[row.RecordKey]; ok {
			work["exists"] = true
			work["ownerEmail"] = emails[record.UserID]
			work["userId"] = record.UserID
			var value map[string]any
			if json.Unmarshal([]byte(record.Body), &value) == nil {
				if kind, ok := value["kind"].(string); ok {
					work["kind"] = kind
				}
				if prompt, ok := value["prompt"].(string); ok {
					work["prompt"] = adminTruncate(prompt, 300)
				}
				if recordStatus, ok := value["status"].(string); ok {
					work["status"] = recordStatus
				}
			}
		}
		list = append(list, map[string]any{
			"id": row.ID, "recordKey": row.RecordKey, "reason": row.Reason, "detail": row.Detail,
			"status": row.Status, "reporterEmail": row.ReporterEmail, "reporterId": row.ReporterID,
			"createdAt": row.CreatedAt, "handledAt": row.HandledAt, "handledBy": row.HandledBy,
			"work": work,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"reports": list, "total": total, "open": openCount,
		"nextPage": nextPage(offset, len(rows), total, adminReportPage),
	})
}

// handleAdminReportAction resolves or dismisses one report, and can hide or
// restore the reported work. Hiding closes every open report for that work.
func (s *Server) handleAdminReportAction(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	id := r.PathValue("id")
	report, err := s.DB.GalleryReportByID(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "举报记录不存在。")
		return
	}
	if err != nil {
		s.adminFailure(w)
		return
	}
	input, err := readJSONObject(r, 2048)
	if err != nil {
		writeError(w, http.StatusBadRequest, "操作内容无效。")
		return
	}
	action, _ := input["action"].(string)
	now := time.Now().UnixMilli()
	status := ""
	logAction := ""
	switch action {
	case "resolve":
		status, logAction = "resolved", "report.resolve"
	case "dismiss":
		status, logAction = "dismissed", "report.dismiss"
	case "hide":
		if err := s.DB.HideGalleryRecord(ctx, report.RecordKey, "举报处理", admin.Email); err != nil {
			s.adminFailure(w)
			return
		}
		if err := s.DB.SetRecordReportsStatus(ctx, report.RecordKey, "resolved", admin.Email, now); err != nil {
			s.adminFailure(w)
			return
		}
		logAction = "gallery.hide"
	case "unhide":
		if err := s.DB.UnhideGalleryRecord(ctx, report.RecordKey); err != nil {
			s.adminFailure(w)
			return
		}
		logAction = "gallery.unhide"
	default:
		writeError(w, http.StatusBadRequest, "不支持的处理方式。")
		return
	}
	if status != "" {
		if err := s.DB.SetGalleryReportStatus(ctx, id, status, admin.Email, now); err != nil {
			s.adminFailure(w)
			return
		}
	}
	_ = s.logAdmin(r, admin, logAction, id, map[string]any{"recordKey": report.RecordKey})
	hidden, err := s.DB.IsGalleryHidden(ctx, report.RecordKey)
	if err != nil {
		s.adminFailure(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "hidden": hidden})
}
