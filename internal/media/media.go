// Package media 提供私有媒体身份、上传、额度、下载与公开作品代理。
package media

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"olai/internal/auth"
	"olai/internal/httpx"
	"olai/internal/oss"
	"olai/internal/settings"
	"olai/internal/store"
)

const DeviceCookie = "olai_media_device"

var uuidRE = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
var attachmentRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,250}$`)

type MimeInfo struct {
	Extension string
	Download  bool
}

var MimeTypes = map[string]MimeInfo{
	"image/png": {Extension: "png"}, "image/jpeg": {Extension: "jpg"},
	"image/webp": {Extension: "webp"}, "image/gif": {Extension: "gif"},
	"image/avif": {Extension: "avif"}, "image/bmp": {Extension: "bmp"},
	"audio/mpeg": {Extension: "mp3"}, "audio/mp3": {Extension: "mp3"},
	"audio/mp4": {Extension: "m4a"}, "audio/aac": {Extension: "aac"},
	"audio/wav": {Extension: "wav"}, "audio/x-wav": {Extension: "wav"},
	"audio/ogg": {Extension: "ogg"}, "audio/webm": {Extension: "webm"},
	"audio/flac": {Extension: "flac"}, "audio/x-flac": {Extension: "flac"},
	"video/mp4": {Extension: "mp4"}, "video/webm": {Extension: "webm"},
	"video/quicktime": {Extension: "mov"}, "video/ogg": {Extension: "ogv"},
	"text/plain": {Extension: "txt", Download: true},
	"text/lrc":   {Extension: "lrc", Download: true}, "application/x-lrc": {Extension: "lrc", Download: true},
	"application/json":     {Extension: "json", Download: true},
	"application/x-subrip": {Extension: "srt", Download: true}, "text/srt": {Extension: "srt", Download: true},
}

type Error struct {
	Status     int
	Code       string
	Message    string
	RetryAfter int
}

func (e *Error) Error() string { return e.Message }

func unavailable() *Error {
	return &Error{Status: 503, Code: "MEDIA_UNAVAILABLE", Message: "私有媒体服务暂不可用。"}
}

func denied() *Error {
	return &Error{Status: 404, Code: "MEDIA_NOT_FOUND", Message: "媒体不存在或无权访问。"}
}

func quotaError(bytes, reading bool) *Error {
	if bytes {
		label := "上传"
		if reading {
			label = "浏览"
		}
		now := time.Now()
		midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).Add(24 * time.Hour)
		seconds := int(midnight.Sub(now).Seconds())
		if seconds < 1 {
			seconds = 1
		}
		return &Error{Status: 429, Code: "MEDIA_LIMIT", Message: fmt.Sprintf("今日媒体%s流量已达上限，请明日再试或联系管理员调整额度。", label), RetryAfter: seconds}
	}
	return &Error{Status: 429, Code: "MEDIA_LIMIT", Message: "媒体访问过于频繁，请 60 秒后重试。", RetryAfter: 60}
}

type Identity struct {
	Owner      string
	GuestOwner string
	UserID     string
	Origin     string
	IPHash     string
}

type Manager struct {
	DB       *store.DB
	Settings *settings.Manager
	OSS      *oss.Manager
	Auth     *auth.Manager

	activeUploads atomic.Int64
}

func (m *Manager) Enabled() bool { return m.OSS.Enabled() }

func NormalizeMime(value string) (string, error) {
	mime := strings.ToLower(strings.TrimSpace(strings.SplitN(value, ";", 2)[0]))
	if _, ok := MimeTypes[mime]; !ok {
		return "", &Error{Status: 415, Code: "MEDIA_TYPE", Message: "不支持此媒体类型。"}
	}
	return mime, nil
}

func Attachment(value string) (string, error) {
	if !attachmentRE.MatchString(value) {
		return "", &Error{Status: 400, Code: "MEDIA_ATTACHMENT", Message: "附件编号无效。"}
	}
	return value, nil
}

func (m *Manager) destinationOrigin(r *http.Request) (string, error) {
	if configured := m.Settings.SiteOrigin(); configured != "" {
		parsed, err := url.Parse(configured)
		if err != nil {
			return "", unavailable()
		}
		return parsed.Scheme + "://" + parsed.Host, nil
	}
	host := r.Header.Get("Host")
	if host == "" {
		host = r.Host
	}
	if host == "" {
		return "", unavailable()
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + host, nil
}

func (m *Manager) AssertMediaOrigin(r *http.Request, upload bool) error {
	origin, err := m.destinationOrigin(r)
	if err != nil {
		return err
	}
	return m.AssertOrigin(r, origin, upload)
}

func (m *Manager) AssertOrigin(r *http.Request, origin string, upload bool) error {
	site := r.Header.Get("Sec-Fetch-Site")
	if site != "" && site != "same-origin" && site != "none" {
		return &Error{Status: 403, Code: "MEDIA_ORIGIN", Message: "不允许跨站调用。"}
	}
	if upload && !httpx.SameOrigin(r, m.Settings) {
		return &Error{Status: 403, Code: "MEDIA_ORIGIN", Message: "不允许跨站调用。"}
	}
	for _, name := range []string{"Origin", "Referer"} {
		value := r.Header.Get(name)
		if value == "" {
			continue
		}
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme+"://"+parsed.Host != origin || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
			return &Error{Status: 403, Code: "MEDIA_ORIGIN", Message: "不允许跨站调用。"}
		}
		if name == "Origin" && value != parsed.Scheme+"://"+parsed.Host {
			return &Error{Status: 403, Code: "MEDIA_ORIGIN", Message: "不允许跨站调用。"}
		}
	}
	return nil
}

// Identify derives the owner from the signed-in account or an HttpOnly device
// cookie bound to the client IP. A switched account cannot reuse the old
// identity, because the client sends X-Olai-User on every media request.
func (m *Manager) Identify(ctx context.Context, w http.ResponseWriter, r *http.Request) (Identity, error) {
	ip, err := httpx.ClientIP(r, m.Settings)
	if err != nil {
		return Identity{}, &Error{Status: 400, Code: "MEDIA_IDENTITY", Message: "无法确定媒体访问身份。"}
	}
	device := ""
	if cookie, err := r.Cookie(DeviceCookie); err == nil {
		device = cookie.Value
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(device) {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			return Identity{}, unavailable()
		}
		device = hex.EncodeToString(buf)
		origin, err := m.destinationOrigin(r)
		if err != nil {
			return Identity{}, err
		}
		http.SetCookie(w, &http.Cookie{
			Name: DeviceCookie, Value: device, Path: "/", HttpOnly: true,
			SameSite: http.SameSiteLaxMode, Secure: strings.HasPrefix(origin, "https:"),
			MaxAge: 365 * 86400,
		})
	}
	user, err := m.Auth.CurrentUser(ctx, r)
	if err != nil {
		return Identity{}, unavailable()
	}
	expected := r.Header.Get("X-Olai-User")
	if expected != "" && expected != "guest" && (user == nil || expected != user.ID) {
		return Identity{}, &Error{Status: 409, Code: "MEDIA_ACCOUNT_CHANGED", Message: "账号已切换，请刷新页面后继续。"}
	}
	if expected == "guest" && user != nil {
		return Identity{}, &Error{Status: 409, Code: "MEDIA_ACCOUNT_CHANGED", Message: "账号已切换，请刷新页面后继续。"}
	}
	guestOwner := "guest:" + httpx.Hash(ip+"|"+device)
	owner := guestOwner
	userID := ""
	if user != nil {
		userID = user.ID
		owner = "user:" + user.ID
	}
	origin, err := m.destinationOrigin(r)
	if err != nil {
		return Identity{}, err
	}
	return Identity{Owner: owner, GuestOwner: guestOwner, UserID: userID, Origin: origin, IPHash: httpx.Hash(ip)}, nil
}

func publicMedia(row *store.MediaObject) map[string]any {
	return map[string]any{"id": row.ID, "url": "/api/media/" + row.ID, "mime": row.Mime, "size": row.Size}
}

func userPart(identity Identity) (string, error) {
	if identity.UserID != "" {
		if !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`).MatchString(identity.UserID) {
			return "", &Error{Status: 400, Code: "MEDIA_IDENTITY", Message: "无法确定媒体访问身份。"}
		}
		if identity.Owner != "user:"+identity.UserID {
			return "", &Error{Status: 400, Code: "MEDIA_IDENTITY", Message: "无法确定媒体访问身份。"}
		}
		return identity.UserID, nil
	}
	if !regexp.MustCompile(`^guest:[a-f0-9]{64}$`).MatchString(identity.GuestOwner) || identity.Owner != identity.GuestOwner {
		return "", &Error{Status: 400, Code: "MEDIA_IDENTITY", Message: "无法确定媒体访问身份。"}
	}
	return "guest-" + identity.GuestOwner[6:], nil
}

