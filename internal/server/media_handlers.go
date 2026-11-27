package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"olai/internal/media"
)

var attachmentIDRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,250}$`)

func mediaFailure(w http.ResponseWriter, r *http.Request, err error) {
	head := r.Method == http.MethodHead
	var safe *media.Error
	if errors.As(err, &safe) {
		media.WriteFailure(w, safe, head)
		return
	}
	media.WriteFailure(w, &media.Error{Status: http.StatusServiceUnavailable, Code: "MEDIA_UNAVAILABLE", Message: "私有媒体服务暂不可用。"}, head)
}

func (s *Server) handleMediaUpload(w http.ResponseWriter, r *http.Request) {
	result, err := s.Media.Upload(r.Context(), w, r)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleMediaDownload(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !s.Media.Enabled() {
		mediaFailure(w, r, &media.Error{Status: http.StatusServiceUnavailable, Code: "MEDIA_UNAVAILABLE", Message: "私有媒体服务暂不可用。"})
		return
	}
	if err := s.Media.AssertMediaOrigin(r, false); err != nil {
		mediaFailure(w, r, err)
		return
	}
	identity, err := s.Media.Identify(ctx, w, r)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	row, err := s.Media.LookupForOwner(ctx, identity, r.PathValue("id"))
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	if err := s.Media.ServeMedia(ctx, w, r, identity, row); err != nil {
		mediaFailure(w, r, err)
	}
}

func (s *Server) handleMediaImport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !s.ossEnabled() {
		writeError(w, http.StatusServiceUnavailable, "媒体云存储尚未启用。")
		return
	}
	if err := s.Media.AssertOrigin(r, s.siteOrigin(r), true); err != nil {
		mediaFailure(w, r, err)
		return
	}
	identity, err := s.Media.Identify(ctx, w, r)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	expected := r.Header.Get("X-Olai-User")
	actual := identity.UserID
	if actual == "" {
		actual = "guest"
	}
	if expected != actual {
		writeError(w, http.StatusConflict, "账号已切换，请刷新后再同步。")
		return
	}
	if err := s.Media.ReserveUpload(ctx, identity); err != nil {
		mediaFailure(w, r, err)
		return
	}
	data, ok := readBody(r, 8192)
	if !ok {
		writeError(w, http.StatusRequestEntityTooLarge, "请求内容过长。")
		return
	}
	var input struct {
		URL          string `json:"url"`
		AttachmentID string `json:"attachmentId"`
	}
	if err := json.Unmarshal(data, &input); err != nil || input.URL == "" || !attachmentIDRE.MatchString(input.AttachmentID) {
		writeError(w, http.StatusBadRequest, "媒体同步参数无效。")
		return
	}
	remote, err := s.Media.ImportRemoteMedia(ctx, input.URL)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	if err := s.Media.ReserveBytes(ctx, identity, int64(len(remote.Bytes))); err != nil {
		mediaFailure(w, r, err)
		return
	}
	stored, err := s.Media.Store(ctx, remote.Bytes, remote.Mime, input.AttachmentID, identity)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": stored.ID, "url": "/api/media/" + stored.ID, "mime": stored.Mime, "size": stored.Size,
	})
}

func (s *Server) handleGallery(w http.ResponseWriter, r *http.Request) {
	viewer := ""
	if user, err := s.Auth.CurrentUser(r.Context(), r); err == nil && user != nil {
		viewer = user.ID
	}
	result, err := s.Gallery.List(r.Context(), r, viewer)
	if err != nil {
		var safe *media.Error
		if errors.As(err, &safe) {
			media.WriteFailure(w, safe, r.Method == http.MethodHead)
			return
		}
		media.WriteFailure(w, &media.Error{Status: http.StatusServiceUnavailable, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}, r.Method == http.MethodHead)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGalleryFavorite(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, err := s.Auth.CurrentUser(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "收藏服务暂不可用，请稍后重试。")
		return
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录后再收藏作品。")
		return
	}
	result, err := s.Gallery.SetFavorite(r.Context(), user.ID, r.PathValue("id"), r.Method == http.MethodPut)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGalleryFavoritesImport(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, err := s.Auth.CurrentUser(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "收藏服务暂不可用，请稍后重试。")
		return
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录后再同步收藏。")
		return
	}
	input, err := readJSONObject(r, 64*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "收藏数据格式无效。")
		return
	}
	raw, _ := input["ids"].([]any)
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		if id, ok := item.(string); ok {
			ids = append(ids, id)
		}
	}
	imported, err := s.Gallery.ImportFavorites(r.Context(), user.ID, ids)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"imported": imported})
}

func (s *Server) handleGalleryView(w http.ResponseWriter, r *http.Request) {
	s.handleGalleryMetric(w, r, false)
}

func (s *Server) handleGalleryDownload(w http.ResponseWriter, r *http.Request) {
	s.handleGalleryMetric(w, r, true)
}

func (s *Server) handleGalleryMetric(w http.ResponseWriter, r *http.Request, download bool) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	viewer := ""
	if user, err := s.Auth.CurrentUser(r.Context(), r); err == nil && user != nil {
		viewer = user.ID
	}
	var result map[string]any
	var err error
	if download {
		result, err = s.Gallery.RecordDownload(r.Context(), r, r.PathValue("id"), viewer)
	} else {
		result, err = s.Gallery.RecordView(r.Context(), r, r.PathValue("id"), viewer)
	}
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGalleryComments(w http.ResponseWriter, r *http.Request) {
	result, err := s.Gallery.ListComments(r.Context(), r, r.URL.Query().Get("id"))
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGalleryCommentCreate(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, err := s.Auth.CurrentUser(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "评论服务暂不可用，请稍后重试。")
		return
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录后再评论。")
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		writeError(w, http.StatusBadRequest, "评论内容格式无效。")
		return
	}
	body, _ := input["body"].(string)
	result, err := s.Gallery.AddComment(r.Context(), r, user, r.URL.Query().Get("id"), body)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGalleryReport(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, err := s.Auth.CurrentUser(r.Context(), r)
	if err != nil {
		user = nil
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		writeError(w, http.StatusBadRequest, "举报内容格式无效。")
		return
	}
	reason, _ := input["reason"].(string)
	detail, _ := input["detail"].(string)
	if err := s.Gallery.Report(r.Context(), r, user, r.PathValue("id"), reason, detail); err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"received": true})
}

func (s *Server) handleGalleryAvatar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	identity, err := s.Media.Identify(ctx, w, r)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	if err := s.Gallery.ServeAvatar(ctx, w, r, identity); err != nil {
		var safe *media.Error
		if errors.As(err, &safe) {
			media.WriteFailure(w, safe, r.Method == http.MethodHead)
			return
		}
		media.WriteFailure(w, &media.Error{Status: http.StatusServiceUnavailable, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}, r.Method == http.MethodHead)
	}
}

func (s *Server) handleGalleryBanner(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	identity, err := s.Media.Identify(ctx, w, r)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	if err := s.Gallery.ServeBanner(ctx, w, r, identity); err != nil {
		var safe *media.Error
		if errors.As(err, &safe) {
			media.WriteFailure(w, safe, r.Method == http.MethodHead)
			return
		}
		media.WriteFailure(w, &media.Error{Status: http.StatusServiceUnavailable, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}, r.Method == http.MethodHead)
	}
}

func (s *Server) handleGalleryMedia(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	identity, err := s.Media.Identify(ctx, w, r)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	if err := s.Gallery.ServePublished(ctx, w, r, identity); err != nil {
		var safe *media.Error
		if errors.As(err, &safe) {
			media.WriteFailure(w, safe, r.Method == http.MethodHead)
			return
		}
		media.WriteFailure(w, &media.Error{Status: http.StatusServiceUnavailable, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}, r.Method == http.MethodHead)
	}
}
