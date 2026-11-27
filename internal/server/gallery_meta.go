package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"olai/internal/store"
)

// handleGalleryWorkMeta lets a work's owner rename it or edit its description
// after publishing, without re-uploading the media. The record body stays the
// source of truth; the title/kind projection is refreshed in the same write.
func (s *Server) handleGalleryWorkMeta(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	key, ok := galleryRecordKey(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	ctx := r.Context()
	record, err := s.DB.RecordByKey(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "作品信息暂不可用，请稍后重试。")
		return
	}
	if record.Store != "assets" {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	if record.UserID != user.ID {
		writeError(w, http.StatusForbidden, "只有作者本人可以修改作品信息。")
		return
	}
	input, err := readJSONObject(r, 64*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "作品信息格式无效。")
		return
	}
	title, hasTitle := "", false
	if raw, exists := input["title"]; exists {
		parsed, ok := raw.(string)
		if !ok {
			writeError(w, http.StatusBadRequest, "作品名称格式无效。")
			return
		}
		title = strings.Join(strings.Fields(parsed), " ")
		if utf8.RuneCountInString(title) > maxWorkTitleRunes {
			writeError(w, http.StatusBadRequest, "作品名称不能超过 80 个字符。")
			return
		}
		hasTitle = true
	}
	prompt, hasPrompt := "", false
	if raw, exists := input["prompt"]; exists {
		parsed, ok := raw.(string)
		if !ok {
			writeError(w, http.StatusBadRequest, "作品描述格式无效。")
			return
		}
		if prompt, ok = workDescription(parsed, maxWorkPromptRunes); !ok {
			writeError(w, http.StatusBadRequest, "作品描述不能超过 16000 个字符。")
			return
		}
		hasPrompt = true
	}
	if !hasTitle && !hasPrompt {
		writeError(w, http.StatusBadRequest, "没有需要更新的内容。")
		return
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
		writeError(w, http.StatusServiceUnavailable, "作品信息暂不可用，请稍后重试。")
		return
	}
	if hasTitle {
		value["title"] = title
	}
	if hasPrompt {
		value["prompt"] = prompt
	}
	scrubbed, _ := s.scrubRecord(value).(map[string]any)
	serialized, err := json.Marshal(scrubbed)
	if err != nil || len(serialized) > maxRecordBytes {
		writeError(w, http.StatusBadRequest, "作品内容过大。")
		return
	}
	direct, chunks := splitRecord(serialized)
	for i := range chunks {
		chunks[i].ID = key + ":" + strconv.Itoa(chunks[i].ChunkIndex)
		chunks[i].RecordKey = key
	}
	updated, err := s.DB.UpdateWorkRecord(ctx, key, user.ID, record.UpdatedAt, store.WorkRecordUpdate{
		Data: direct, Title: workRecordTitle(scrubbed), Kind: workRecordKind(scrubbed),
		Status: workRecordStatus(scrubbed), Chunks: chunks,
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "作品信息暂不可用，请稍后重试。")
		return
	}
	if !updated {
		writeError(w, http.StatusConflict, "作品信息已在其他地方修改，请刷新后重试。")
		return
	}
	explicit, _ := value["title"].(string)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "title": strings.TrimSpace(explicit),
		"displayTitle": workRecordTitle(scrubbed),
		"prompt":       stringValue(value["prompt"]),
	})
}