// Store stores bytes under an opaque handle deduplicated by owner, attachment,
// content digest and MIME.
func (m *Manager) Store(ctx context.Context, bytes []byte, mime, attachmentID string, identity Identity) (*store.MediaObject, error) {
	if !m.Enabled() {
		return nil, unavailable()
	}
	normalized, err := NormalizeMime(mime)
	if err != nil {
		return nil, err
	}
	mime = normalized
	if attachmentID, err = Attachment(attachmentID); err != nil {
		return nil, err
	}
	prefix, maxFileBytes, err := m.OSS.SettingsForMedia()
	if err != nil {
		return nil, unavailable()
	}
	if len(bytes) == 0 || int64(len(bytes)) > maxFileBytes {
		return nil, &Error{Status: 413, Code: "MEDIA_SIZE", Message: "媒体为空或超过大小限制。"}
	}
	part, err := userPart(identity)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(bytes)
	sha := hex.EncodeToString(sum[:])
	existing, err := m.DB.MediaByIdentity(ctx, identity.Owner, attachmentID, sha, mime)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return nil, unavailable()
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return nil, unavailable()
	}
	id := formatUUID(buf)
	stamp := time.Now().UTC().Format("20060102T150405Z")
	objectKey := prefix + "/" + part + "/" + stamp + "/" + id + "-" + attachmentID + "." + MimeTypes[mime].Extension
	row := store.MediaObject{
		ID: id, ObjectKey: objectKey, Owner: identity.Owner, AttachmentID: attachmentID,
		Mime: mime, Size: int64(len(bytes)), SHA256: sha, CreatedAt: time.Now().UnixMilli(),
	}
	if err := m.OSS.Put(objectKey, bytes, mime); err != nil {
		return nil, unavailable()
	}
	winner, inserted, err := m.DB.InsertMediaIfAbsent(ctx, row)
	if err != nil {
		_ = m.OSS.Delete(objectKey)
		return nil, unavailable()
	}
	if inserted {
		return &row, nil
	}
	_ = m.OSS.Delete(objectKey)
	if winner == nil {
		return nil, unavailable()
	}
	return winner, nil
}

