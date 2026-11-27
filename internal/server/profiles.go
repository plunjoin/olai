package server

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"olai/internal/gallery"
	"olai/internal/store"
)

const (
	handleMin       = 3
	handleMax       = 20
	bioMax          = 160
	websiteMax      = 200
	folderNameMax   = 24
	messageMax      = 2000
	folderLimit     = 50
	profilePageSize = 24
)

var handlePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$`)

var reservedHandles = map[string]bool{
	"admin": true, "api": true, "account": true, "login": true, "setup": true,
	"gallery": true, "download": true, "chat": true, "image": true, "video": true,
	"music": true, "library": true, "workflow": true, "messages": true, "me": true,
	"u": true, "user": true, "users": true, "settings": true, "olai": true,
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (*store.SessionUser, bool) {
	// Reads use the session cookie too, but browsers do not attach Origin to
	// ordinary same-origin GETs. Only state-changing requests need the CSRF
	// origin check here.
	if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return nil, false
	}
	user, err := s.Auth.CurrentUser(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return nil, false
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录。")
		return nil, false
	}
	return user, true
}

func validHandle(value string) bool {
	if len(value) < handleMin || len(value) > handleMax || strings.Contains(value, "--") {
		return false
	}
	if reservedHandles[value] || !handlePattern.MatchString(value) {
		return false
	}
	return true
}

// defaultHandle derives a stable public id from the account id so a profile
// exists before the owner picks one. It stays inside the published alphabet.
func defaultHandle(userID string) string {
	clean := strings.Map(func(value rune) rune {
		if value >= '0' && value <= '9' || value >= 'a' && value <= 'z' {
			return value
		}
		return -1
	}, strings.ToLower(userID))
	if len(clean) > 12 {
		clean = clean[:12]
	}
	if clean == "" {
		clean = "user"
	}
	handle := "u-" + clean
	if !validHandle(handle) {
		return "u-member"
	}
	return handle
}

func cleanText(value string, limit int) string {
	var builder strings.Builder
	space := false
	for _, r := range value {
		if r < 0x20 || r == 0x7f || unicode.IsSpace(r) {
			space = true
			continue
		}
		if space && builder.Len() > 0 {
			builder.WriteByte(' ')
		}
		space = false
		builder.WriteRune(r)
		if utf8.RuneCountInString(builder.String()) >= limit {
			break
		}
	}
	return builder.String()
}

func validWebsite(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > websiteMax {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	return parsed.Scheme == "https" || parsed.Scheme == "http"
}

func (s *Server) loadProfile(ctx context.Context, userID string) (store.Profile, error) {
	profile, err := s.DB.ProfileByUser(ctx, userID)
	if err == nil {
		return *profile, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return store.Profile{}, err
	}
	// The default handle is a real public address: persist it before returning
	// so the link shown in the account center cannot lead to a 404.
	if _, err := s.DB.EnsureProfile(ctx, userID, defaultHandle(userID)); err != nil {
		return store.Profile{}, err
	}
	profile, err = s.DB.ProfileByUser(ctx, userID)
	if err != nil {
		return store.Profile{}, err
	}
	return *profile, nil
}

func boolField(input map[string]any, name string, fallback bool) bool {
	value, ok := input[name]
	if !ok {
		return fallback
	}
	flag, ok := value.(bool)
	if !ok {
		return fallback
	}
	return flag
}

// bannerUploadPrefix marks a cover that lives in the media store.
const bannerUploadPrefix = "upload:"

// bannerUploadMax keeps a cover small enough to serve as a band.
const bannerUploadMax = 4 * 1024 * 1024

// bannerThemes lists the preset cover tones the client offers.
var bannerThemes = map[string]bool{
	"sand": true, "sky": true, "mint": true, "lilac": true, "dusk": true, "slate": true,
}

// bannerIDRE matches the uuid stored after "upload:" for an uploaded cover.
var bannerIDRE = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

// errBannerInvalid marks a cover the owner picked that cannot be used.
var errBannerInvalid = errors.New("banner invalid")

// resolveBanner validates a cover the owner picked. An empty value clears the
// cover; a preset tone is kept as-is; an upload must point at an image the
// account owns and that was stored as a cover.
func (s *Server) resolveBanner(ctx context.Context, userID string, raw any, current string) (string, error) {
	if raw == nil {
		return current, nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", errBannerInvalid
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if bannerThemes[value] {
		return value, nil
	}
	if !strings.HasPrefix(value, bannerUploadPrefix) {
		return "", errBannerInvalid
	}
	id := strings.ToLower(strings.TrimPrefix(value, bannerUploadPrefix))
	if !bannerIDRE.MatchString(id) {
		return "", errBannerInvalid
	}
	row, err := s.DB.MediaByID(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return "", errBannerInvalid
	}
	if err != nil {
		return "", err
	}
	if row.Owner != "user:"+userID || row.AttachmentID != "banner" ||
		row.Size > bannerUploadMax || !strings.HasPrefix(row.Mime, "image/") {
		return "", errBannerInvalid
	}
	return bannerUploadPrefix + id, nil
}

func (s *Server) handleProfileGet(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	profile, err := s.loadProfile(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "个人资料暂不可用，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profilePayload(profile)})
}

// profilePayload is only ever sent to the owner, so the cover keeps its
// stored form: an upload stays "upload:<uuid>" and can be saved back as is.
// Visitors get the published form from handlePublicProfile instead.
func profilePayload(profile store.Profile) map[string]any {
	return map[string]any{
		"handle": profile.Handle, "bio": profile.Bio, "website": profile.Website,
		"showWorks": profile.ShowWorks, "showFavorites": profile.ShowFavorites,
		"showBio": profile.ShowBio, "showJoined": profile.ShowJoined,
		"showFollows": profile.ShowFollows, "allowMessages": profile.AllowMessages,
		"banner": profile.Banner,
	}
}

func (s *Server) handleProfileSave(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	input, err := readJSONObject(r, 16*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "资料格式无效。")
		return
	}
	current, err := s.loadProfile(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "个人资料暂不可用，请稍后重试。")
		return
	}
	handle := current.Handle
	if raw, exists := input["handle"]; exists {
		text, _ := raw.(string)
		handle = store.TrimHandle(text)
		if !validHandle(handle) {
			writeError(w, http.StatusBadRequest, "主页地址需要 3 到 20 位小写字母、数字或连字符。")
			return
		}
		taken, err := s.DB.HandleTaken(r.Context(), handle, user.ID)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "个人资料暂不可用，请稍后重试。")
			return
		}
		if taken {
			writeError(w, http.StatusConflict, "这个主页地址已被使用。")
			return
		}
	}
	bio := current.Bio
	if raw, exists := input["bio"]; exists {
		text, _ := raw.(string)
		bio = cleanText(text, bioMax)
	}
	website := current.Website
	if raw, exists := input["website"]; exists {
		text, _ := raw.(string)
		website = strings.TrimSpace(text)
		if !validWebsite(website) {
			writeError(w, http.StatusBadRequest, "个人网址需要是 http 或 https 链接。")
			return
		}
	}
	banner := current.Banner
	if raw, exists := input["banner"]; exists {
		resolved, err := s.resolveBanner(r.Context(), user.ID, raw, current.Banner)
		if err != nil {
			if errors.Is(err, errBannerInvalid) {
				writeError(w, http.StatusBadRequest, "封面选择无效。")
				return
			}
			writeError(w, http.StatusServiceUnavailable, "个人资料暂不可用，请稍后重试。")
			return
		}
		banner = resolved
	}
	next := store.Profile{
		UserID: user.ID, Handle: handle, Bio: bio, Website: website,
		ShowWorks:     boolField(input, "showWorks", current.ShowWorks),
		ShowFavorites: boolField(input, "showFavorites", current.ShowFavorites),
		ShowBio:       boolField(input, "showBio", current.ShowBio),
		ShowJoined:    boolField(input, "showJoined", current.ShowJoined),
		ShowFollows:   boolField(input, "showFollows", current.ShowFollows),
		AllowMessages: boolField(input, "allowMessages", current.AllowMessages),
		Banner:        banner,
		UpdatedAt:     time.Now().UnixMilli(),
	}
	if err := s.DB.SaveProfile(r.Context(), next); err != nil {
		writeError(w, http.StatusServiceUnavailable, "个人资料暂不可用，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profilePayload(next)})
}

// handlePublicProfile serves one profile to anyone. Hidden sections are simply
// absent; the response never says which switch closed them.
func (s *Server) handlePublicProfile(w http.ResponseWriter, r *http.Request) {
	handle := store.TrimHandle(r.PathValue("handle"))
	if !validHandle(handle) {
		writeError(w, http.StatusNotFound, "找不到这位用户。")
		return
	}
	profile, err := s.DB.ProfileByHandle(r.Context(), handle)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "找不到这位用户。")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "个人主页暂不可用，请稍后重试。")
		return
	}
	owner, err := s.DB.UserByID(r.Context(), profile.UserID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "个人主页暂不可用，请稍后重试。")
		return
	}
	viewer, _ := s.Auth.CurrentUser(r.Context(), r)
	self := viewer != nil && viewer.ID == profile.UserID
	blocked := false
	following := false
	if viewer != nil && !self {
		blocked, err = s.DB.BlockedEither(r.Context(), viewer.ID, profile.UserID)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "个人主页暂不可用，请稍后重试。")
			return
		}
		following, err = s.DB.IsFollowing(r.Context(), viewer.ID, profile.UserID)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "个人主页暂不可用，请稍后重试。")
			return
		}
	}
	name := ""
	if owner.Name != nil {
		name = *owner.Name
	}
	avatar := ""
	if owner.Avatar != nil {
		avatar = *owner.Avatar
	}
	result := map[string]any{
		"id":     profile.Handle,
		"name":   gallery.PublicAuthorName(store.DisplayName(name, owner.Email)),
		"avatar": gallery.PublicAvatar(profile.UserID, avatar),
		"banner": gallery.PublicBanner(profile.UserID, profile.Banner),
		"self":   self, "followingUser": following, "blocked": blocked,
	}
	if self || !blocked {
		if profile.ShowBio || self {
			result["bio"] = profile.Bio
			result["website"] = profile.Website
		}
		if profile.ShowJoined || self {
			result["joinedAt"] = owner.CreatedAt
		}
		if profile.ShowFollows || self {
			counts, err := s.DB.FollowCounts(r.Context(), profile.UserID)
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "个人主页暂不可用，请稍后重试。")
				return
			}
			result["followers"] = counts.Followers
			result["following"] = counts.Following
		}
		result["canMessage"] = (profile.AllowMessages || self) && !blocked && !self
		result["works"] = profile.ShowWorks || self
		result["favorites"] = (profile.ShowFavorites || self) && !blocked
		if profile.ShowWorks || self {
			stats, err := s.DB.AccountGalleryStats(r.Context(), profile.UserID)
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "个人主页暂不可用，请稍后重试。")
				return
			}
			result["workCount"] = stats.Works
			result["plays"] = stats.Plays
			result["likes"] = stats.Likes
			result["kindCounts"] = map[string]int64{
				"image": stats.Images, "video": stats.Videos, "music": stats.Music,
			}
		}
		if (profile.ShowFavorites || self) && !blocked {
			favoriteCount, err := s.DB.PublicFavoriteCount(r.Context(), profile.UserID)
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "个人主页暂不可用，请稍后重试。")
				return
			}
			result["favoriteCount"] = favoriteCount
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": result})
}

// handleUserSearch lists accounts a signed-in viewer can share a work with.
// It matches handles and display names; messaging-disabled, banned and blocked
// accounts stay out so every result can actually receive the share.
func (s *Server) handleUserSearch(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, http.StatusOK, map[string]any{"users": []any{}})
		return
	}
	if runes := []rune(query); len(runes) > 40 {
		query = string(runes[:40])
	}
	results, err := s.DB.SearchMessageUsers(r.Context(), user.ID, query, 20)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "搜索暂不可用，请稍后重试。")
		return
	}
	users := make([]any, 0, len(results))
	for _, result := range results {
		users = append(users, map[string]any{
			"id":     result.Handle,
			"name":   gallery.PublicAuthorName(store.DisplayName(result.Name, result.Email)),
			"avatar": gallery.PublicAvatar(result.UserID, result.Avatar),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (s *Server) profileByHandle(w http.ResponseWriter, r *http.Request) (*store.Profile, bool) {
	handle := store.TrimHandle(r.PathValue("handle"))
	profile, err := s.DB.ProfileByHandle(r.Context(), handle)
	if errors.Is(err, store.ErrNotFound) || !validHandle(handle) {
		writeError(w, http.StatusNotFound, "找不到这位用户。")
		return nil, false
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "个人主页暂不可用，请稍后重试。")
		return nil, false
	}
	return profile, true
}

func (s *Server) handleFollow(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	profile, ok := s.profileByHandle(w, r)
	if !ok {
		return
	}
	if profile.UserID == user.ID {
		writeError(w, http.StatusBadRequest, "不能关注自己。")
		return
	}
	blocked, err := s.DB.BlockedEither(r.Context(), user.ID, profile.UserID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "关注暂不可用，请稍后重试。")
		return
	}
	if blocked {
		writeError(w, http.StatusForbidden, "无法关注这位用户。")
		return
	}
	var following bool
	if r.Method == http.MethodDelete {
		if _, err = s.DB.Unfollow(r.Context(), user.ID, profile.UserID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "关注暂不可用，请稍后重试。")
			return
		}
	} else {
		following = true
		if _, err = s.DB.Follow(r.Context(), user.ID, profile.UserID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "关注暂不可用，请稍后重试。")
			return
		}
	}
	counts, err := s.DB.FollowCounts(r.Context(), profile.UserID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "关注暂不可用，请稍后重试。")
		return
	}
	result := map[string]any{"following": following}
	if profile.ShowFollows {
		result["followers"] = counts.Followers
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	profile, ok := s.profileByHandle(w, r)
	if !ok {
		return
	}
	if profile.UserID == user.ID {
		writeError(w, http.StatusBadRequest, "不能拉黑自己。")
		return
	}
	if r.Method == http.MethodDelete {
		if _, err := s.DB.Unblock(r.Context(), user.ID, profile.UserID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "拉黑暂不可用，请稍后重试。")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"blocked": false})
		return
	}
	if err := s.DB.Block(r.Context(), user.ID, profile.UserID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "拉黑暂不可用，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocked": true})
}

func (s *Server) handleProfileWorks(w http.ResponseWriter, r *http.Request) {
	profile, ok := s.profileByHandle(w, r)
	if !ok {
		return
	}
	viewer, _ := s.Auth.CurrentUser(r.Context(), r)
	self := viewer != nil && viewer.ID == profile.UserID
	if !profile.ShowWorks && !self {
		writeError(w, http.StatusNotFound, "这位用户没有公开作品。")
		return
	}
	if viewer != nil && !self {
		blocked, err := s.DB.BlockedEither(r.Context(), viewer.ID, profile.UserID)
		if err != nil || blocked {
			writeError(w, http.StatusNotFound, "这位用户没有公开作品。")
			return
		}
	}
	viewerID := ""
	if viewer != nil {
		viewerID = viewer.ID
	}
	result, err := s.Gallery.ListByOwner(r.Context(), r, profile.UserID, viewerID)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleProfileFavorites(w http.ResponseWriter, r *http.Request) {
	profile, ok := s.profileByHandle(w, r)
	if !ok {
		return
	}
	viewer, _ := s.Auth.CurrentUser(r.Context(), r)
	self := viewer != nil && viewer.ID == profile.UserID
	if !profile.ShowFavorites && !self {
		writeError(w, http.StatusNotFound, "这位用户没有公开收藏。")
		return
	}
	if viewer != nil && !self {
		blocked, err := s.DB.BlockedEither(r.Context(), viewer.ID, profile.UserID)
		if err != nil || blocked {
			writeError(w, http.StatusNotFound, "这位用户没有公开收藏。")
			return
		}
	}
	viewerID := ""
	if viewer != nil {
		viewerID = viewer.ID
	}
	result, err := s.Gallery.ListFavoritesOf(r.Context(), r, profile.UserID, viewerID)
	if err != nil {
		mediaFailure(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func publicProfileName(name string) string {
	clean := strings.Map(func(value rune) rune {
		if value < 0x20 || value == 0x7f {
			return -1
		}
		return value
	}, strings.TrimSpace(name))
	if clean == "" {
		return "Olai 用户"
	}
	runes := []rune(clean)
	if len(runes) > 40 {
		runes = runes[:40]
	}
	return string(runes)
}
