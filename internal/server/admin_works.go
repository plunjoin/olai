package server

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"olai/internal/httpx"
	"olai/internal/media"
	"olai/internal/secure"
	"olai/internal/store"
)

const (
	adminWorkPage = 20
	// maxAdminWorkUpload bounds one work file. The media store enforces its own
	// configured limit on top; this only keeps a huge request from being read.
	maxAdminWorkUpload = 64 << 20
	maxAdminWorkForm   = 8 << 20
	// maxAdminCoverUpload bounds the optional album cover of a music work.
	// Inline covers add ~4/3 of their size to the record body, so the cap stays
	// well below the 32 MB inline media limit.
	maxAdminCoverUpload = 8 << 20
	// maxWorkLyricsRunes matches the public projection cap for lyrics and lrc.
	maxWorkLyricsRunes = 64000
)

// handleAdminWorks lists works for the console. It reads the title/kind
// projection instead of the bodies, so a page never materializes inline media.
func (s *Server) handleAdminWorks(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 200 {
		query = string([]rune(query)[:200])
	}
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	visibility := strings.TrimSpace(r.URL.Query().Get("visibility"))
	hidden := strings.TrimSpace(r.URL.Query().Get("hidden"))
	offset := pageParam(r, adminWorkPage)
	rows, total, err := s.DB.AdminWorks(r.Context(), query, kind, visibility, hidden, adminWorkPage, offset)
	if err != nil {
		s.adminFailure(w)
		return
	}
	works := make([]any, 0, len(rows))
	for _, row := range rows {
		works = append(works, adminWorkPayload(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"works": works, "total": total, "nextPage": nextPage(offset, len(rows), total, adminWorkPage),
	})
}

func adminWorkPayload(row store.AdminWorkRow) map[string]any {
	return map[string]any{
		"id": "gallery_" + row.Key, "recordKey": row.Key, "recordId": row.RecordID,
		"title": row.Title, "kind": row.Kind, "visibility": row.Visibility,
		"hidden": row.Hidden, "system": row.System, "userId": row.UserID, "email": row.Email,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt,
	}
}

// handleAdminWorkCreate publishes a work on behalf of the official account.
// The file is stored through the same media manager as generated media, so the
// public gallery can serve it with the ordinary owner check.
func (s *Server) handleAdminWorkCreate(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	ctx := r.Context()
	r.Body = http.MaxBytesReader(w, r.Body, maxAdminWorkUpload+maxAdminCoverUpload+1<<20)
	if err := r.ParseMultipartForm(maxAdminWorkForm); err != nil {
		writeError(w, http.StatusBadRequest, "作品文件或表单无效，请重试。")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	kind := strings.TrimSpace(r.FormValue("kind"))
	if kind != "image" && kind != "video" && kind != "music" {
		writeError(w, http.StatusBadRequest, "作品类型无效。")
		return
	}
	title := strings.Join(strings.Fields(r.FormValue("title")), " ")
	if title == "" || utf8.RuneCountInString(title) > maxWorkTitleRunes {
		writeError(w, http.StatusBadRequest, "请填写 1–80 个字符的作品名称。")
		return
	}
	prompt, ok := workDescription(r.FormValue("prompt"), maxWorkPromptRunes)
	if !ok {
		writeError(w, http.StatusBadRequest, "作品描述不能超过 16000 个字符。")
		return
	}
	visibility := "public"
	if r.FormValue("visibility") == "private" {
		visibility = "private"
	}
	tags := parseWorkTags(r.FormValue("tags"))
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "请选择要发布的作品文件。")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxAdminWorkUpload+1))
	if err != nil || len(data) == 0 || len(data) > maxAdminWorkUpload {
		writeError(w, http.StatusRequestEntityTooLarge, "作品文件为空或超过 64 MB。")
		return
	}
	mime, ok := workUploadMime(header.Header.Get("Content-Type"), header.Filename, data, kind)
	if !ok {
		writeError(w, http.StatusBadRequest, "文件类型与作品类型不匹配。")
		return
	}
	var coverData []byte
	var coverMime string
	lyrics, lrc := "", ""
	if kind == "music" {
		// Optional album cover. Other kinds ignore the part so an older or
		// hand-rolled request cannot attach one to an image or video work.
		if upload, coverHeader, err := r.FormFile("cover"); err == nil {
			defer upload.Close()
			coverData, err = io.ReadAll(io.LimitReader(upload, maxAdminCoverUpload+1))
			if err != nil || len(coverData) == 0 || len(coverData) > maxAdminCoverUpload {
				writeError(w, http.StatusRequestEntityTooLarge, "封面文件为空或超过 8 MB。")
				return
			}
			coverMime, ok = workUploadMime(coverHeader.Header.Get("Content-Type"), coverHeader.Filename, coverData, "image")
			if !ok {
				writeError(w, http.StatusBadRequest, "封面需要是图片文件。")
				return
			}
		}
		// Lyrics are stored as text, the same fields the portal generates, so
		// the public projection and download actions pick them up unchanged.
		if lyrics, ok = workDescription(r.FormValue("lyrics"), maxWorkLyricsRunes); !ok {
			writeError(w, http.StatusBadRequest, "歌词不能超过 64000 个字符。")
			return
		}
		if lrc, ok = workDescription(r.FormValue("lrc"), maxWorkLyricsRunes); !ok {
			writeError(w, http.StatusBadRequest, "LRC 歌词不能超过 64000 个字符。")
			return
		}
	}
	officialID, err := s.DB.EnsureSystemUser(ctx)
	if err != nil {
		s.adminFailure(w)
		return
	}
	recordID := secure.ID()
	now := time.Now().UnixMilli()
	var mediaURL string
	if s.Media.Enabled() {
		identity := media.Identity{Owner: "user:" + officialID, UserID: officialID}
		stored, err := s.Media.Store(ctx, data, mime, "work-"+recordID, identity)
		if err != nil {
			mediaFailure(w, r, err)
			return
		}
		mediaURL = "/api/media/" + stored.ID
	} else {
		// Without object storage the gallery serves an inline data URL, which
		// the public projection caps at 32 MB.
		if len(data) > 32<<20 {
			writeError(w, http.StatusBadRequest, "未启用媒体云存储时，作品文件不能超过 32 MB。")
			return
		}
		mediaURL = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	var coverURL string
	if len(coverData) > 0 {
		if s.Media.Enabled() {
			identity := media.Identity{Owner: "user:" + officialID, UserID: officialID}
			stored, err := s.Media.Store(ctx, coverData, coverMime, "work-"+recordID+"-cover", identity)
			if err != nil {
				mediaFailure(w, r, err)
				return
			}
			coverURL = "/api/media/" + stored.ID
		} else {
			coverURL = "data:" + coverMime + ";base64," + base64.StdEncoding.EncodeToString(coverData)
		}
	}
	body := map[string]any{
		"id": recordID, "kind": kind, "status": "completed", "prompt": prompt,
		"title": title, "visibility": visibility, "url": mediaURL,
		"createdAt": float64(now), "options": map[string]any{},
	}
	if kind == "music" {
		body["song"] = map[string]any{
			"title": title, "style": "", "instrumental": false, "sections": []any{},
		}
		if coverURL != "" {
			body["coverUrl"] = coverURL
			body["coverStatus"] = "completed"
		}
		if lyrics != "" {
			body["lyrics"] = lyrics
		}
		if lrc != "" {
			body["lrc"] = lrc
			body["lrcSource"] = "manual"
		}
	}
	if len(tags) > 0 {
		body["tags"] = tags
	}
	serialized, err := json.Marshal(body)
	if err != nil || len(serialized) > maxRecordBytes {
		writeError(w, http.StatusBadRequest, "作品内容过大。")
		return
	}
	key := httpx.Hash(officialID + ":assets:" + recordID)
	direct, chunks := splitRecord(serialized)
	for i := range chunks {
		chunks[i].ID = key + ":" + strconv.Itoa(chunks[i].ChunkIndex)
		chunks[i].RecordKey = key
	}
	record := store.StudioRecord{
		Key: key, UserID: officialID, Store: "assets", RecordID: recordID,
		Data: direct, CreatedAt: now, UpdatedAt: now, Visibility: visibility,
		Title: title, Kind: kind,
	}
	if err := s.DB.SaveRecord(ctx, record, chunks); err != nil {
		s.adminFailure(w)
		return
	}
	_ = s.logAdmin(r, admin, "work.create", key, map[string]any{
		"title": title, "kind": kind, "visibility": visibility,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": "gallery_" + key, "recordKey": key, "recordId": recordID,
		"title": title, "kind": kind, "visibility": visibility,
		"createdAt": now, "updatedAt": now,
	})
}

