package server

import (
	"net/http"
	"regexp"
	"time"
	"unicode/utf8"

	"olai/internal/gallery"
	"olai/internal/secure"
	"olai/internal/store"
)

func (s *Server) handleInbox(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	items, err := s.DB.Inbox(r.Context(), user.ID, 50, 0)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "私信暂不可用，请稍后重试。")
		return
	}
	unread, err := s.DB.UnreadMessageCount(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "私信暂不可用，请稍后重试。")
		return
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"id": item.ConversationID,
			"with": map[string]any{
				"id": item.OtherHandle, "name": publicProfileName(item.OtherName), "avatar": gallery.PublicAvatar(item.OtherUserID, item.OtherAvatar),
			},
			"last": item.LastBody, "mine": item.LastSenderID == user.ID,
			"updatedAt": item.UpdatedAt, "unread": item.Unread,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversations": out, "unread": unread})
}

func (s *Server) handleConversation(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	profile, ok := s.profileByHandle(w, r)
	if !ok {
		return
	}
	if profile.UserID == user.ID {
		writeError(w, http.StatusBadRequest, "不能给自己发私信。")
		return
	}
	blocked, err := s.DB.BlockedEither(r.Context(), user.ID, profile.UserID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "私信暂不可用，请稍后重试。")
		return
	}
	if blocked {
		writeError(w, http.StatusForbidden, "无法给这位用户发私信。")
		return
	}
	if r.Method == http.MethodPost && !profile.AllowMessages {
		writeError(w, http.StatusForbidden, "这位用户没有开放私信。")
		return
	}
	conversation, err := s.DB.OpenConversation(r.Context(), secure.ID(), user.ID, profile.UserID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "私信暂不可用，请稍后重试。")
		return
	}
	if r.Method == http.MethodPost {
		input, err := readJSONObject(r, 16*1024)
		if err != nil {
			writeError(w, http.StatusBadRequest, "私信格式无效。")
			return
		}
		body, _ := input["body"].(string)
		body = cleanText(body, messageMax)
		if body == "" || utf8.RuneCountInString(body) > messageMax {
			writeError(w, http.StatusBadRequest, "私信不能为空，也不能超过 2000 字。")
			return
		}
		message := store.DirectMessage{
			ID: secure.ID(), ConversationID: conversation.ID, SenderID: user.ID,
			Body: body, CreatedAt: time.Now().UnixMilli(),
		}
		if err := s.DB.AddDirectMessage(r.Context(), message); err != nil {
			writeError(w, http.StatusServiceUnavailable, "私信暂不可用，请稍后重试。")
			return
		}
	}
	messages, err := s.DB.DirectMessages(r.Context(), conversation.ID, 50, 0)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "私信暂不可用，请稍后重试。")
		return
	}
	_ = s.DB.MarkConversationRead(r.Context(), conversation.ID, user.ID, time.Now().UnixMilli())
	out := make([]any, 0, len(messages))
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		out = append(out, map[string]any{
			"id": message.ID, "body": message.Body, "mine": message.SenderID == user.ID, "createdAt": message.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": conversation.ID, "messages": out})
}

func (s *Server) handleFavoriteFolders(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		folders, err := s.DB.FavoriteFolders(r.Context(), user.ID)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "收藏分类暂不可用，请稍后重试。")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"folders": folderPayloads(folders)})
	case http.MethodPost:
		input, err := readJSONObject(r, 8*1024)
		if err != nil {
			writeError(w, http.StatusBadRequest, "分类格式无效。")
			return
		}
		name, _ := input["name"].(string)
		name = cleanText(name, folderNameMax)
		if name == "" {
			writeError(w, http.StatusBadRequest, "请填写分类名称。")
			return
		}
		existing, err := s.DB.FavoriteFolders(r.Context(), user.ID)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "收藏分类暂不可用，请稍后重试。")
			return
		}
		if len(existing) >= folderLimit {
			writeError(w, http.StatusBadRequest, "收藏分类已达上限。")
			return
		}
		folder := store.FavoriteFolder{ID: secure.ID(), UserID: user.ID, Name: name, CreatedAt: time.Now().UnixMilli()}
		if err := s.DB.CreateFavoriteFolder(r.Context(), folder); err != nil {
			writeError(w, http.StatusConflict, "已有同名分类。")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"folder": folderPayload(folder)})
	default:
		writeError(w, http.StatusNotFound, "接口不存在。")
	}
}

func (s *Server) handleFavoriteFolder(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !folderIDPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "找不到这个分类。")
		return
	}
	switch r.Method {
	case http.MethodPut:
		input, err := readJSONObject(r, 8*1024)
		if err != nil {
			writeError(w, http.StatusBadRequest, "分类格式无效。")
			return
		}
		name, _ := input["name"].(string)
		name = cleanText(name, folderNameMax)
		if name == "" {
			writeError(w, http.StatusBadRequest, "请填写分类名称。")
			return
		}
		renamed, err := s.DB.RenameFavoriteFolder(r.Context(), id, user.ID, name)
		if err != nil {
			writeError(w, http.StatusConflict, "已有同名分类。")
			return
		}
		if !renamed {
			writeError(w, http.StatusNotFound, "找不到这个分类。")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case http.MethodDelete:
		removed, err := s.DB.DeleteFavoriteFolder(r.Context(), id, user.ID)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "收藏分类暂不可用，请稍后重试。")
			return
		}
		if !removed {
			writeError(w, http.StatusNotFound, "找不到这个分类。")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeError(w, http.StatusNotFound, "接口不存在。")
	}
}

func (s *Server) handleFavoritePlacement(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	key, ok := galleryRecordKey(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "作品不存在或已被隐藏。")
		return
	}
	input, err := readJSONObject(r, 4*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "分类格式无效。")
		return
	}
	folder, _ := input["folder"].(string)
	if folder != "" && !folderIDPattern.MatchString(folder) {
		writeError(w, http.StatusBadRequest, "收藏分类无效。")
		return
	}
	owned, err := s.DB.FavoriteFolderOwned(r.Context(), folder, user.ID)
	if err != nil || !owned {
		writeError(w, http.StatusBadRequest, "收藏分类无效。")
		return
	}
	moved, err := s.DB.SetFavoriteFolder(r.Context(), user.ID, key, folder)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "收藏分类暂不可用，请稍后重试。")
		return
	}
	if !moved {
		writeError(w, http.StatusNotFound, "请先收藏这件作品。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "folder": folder})
}

func (s *Server) handleRecordVisibility(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	key, ok := galleryRecordKey(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "作品不存在。")
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

var folderIDPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

func galleryRecordKey(id string) (string, bool) {
	const prefix = "gallery_"
	if len(id) != len(prefix)+64 || id[:len(prefix)] != prefix {
		return "", false
	}
	key := id[len(prefix):]
	for _, char := range key {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return "", false
		}
	}
	return key, true
}

func folderPayload(folder store.FavoriteFolder) map[string]any {
	return map[string]any{"id": folder.ID, "name": folder.Name, "count": folder.Count, "createdAt": folder.CreatedAt}
}

func folderPayloads(folders []store.FavoriteFolder) []any {
	out := make([]any, 0, len(folders))
	for _, folder := range folders {
		out = append(out, folderPayload(folder))
	}
	return out
}