func formatUUID(buf []byte) string {
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16])
}

// MediaURLPath resolves only this site's opaque media handles.
func (m *Manager) MediaURLPath(value string, identity Identity) string {
	path := value
	if !strings.HasPrefix(path, "/") {
		configured := m.Settings.SiteOrigin()
		origin := identity.Origin
		if configured != "" {
			if parsed, err := url.Parse(configured); err == nil {
				origin = parsed.Scheme + "://" + parsed.Host
			}
		}
		parsed, err := url.Parse(value)
		if err != nil || origin == "" || parsed.Scheme+"://"+parsed.Host != origin || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return ""
		}
		path = parsed.Path
	} else if index := strings.IndexAny(path, "?#"); index >= 0 {
		path = path[:index]
	}
	if !strings.HasPrefix(path, "/api/media/") {
		return ""
	}
	id := strings.ToLower(path[len("/api/media/"):])
	if !uuidRE.MatchString(id) {
		return ""
	}
	return "/api/media/" + id
}

func (m *Manager) ClaimMediaURLs(ctx context.Context, value any, identity Identity) error {
	ids := map[string]bool{}
	stack := []any{value}
	visited := 0
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		visited++
		if visited > 100000 {
			return &Error{Status: 400, Code: "MEDIA_REFERENCES", Message: "媒体引用无效或过多。"}
		}
		switch typed := node.(type) {
		case string:
			if path := m.MediaURLPath(typed, identity); path != "" {
				ids[strings.TrimPrefix(path, "/api/media/")] = true
			}
		case map[string]any:
			for _, entry := range typed {
				stack = append(stack, entry)
			}
			if len(ids) > 1000 {
				return &Error{Status: 400, Code: "MEDIA_REFERENCES", Message: "媒体引用无效或过多。"}
			}
		case []any:
			stack = append(stack, typed...)
			if len(ids) > 1000 {
				return &Error{Status: 400, Code: "MEDIA_REFERENCES", Message: "媒体引用无效或过多。"}
			}
		}
		if len(ids) > 1000 {
			return &Error{Status: 400, Code: "MEDIA_REFERENCES", Message: "媒体引用无效或过多。"}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	if !m.Enabled() {
		return unavailable()
	}
	if identity.UserID == "" || identity.Owner != "user:"+identity.UserID {
		return denied()
	}
	list := make([]string, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	if err := m.DB.ClaimMediaIDs(ctx, list, identity.GuestOwner, identity.Owner); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return denied()
		}
		return unavailable()
	}
	return nil
}