// handleAdminWorkDetail returns the editable fields of one work. The list only
// carries the projection, so the edit dialog reads the description here.
func (s *Server) handleAdminWorkDetail(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	ctx := r.Context()
	key, ok := galleryRecordKey(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	record, err := s.DB.RecordByKey(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	if err != nil {
		s.adminFailure(w)
		return
	}
	if record.Store != "assets" {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
		s.adminFailure(w)
		return
	}
	hidden, err := s.DB.IsGalleryHidden(ctx, key)
	if err != nil {
		s.adminFailure(w)
		return
	}
	explicit, _ := value["title"].(string)
	writeJSON(w, http.StatusOK, map[string]any{
		"id": "gallery_" + key, "recordKey": key, "recordId": record.RecordID,
		"title": strings.TrimSpace(explicit), "displayTitle": workRecordTitle(value),
		"prompt": stringValue(value["prompt"]), "kind": workRecordKind(value),
		"visibility": record.Visibility, "hidden": hidden,
		"createdAt": record.CreatedAt, "updatedAt": record.UpdatedAt,
	})
}

// handleAdminWorkUpdate edits one work's name, description, visibility or
// takedown state. Media is left untouched.
func (s *Server) handleAdminWorkUpdate(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	ctx := r.Context()
	key, ok := galleryRecordKey(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	record, err := s.DB.RecordByKey(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	if err != nil {
		s.adminFailure(w)
		return
	}
	if record.Store != "assets" {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	input, err := readJSONObject(r, 64*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "作品信息格式无效。")
		return
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil {
		s.adminFailure(w)
		return
	}
	changed := false
	if raw, exists := input["title"]; exists {
		title, ok := raw.(string)
		if !ok {
			writeError(w, http.StatusBadRequest, "作品名称格式无效。")
			return
		}
		title = strings.Join(strings.Fields(title), " ")
		if utf8.RuneCountInString(title) > maxWorkTitleRunes {
			writeError(w, http.StatusBadRequest, "作品名称不能超过 80 个字符。")
			return
		}
		value["title"] = title
		changed = true
	}
	if raw, exists := input["prompt"]; exists {
		prompt, ok := raw.(string)
		if !ok {
			writeError(w, http.StatusBadRequest, "作品描述格式无效。")
			return
		}
		if prompt, ok = workDescription(prompt, maxWorkPromptRunes); !ok {
			writeError(w, http.StatusBadRequest, "作品描述不能超过 16000 个字符。")
			return
		}
		value["prompt"] = prompt
		changed = true
	}
	visibility := ""
	if raw, exists := input["visibility"]; exists {
		visibility, _ = raw.(string)
		if visibility != "public" && visibility != "private" {
			writeError(w, http.StatusBadRequest, "公开设置只能是公开或私密。")
			return
		}
		value["visibility"] = visibility
		changed = true
	}
	hidden, hideRequested := input["hidden"].(bool)
	if !changed && !hideRequested {
		writeError(w, http.StatusBadRequest, "没有需要更新的内容。")
		return
	}
	if changed {
		scrubbed, _ := s.scrubRecord(value).(map[string]any)
		value = scrubbed
		serialized, err := json.Marshal(value)
		if err != nil || len(serialized) > maxRecordBytes {
			writeError(w, http.StatusBadRequest, "作品内容过大。")
			return
		}
		direct, chunks := splitRecord(serialized)
		for i := range chunks {
			chunks[i].ID = key + ":" + strconv.Itoa(chunks[i].ChunkIndex)
			chunks[i].RecordKey = key
		}
		updated, err := s.DB.UpdateWorkRecord(ctx, key, "", record.UpdatedAt, store.WorkRecordUpdate{
			Data: direct, Title: workRecordTitle(value), Kind: workRecordKind(value),
			Visibility: visibility, Chunks: chunks,
		})
		if err != nil {
			s.adminFailure(w)
			return
		}
		if !updated {
			writeError(w, http.StatusConflict, "作品已在其他地方更新，请刷新后重试。")
			return
		}
		_ = s.logAdmin(r, admin, "work.update", key, map[string]any{"title": workRecordTitle(value)})
	}
	if hideRequested {
		if hidden {
			err = s.DB.HideGalleryRecord(ctx, key, "管理员隐藏", admin.Email)
		} else {
			err = s.DB.UnhideGalleryRecord(ctx, key)
		}
		if err != nil {
			s.adminFailure(w)
			return
		}
		action := "work.unhide"
		if hidden {
			action = "work.hide"
		}
		_ = s.logAdmin(r, admin, action, key, nil)
	}
	currentHidden, err := s.DB.IsGalleryHidden(ctx, key)
	if err != nil {
		s.adminFailure(w)
		return
	}
	currentVisibility := record.Visibility
	if visibility != "" {
		currentVisibility = visibility
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "hidden": currentHidden,
		"title": workRecordTitle(value), "kind": workRecordKind(value),
		"visibility": currentVisibility,
	})
}

// handleAdminWorkDelete removes a work and its gallery metadata. Media objects
// follow the same lifecycle as an owner deletion and are cleaned up by the
// media maintenance path.
func (s *Server) handleAdminWorkDelete(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	ctx := r.Context()
	key, ok := galleryRecordKey(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	record, err := s.DB.RecordByKey(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	if err != nil {
		s.adminFailure(w)
		return
	}
	if record.Store != "assets" {
		writeError(w, http.StatusNotFound, "作品不存在。")
		return
	}
	if err := s.DB.DeleteRecord(ctx, key, record.UserID, "assets"); err != nil {
		s.adminFailure(w)
		return
	}
	_ = s.logAdmin(r, admin, "work.delete", key, map[string]any{"recordId": record.RecordID})
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

// workDescription keeps line breaks but drops control characters, and rejects
// overlong text instead of silently cutting a description the admin wrote.
func workDescription(value string, max int) (string, bool) {
	value = strings.TrimSpace(value)
	value = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, value)
	if utf8.RuneCountInString(value) > max {
		return "", false
	}
	return value, true
}

// parseWorkTags accepts either a JSON string array (what the portal syncs) or
// a comma-separated form value, and applies the same caps as the gallery.
func parseWorkTags(raw string) []any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var items []string
	if strings.HasPrefix(raw, "[") {
		var parsed []any
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			for _, item := range parsed {
				if tag, ok := item.(string); ok {
					items = append(items, tag)
				}
			}
		}
	}
	if len(items) == 0 {
		items = strings.FieldsFunc(raw, func(r rune) bool {
			return r == ',' || r == '，' || r == '\n'
		})
	}
	out := make([]any, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		tag := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(item), "#＃"))
		tag = strings.Join(strings.Fields(tag), " ")
		if tag == "" {
			continue
		}
		runes := []rune(tag)
		if len(runes) > maxWorkTagRunes {
			runes = runes[:maxWorkTagRunes]
		}
		tag = strings.TrimSpace(string(runes))
		key := strings.ToLower(tag)
		if tag == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, tag)
		if len(out) >= maxWorkTags {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// workUploadMime picks a supported MIME type that matches the chosen kind. The
// browser label is preferred, then a content sniff, then the file extension.
func workUploadMime(declared, filename string, data []byte, kind string) (string, bool) {
	candidates := []string{declared, http.DetectContentType(data)}
	candidates = append(candidates, workExtensionMimes(filename, kind)...)
	for _, candidate := range candidates {
		mime := strings.ToLower(strings.TrimSpace(strings.SplitN(candidate, ";", 2)[0]))
		switch mime {
		case "audio/wave", "audio/vnd.wave":
			mime = "audio/wav"
		case "application/ogg":
			mime = "audio/ogg"
		}
		if _, err := media.NormalizeMime(mime); err != nil {
			continue
		}
		if workMimeMatchesKind(kind, mime) {
			return mime, true
		}
	}
	return "", false
}

func workMimeMatchesKind(kind, mime string) bool {
	switch kind {
	case "image":
		return strings.HasPrefix(mime, "image/")
	case "music":
		return strings.HasPrefix(mime, "audio/")
	case "video":
		return strings.HasPrefix(mime, "video/")
	}
	return false
}

func workExtensionMimes(filename, kind string) []string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".png":
		return []string{"image/png"}
	case ".jpg", ".jpeg":
		return []string{"image/jpeg"}
	case ".webp":
		return []string{"image/webp"}
	case ".gif":
		return []string{"image/gif"}
	case ".avif":
		return []string{"image/avif"}
	case ".bmp":
		return []string{"image/bmp"}
	case ".mp3":
		return []string{"audio/mpeg"}
	case ".m4a", ".aac":
		if kind == "video" {
			return []string{"video/mp4"}
		}
		return []string{"audio/mp4", "audio/aac"}
	case ".wav":
		return []string{"audio/wav"}
	case ".flac":
		return []string{"audio/flac"}
	case ".ogg", ".ogv":
		if kind == "video" {
			return []string{"video/ogg"}
		}
		return []string{"audio/ogg"}
	case ".webm":
		if kind == "video" {
			return []string{"video/webm"}
		}
		return []string{"audio/webm"}
	case ".mp4":
		if kind == "music" {
			return []string{"audio/mp4"}
		}
		return []string{"video/mp4"}
	case ".mov":
		return []string{"video/quicktime"}
	}
	return nil
}