// ---- budgets ----

func (m *Manager) budget(ctx context.Context, identity Identity, bytes *int64, reading bool) error {
	scopes := []string{identity.Owner}
	if identity.IPHash != "" {
		scopes = append(scopes, "ip:"+identity.IPHash)
	}
	now := time.Now()
	var keys []string
	var amount, limit, expires int64
	if bytes == nil {
		minute := now.Unix() / 60
		value := 60
		if reading {
			value = m.Settings.Int("OSS_MEDIA_READ_RATE_LIMIT", 60)
		} else {
			value = m.Settings.Int("OSS_MEDIA_RATE_LIMIT", 60)
		}
		if value <= 0 {
			return quotaError(false, reading)
		}
		limit = int64(value)
		amount = 1
		expires = now.Add(2 * time.Minute).UnixMilli()
		for _, scope := range scopes {
			prefix := scope
			if reading {
				prefix = "read:" + scope
			}
			keys = append(keys, httpx.Hash("media:"+prefix+":minute:"+itoa64(minute)))
		}
	} else {
		day := now.UTC().Format("2006-01-02")
		value := m.Settings.Int("OSS_MEDIA_DAILY_BYTES", 1024*1024*1024)
		if reading {
			value = m.Settings.Int("OSS_MEDIA_READ_DAILY_BYTES", 1024*1024*1024)
		}
		if value <= 0 {
			return quotaError(true, reading)
		}
		limit = int64(value)
		amount = *bytes
		if amount < 0 || int64(int32(amount)) != amount && amount > 1<<40 {
			return &Error{Status: 400, Code: "MEDIA_SIZE", Message: "媒体大小无效。"}
		}
		expires = now.Add(48 * time.Hour).UnixMilli()
		for _, scope := range scopes {
			prefix := scope
			if reading {
				prefix = "read:" + scope
			}
			keys = append(keys, httpx.Hash("media:"+prefix+":bytes:"+day))
		}
	}
	ok, err := m.DB.ReserveMany(ctx, keys, amount, limit, expires)
	if err != nil {
		return unavailable()
	}
	if !ok {
		return quotaError(bytes != nil, reading)
	}
	return nil
}

func itoa64(value int64) string { return fmt.Sprintf("%d", value) }

func (m *Manager) ReserveUpload(ctx context.Context, identity Identity) error {
	if !m.Enabled() {
		return unavailable()
	}
	if err := m.budget(ctx, identity, nil, false); err != nil {
		return err
	}
	return m.budget(ctx, identity, int64Ptr(0), false)
}

func (m *Manager) ReserveBytes(ctx context.Context, identity Identity, bytes int64) error {
	if !m.Enabled() {
		return unavailable()
	}
	if bytes < 0 {
		return &Error{Status: 400, Code: "MEDIA_SIZE", Message: "媒体大小无效。"}
	}
	return m.budget(ctx, identity, &bytes, false)
}

func int64Ptr(value int64) *int64 { return &value }

// ---- upload ----

func (m *Manager) Upload(ctx context.Context, w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	if !m.Enabled() {
		return nil, unavailable()
	}
	identity, err := m.Identify(ctx, w, r)
	if err != nil {
		return nil, err
	}
	if err := m.AssertOrigin(r, identity.Origin, true); err != nil {
		return nil, err
	}
	mime, err := NormalizeMime(r.Header.Get("Content-Type"))
	if err != nil {
		return nil, err
	}
	attachmentID, err := Attachment(r.Header.Get("X-Olai-Attachment-ID"))
	if err != nil {
		return nil, err
	}
	if err := m.ReserveUpload(ctx, identity); err != nil {
		return nil, err
	}
	if m.activeUploads.Load() >= 4 {
		return nil, &Error{Status: 429, Code: "MEDIA_LIMIT", Message: "同时上传的文件较多，请稍后重试。", RetryAfter: 5}
	}
	m.activeUploads.Add(1)
	defer m.activeUploads.Add(-1)
	_, maxBytes, err := m.OSS.SettingsForMedia()
	if err != nil {
		return nil, unavailable()
	}
	bytes, err := readUpload(r, maxBytes)
	if err != nil {
		return nil, err
	}
	if err := m.ReserveBytes(ctx, identity, int64(len(bytes))); err != nil {
		return nil, err
	}
	row, err := m.Store(ctx, bytes, mime, attachmentID, identity)
	if err != nil {
		return nil, err
	}
	return publicMedia(row), nil
}

func readUpload(r *http.Request, maxBytes int64) ([]byte, error) {
	if declared := r.Header.Get("Content-Length"); declared != "" {
		if !regexp.MustCompile(`^\d+$`).MatchString(declared) {
			return nil, &Error{Status: 413, Code: "MEDIA_SIZE", Message: "媒体为空或超过大小限制。"}
		}
		var value int64
		_, _ = fmt.Sscan(declared, &value)
		if value > maxBytes {
			return nil, &Error{Status: 413, Code: "MEDIA_SIZE", Message: "媒体为空或超过大小限制。"}
		}
	}
	if r.Body == nil {
		return nil, &Error{Status: 400, Code: "MEDIA_BODY", Message: "媒体内容为空。"}
	}
	timedOut := atomic.Bool{}
	timer := time.AfterFunc(60*time.Second, func() {
		timedOut.Store(true)
		_ = r.Body.Close()
	})
	defer timer.Stop()
	bytes, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
	if err != nil {
		if timedOut.Load() {
			return nil, &Error{Status: 408, Code: "MEDIA_TIMEOUT", Message: "媒体上传超时，请重试。"}
		}
		return nil, &Error{Status: 400, Code: "MEDIA_BODY", Message: "媒体内容为空。"}
	}
	if int64(len(bytes)) > maxBytes {
		return nil, &Error{Status: 413, Code: "MEDIA_SIZE", Message: "媒体为空或超过大小限制。"}
	}
	if len(bytes) == 0 {
		return nil, &Error{Status: 400, Code: "MEDIA_BODY", Message: "媒体内容为空。"}
	}
	return bytes, nil
}

// ReadMediaBody buffers an upstream media response within the configured object
// size limit. Streaming providers may omit Content-Length, so the reader is
// always bounded explicitly.
func (m *Manager) ReadMediaBody(reader io.Reader, declared int64) ([]byte, error) {
	_, maxBytes, err := m.OSS.SettingsForMedia()
	if err != nil {
		return nil, unavailable()
	}
	if declared > maxBytes {
		return nil, &Error{Status: 413, Code: "MEDIA_SIZE", Message: "媒体文件超过上传大小限制。"}
	}
	if reader == nil {
		return nil, &Error{Status: 502, Code: "MEDIA_BODY", Message: "媒体内容为空。"}
	}
	data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, &Error{Status: 502, Code: "MEDIA_BODY", Message: "媒体内容读取失败。"}
	}
	if int64(len(data)) > maxBytes {
		return nil, &Error{Status: 413, Code: "MEDIA_SIZE", Message: "媒体文件超过上传大小限制。"}
	}
	if len(data) == 0 {
		return nil, &Error{Status: 502, Code: "MEDIA_BODY", Message: "媒体内容为空。"}
	}
	return data, nil
}

// LookupForOwner finds a media row visible to this identity: own objects plus
// guest objects that may be claimed by the signed-in account.
func (m *Manager) LookupForOwner(ctx context.Context, identity Identity, id string) (*store.MediaObject, error) {
	id = strings.ToLower(id)
	if !uuidRE.MatchString(id) {
		return nil, denied()
	}
	row, err := m.DB.MediaByID(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return nil, denied()
	}
	if err != nil {
		return nil, unavailable()
	}
	if row.Owner != identity.Owner && (identity.UserID == "" || row.Owner != identity.GuestOwner) {
		return nil, denied()
	}
	return row, nil
}
