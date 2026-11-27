// Package server exposes the HTTP API and serves the webfront-built Vue SPA.
// All provider credentials, prompts and generated-media plumbing stay here;
// the browser only ever receives public models, prices and opaque handles.
package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"olai/internal/ai"
	"olai/internal/auth"
	"olai/internal/config"
	"olai/internal/gallery"
	"olai/internal/httpx"
	"olai/internal/mail"
	"olai/internal/media"
	"olai/internal/models"
	"olai/internal/oss"
	"olai/internal/pricing"
	"olai/internal/settings"
	"olai/internal/store"
)

type Server struct {
	Config   config.Config
	DB       *store.DB
	Settings *settings.Manager
	Auth     *auth.Manager
	Mail     *mail.Manager
	Pricing  *pricing.Manager
	Models   *models.Manager
	AI       *ai.Manager
	OSS      *oss.Manager
	Media    *media.Manager
	Gallery  *gallery.Manager

	Frontends *Frontends
	Public    fs.FS

	mux *http.ServeMux

	// dev 只在 -tags dev 构建里由 AttachDev 填充；生产构建始终为 nil，
	// 相关分支不会触达任何 esbuild/HMR 代码。
	dev *devFrontends

	chatMu       sync.Mutex
	chatActive   map[string]int
	siteUpdateMu sync.Mutex

	// 首页灵感卡片：每天每种语言生成一次，进程内缓存，数据库保存当日结果。
	suggestMu      sync.Mutex
	suggestCache   map[string]suggestionSet
	suggestRetryAt map[string]time.Time
	suggestPending map[string]bool

	setupMu       sync.Mutex
	setupChecked  time.Time
	setupRequired bool
}

func New(cfg config.Config, db *store.DB, frontends *Frontends, public fs.FS) *Server {
	s := &Server{
		Config: cfg, DB: db, Frontends: frontends, Public: public, chatActive: map[string]int{},
		suggestCache: map[string]suggestionSet{}, suggestRetryAt: map[string]time.Time{}, suggestPending: map[string]bool{},
	}
	s.Settings = settings.New(db)
	s.Auth = &auth.Manager{DB: db, Settings: s.Settings}
	s.Mail = &mail.Manager{Settings: s.Settings}
	s.Pricing = &pricing.Manager{Settings: s.Settings}
	s.Models = &models.Manager{DB: db, Settings: s.Settings, Pricing: s.Pricing}
	s.AI = &ai.Manager{Settings: s.Settings}
	s.OSS = &oss.Manager{Settings: s.Settings}
	s.Media = &media.Manager{DB: db, Settings: s.Settings, OSS: s.OSS, Auth: s.Auth}
	s.Gallery = &gallery.Manager{DB: db, Media: s.Media, Settings: s.Settings, AI: s.AI}
	s.mux = s.routes()
	return s
}

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	// First-run setup
	mux.HandleFunc("GET /api/setup/status", s.handleSetupStatus)
	mux.HandleFunc("POST /api/setup", s.handleSetup)
	// Creation proxy
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/version", s.handleVersion)
	mux.HandleFunc("GET /api/app/update", s.handleAppUpdate)
	mux.HandleFunc("GET /api/suggestions", s.handleSuggestions)
	mux.HandleFunc("POST /api/title", s.handleTitle)
	mux.HandleFunc("POST /api/chat/completions", s.handleProxy)
	mux.HandleFunc("POST /api/generate/{kind}", s.handleProxy)
	mux.HandleFunc("GET /api/videos/{id}", s.handleProxy)
	mux.HandleFunc("GET /api/videos/{id}/content", s.handleProxy)
	// Account
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("POST /api/auth/{action}", s.handleAuthAction)
	mux.HandleFunc("GET /api/auth/github", s.handleOAuthStart("github"))
	mux.HandleFunc("GET /api/auth/github/callback", s.handleOAuthCallback("github"))
	mux.HandleFunc("GET /api/auth/google", s.handleOAuthStart("google"))
	mux.HandleFunc("GET /api/auth/google/callback", s.handleOAuthCallback("google"))
	mux.HandleFunc("GET /api/models", s.handleModels)
	mux.HandleFunc("GET /api/points", s.handlePoints)
	// Long-term memory (account-scoped; used by chat system prompts)
	mux.HandleFunc("GET /api/memory", s.handleMemoryList)
	mux.HandleFunc("POST /api/memory", s.handleMemoryCreate)
	mux.HandleFunc("DELETE /api/memory", s.handleMemoryClear)
	mux.HandleFunc("PUT /api/memory/settings", s.handleMemorySettings)
	mux.HandleFunc("POST /api/memory/extract", s.handleMemoryExtract)
	mux.HandleFunc("PUT /api/memory/{id}", s.handleMemoryUpdate)
	mux.HandleFunc("DELETE /api/memory/{id}", s.handleMemoryDelete)
	// Records
	for _, method := range []string{"GET", "POST", "PUT", "DELETE"} {
		mux.HandleFunc(method+" /api/records/{store}", s.handleRecords)
	}
	mux.HandleFunc("PUT /api/records/{store}/{id}/visibility", s.handleStoredRecordVisibility)
	// Private media
	mux.HandleFunc("POST /api/media", s.handleMediaUpload)
	mux.HandleFunc("POST /api/media/import", s.handleMediaImport)
	mux.HandleFunc("GET /api/media/{id}", s.handleMediaDownload)
	// Public gallery
	mux.HandleFunc("GET /api/gallery", s.handleGallery)
	mux.HandleFunc("GET /api/gallery/media/{id}", s.handleGalleryMedia)
	mux.HandleFunc("GET /api/gallery/avatar/{id}", s.handleGalleryAvatar)
	mux.HandleFunc("GET /api/gallery/banner/{id}", s.handleGalleryBanner)
	mux.HandleFunc("PUT /api/gallery/{id}/favorite", s.handleGalleryFavorite)
	mux.HandleFunc("DELETE /api/gallery/{id}/favorite", s.handleGalleryFavorite)
	mux.HandleFunc("POST /api/gallery/favorites/import", s.handleGalleryFavoritesImport)
	mux.HandleFunc("POST /api/gallery/{id}/view", s.handleGalleryView)
	mux.HandleFunc("POST /api/gallery/{id}/download", s.handleGalleryDownload)
	mux.HandleFunc("GET /api/gallery/comments", s.handleGalleryComments)
	mux.HandleFunc("POST /api/gallery/comments", s.handleGalleryCommentCreate)
	mux.HandleFunc("POST /api/gallery/{id}/report", s.handleGalleryReport)
	mux.HandleFunc("PUT /api/gallery/{id}/visibility", s.handleRecordVisibility)
	mux.HandleFunc("PUT /api/gallery/{id}/meta", s.handleGalleryWorkMeta)
	mux.HandleFunc("PUT /api/gallery/{id}/folder", s.handleFavoritePlacement)
	mux.HandleFunc("GET /api/favorites/folders", s.handleFavoriteFolders)
	mux.HandleFunc("POST /api/favorites/folders", s.handleFavoriteFolders)
	mux.HandleFunc("PUT /api/favorites/folders/{id}", s.handleFavoriteFolder)
	mux.HandleFunc("DELETE /api/favorites/folders/{id}", s.handleFavoriteFolder)
	// Profiles, follows and direct messages
	mux.HandleFunc("GET /api/profile", s.handleProfileGet)
	mux.HandleFunc("PUT /api/profile", s.handleProfileSave)
	mux.HandleFunc("GET /api/messages", s.handleInbox)
	mux.HandleFunc("GET /api/users", s.handleUserSearch)
	mux.HandleFunc("GET /api/users/{handle}", s.handlePublicProfile)
	mux.HandleFunc("GET /api/users/{handle}/works", s.handleProfileWorks)
	mux.HandleFunc("GET /api/users/{handle}/favorites", s.handleProfileFavorites)
	mux.HandleFunc("PUT /api/users/{handle}/follow", s.handleFollow)
	mux.HandleFunc("DELETE /api/users/{handle}/follow", s.handleFollow)
	mux.HandleFunc("PUT /api/users/{handle}/block", s.handleBlock)
	mux.HandleFunc("DELETE /api/users/{handle}/block", s.handleBlock)
	mux.HandleFunc("GET /api/users/{handle}/messages", s.handleConversation)
	mux.HandleFunc("POST /api/users/{handle}/messages", s.handleConversation)
	// Admin console auth (independent of the portal account API)
	mux.HandleFunc("POST /api/admin/auth/login", s.handleAdminLogin)
	mux.HandleFunc("POST /api/admin/auth/logout", s.handleAdminLogout)
	mux.HandleFunc("POST /api/admin/auth/password", s.handleAdminPassword)
	// Admin
	mux.HandleFunc("GET /api/admin/overview", s.handleAdminOverview)
	mux.HandleFunc("GET /api/admin/works", s.handleAdminWorks)
	mux.HandleFunc("POST /api/admin/works", s.handleAdminWorkCreate)
	mux.HandleFunc("GET /api/admin/works/{id}", s.handleAdminWorkDetail)
	mux.HandleFunc("PUT /api/admin/works/{id}", s.handleAdminWorkUpdate)
	mux.HandleFunc("DELETE /api/admin/works/{id}", s.handleAdminWorkDelete)
	mux.HandleFunc("GET /api/admin/users", s.handleAdminUsers)
	mux.HandleFunc("GET /api/admin/users/{id}", s.handleAdminUser)
	mux.HandleFunc("POST /api/admin/users/{id}/ban", s.handleAdminBan)
	mux.HandleFunc("POST /api/admin/users/{id}/points", s.handleAdminPoints)
	mux.HandleFunc("GET /api/admin/generations", s.handleAdminGenerations)
	mux.HandleFunc("GET /api/admin/invites", s.handleAdminInvites)
	mux.HandleFunc("GET /api/admin/logs", s.handleAdminLogs)
	mux.HandleFunc("GET /api/admin/media", s.handleAdminMedia)
	mux.HandleFunc("DELETE /api/admin/media/{id}", s.handleAdminMediaDelete)
	mux.HandleFunc("GET /api/admin/models", s.handleAdminModels)
	mux.HandleFunc("POST /api/admin/models", s.handleAdminModelsSync)
	mux.HandleFunc("PUT /api/admin/models", s.handleAdminModelsSave)
	mux.HandleFunc("GET /api/admin/settings", s.handleAdminSettings)
	mux.HandleFunc("PUT /api/admin/settings", s.handleAdminSettingsSave)
	mux.HandleFunc("GET /api/admin/site-update", s.handleAdminSiteUpdate)
	mux.HandleFunc("POST /api/admin/site-update", s.handleAdminSiteUpdateStart)
	mux.HandleFunc("GET /api/admin/reports", s.handleAdminReports)
	mux.HandleFunc("POST /api/admin/reports/{id}", s.handleAdminReportAction)
	mux.HandleFunc("GET /api/admin/session", s.handleAdminSession)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "接口路径或方法不受支持。")
	})
	return mux
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if httpx.SecureRequest(r, s.Settings) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		// dev 模块/HMR 请求必须先于 setup 门禁：/@wf/client、/__wf_hmr 之类
		// 没有扩展名，否则首装阶段会被 302 到 /setup，开发外壳永远起不来。
		if s.serveDevInternal(w, r) {
			return
		}
		ctx := r.Context()
		if s.setupNeeded(ctx) && !setupAllowedPath(r.URL.Path) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				writeJSON(w, http.StatusPreconditionRequired, map[string]any{
					"error": map[string]any{"message": "站点尚未完成初始化。", "code": "setup_required"},
				})
				return
			}
			if r.Method == http.MethodGet || r.Method == http.MethodHead {
				w.Header().Set("Cache-Control", "no-store")
				http.Redirect(w, r, "/setup", http.StatusFound)
				return
			}
			http.Error(w, "站点尚未完成初始化。", http.StatusPreconditionRequired)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			s.Settings.Refresh(ctx, false)
			s.mux.ServeHTTP(w, r)
			return
		}
		s.Settings.Refresh(ctx, false)
		entry := s.Settings.AdminEntryPath()
		// Admin assets live at a fixed path even when the admin entry itself is
		// renamed, so they are handled before the old /admin block below.
		if strings.HasPrefix(r.URL.Path, "/admin/assets/") {
			if s.Frontends == nil || s.Frontends.AdminAssets == nil {
				http.NotFound(w, r)
				return
			}
			s.Frontends.AdminAssets.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			if s.Frontends == nil || s.Frontends.PortalAssets == nil {
				http.NotFound(w, r)
				return
			}
			s.Frontends.PortalAssets.ServeHTTP(w, r)
			return
		}
		if settings.IsOldAdminPath(r.URL.Path, entry) {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		if s.servePublic(w, r) {
			return
		}
		if settings.MatchesAdminLoginPath(r.URL.Path, entry) || settings.MatchesAdminPath(r.URL.Path, entry) {
			s.handleAdminPage(w, r)
			return
		}
		if path.Ext(r.URL.Path) != "" {
			http.NotFound(w, r)
			return
		}
		s.handlePage(w, r)
	})
}

func (s *Server) servePublic(w http.ResponseWriter, r *http.Request) bool {
	if s.Public == nil || r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || name == "." {
		return false
	}
	info, err := fs.Stat(s.Public, name)
	if err != nil || info.IsDir() {
		return false
	}
	data, err := fs.ReadFile(s.Public, name)
	if err != nil {
		return false
	}
	ctype := "application/octet-stream"
	switch strings.ToLower(path.Ext(name)) {
	case ".svg":
		ctype = "image/svg+xml"
	case ".png":
		ctype = "image/png"
	case ".jpg", ".jpeg":
		ctype = "image/jpeg"
	case ".webp":
		ctype = "image/webp"
	case ".ico":
		ctype = "image/x-icon"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
	return true
}

var htmlTitleRE = regexp.MustCompile(`(?is)<title>.*?</title>`)
var htmlDescriptionRE = regexp.MustCompile(`(?is)<meta[^>]+name=["']description["'][^>]*>`)

func pageDocument(shell []byte, title, description, lang string, noindex bool, bodyClass string) []byte {
	doc := string(shell)
	titleTag := "<title>" + htmlEscape(title) + "</title>"
	if htmlTitleRE.MatchString(doc) {
		doc = htmlTitleRE.ReplaceAllString(doc, titleTag)
	} else if strings.Contains(doc, "</head>") {
		doc = strings.Replace(doc, "</head>", titleTag+"</head>", 1)
	}
	if description != "" {
		meta := `<meta name="description" content="` + htmlEscape(description) + `">`
		if htmlDescriptionRE.MatchString(doc) {
			doc = htmlDescriptionRE.ReplaceAllString(doc, meta)
		} else if strings.Contains(doc, "</head>") {
			doc = strings.Replace(doc, "</head>", meta+"</head>", 1)
		}
	}
	return enrichDocument([]byte(doc), lang, noindex, bodyClass)
}

// enrichDocument adds the metadata shared by shell pages and SSR pages: the
// viewport (without it every mobile breakpoint is ignored), the html lang
// attribute, theme color, favicon and optional noindex. The body class is set
// here so the first server-rendered frame already carries the page skin.
func enrichDocument(doc []byte, lang string, noindex bool, bodyClass string) []byte {
	text := string(doc)
	extra := ""
	if noindex {
		extra += `<meta name="robots" content="noindex, nofollow">`
	}
	extra += `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
	extra += `<meta name="theme-color" content="#f6f8fc">`
	extra += `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
	if strings.Contains(text, "</head>") {
		text = strings.Replace(text, "</head>", extra+"</head>", 1)
	}
	if bodyClass != "" {
		bodyRE := regexp.MustCompile(`(?i)<body([^>]*)class=["'][^"']*["']`)
		if bodyRE.MatchString(text) {
			text = bodyRE.ReplaceAllString(text, `<body$1class="`+htmlEscape(bodyClass)+`"`)
		} else {
			text = regexp.MustCompile(`(?i)<body`).ReplaceAllString(text, `<body class="`+htmlEscape(bodyClass)+`"`)
		}
	}
	langRE := regexp.MustCompile(`(?i)<html([^>]*)lang=["'][^"']*["']`)
	if langRE.MatchString(text) {
		text = langRE.ReplaceAllString(text, `<html$1lang="`+htmlEscape(lang)+`"`)
	} else {
		text = regexp.MustCompile(`(?i)<html`).ReplaceAllString(text, `<html lang="`+htmlEscape(lang)+`"`)
	}
	return []byte(text)
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return replacer.Replace(value)
}

func requestLocale(r *http.Request) string {
	// The client mirrors an explicit language choice into this cookie so SSR
	// renders the same language the browser will hydrate.
	if cookie, err := r.Cookie("olai_locale"); err == nil {
		switch cookie.Value {
		case "zh-CN":
			return "zh-CN"
		case "en":
			return "en"
		}
	}
	type tag struct {
		value string
		q     float64
	}
	var tags []tag
	for _, part := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		pieces := strings.Split(strings.TrimSpace(part), ";")
		value := strings.TrimSpace(pieces[0])
		if value == "" || value == "*" {
			continue
		}
		q := 1.0
		for _, param := range pieces[1:] {
			param = strings.TrimSpace(param)
			if strings.HasPrefix(param, "q=") {
				if parsed, err := parseFloat(strings.TrimPrefix(param, "q=")); err == nil {
					q = parsed
				}
			}
		}
		if q > 0 {
			tags = append(tags, tag{value: strings.ToLower(value), q: q})
		}
	}
	for i := 0; i < len(tags); i++ {
		for j := i + 1; j < len(tags); j++ {
			if tags[j].q > tags[i].q {
				tags[i], tags[j] = tags[j], tags[i]
			}
		}
	}
	for _, item := range tags {
		if item.value == "zh" || strings.HasPrefix(item.value, "zh-") {
			return "zh-CN"
		}
		if item.value == "en" || strings.HasPrefix(item.value, "en-") {
			return "en"
		}
	}
	if len(tags) > 0 {
		return "en"
	}
	return "zh-CN"
}

func (s *Server) handlePage(w http.ResponseWriter, r *http.Request) {
	locale := requestLocale(r)
	if r.URL.Path == "/home" {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	user, _ := s.Auth.CurrentUser(r.Context(), r)
	if r.URL.Path == "/login" && user != nil {
		params := r.URL.Query()
		if !params.Has("verify") && !params.Has("reset") && !params.Has("github_error") && !params.Has("google_error") {
			http.Redirect(w, r, safeNextPath(params.Get("next")), http.StatusFound)
			return
		}
	}
	if r.URL.Path == "/account" && user == nil {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusFound)
		return
	}
	title, description, noindex := pageCopy(r.URL.Path, locale)
	// -tags dev：页面骨架/SSR 交给 DevServer，API、鉴权重定向与 setup 仍由
	// 本函数前面的链路处理。生产构建里 s.dev 恒为 nil，不会进入。
	if s.renderDevPortalPage(w, r, title, description, locale, noindex, user) {
		return
	}
	if s.Frontends == nil {
		http.Error(w, "前端产物不可用，请先构建 portal 与 admin。", http.StatusInternalServerError)
		return
	}
	// The public plaza and download page are server-rendered for first paint
	// and SEO. Studio, login and account depend on browser storage and use the
	// SPA shell.
	if portalSSRPath(r.URL.Path) {
		s.writePortalSSR(w, r, title, description, locale, noindex, user)
		return
	}
	s.writePage(w, s.Frontends.PortalShell, title, description, locale, noindex, "")
}

// bodyClassForPath mirrors the legacy Astro <body class> per page. Client-side
// navigation keeps it in sync in App.vue.
func bodyClassForPath(path string) string {
	switch path {
	case "/", "/gallery":
		return "plaza-body"
	case "/download":
		return "download-body"
	}
	return ""
}

func pageCopy(pathname, locale string) (title, description string, noindex bool) {
	en := locale == "en"
	switch pathname {
	case "/", "/gallery":
		if en {
			return "Works Plaza · Olai", "Browse images, videos and music made with Olai. Discover creators, save favorites and share the works you love.", false
		}
		return "作品广场 · Olai", "浏览社区用 Olai 完成的图像、视频与音乐，发现灵感、收藏作品并分享给朋友。", false
	case "/download":
		if en {
			return "Download · Olai", "Download the Olai app when it becomes available on the App Store and Google Play.", false
		}
		return "下载 · Olai", "Olai 应用上架后，可在此下载 iOS 与 Android 版本。", false
	case "/setup":
		if en {
			return "Set up · Olai", "Create the first administrator and finish setting up the site.", true
		}
		return "初始化 · Olai", "首次部署：创建第一个管理员账号并完成站点初始化。", true
	case "/login":
		if en {
			return "Sign in · Olai", "Sign in to Olai to sync your conversations, artworks and lyrics across devices.", true
		}
		return "登录 · Olai", "登录 Olai，同步你的会话、作品与歌词，在任何设备继续创作。", true
	case "/account":
		if en {
			return "Account · Olai", "Manage your Olai account, credits and daily allowance.", true
		}
		return "账号中心 · Olai", "管理你的 Olai 账号、积分与每日额度。", true
	}
	if en {
		return "Olai · Online AI Companion", "Olai is your AI companion and all-in-one creative space.", false
	}
	return "Olai · Online AI Companion", "Olai 是你的在线 AI 伴侣与全能创意空间。", false
}

// handleAdminPage serves the isolated admin SPA shell. Whether the visitor may
// use the console is decided by GET /api/admin/session and the admin APIs, so
// the page itself never redirects into the portal.
func (s *Server) handleAdminPage(w http.ResponseWriter, r *http.Request) {
	s.Settings.Refresh(r.Context(), true)
	locale := requestLocale(r)
	title := "管理后台 · Olai"
	if locale == "en" {
		title = "Admin · Olai"
	}
	if s.renderDevAdminPage(w, r, title, locale) {
		return
	}
	if s.Frontends == nil {
		http.Error(w, "前端产物不可用，请先构建 portal 与 admin。", http.StatusInternalServerError)
		return
	}
	s.writePage(w, s.Frontends.AdminShell, title, "", locale, true, "adm-body")
}

func (s *Server) setPageHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy",
		"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "+
			"img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; "+
			"worker-src 'self' blob:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'")
}

func (s *Server) writePage(w http.ResponseWriter, shell []byte, title, description, lang string, noindex bool, bodyClass string) {
	if len(shell) == 0 {
		http.Error(w, "前端产物不可用，请先构建 portal 与 admin。", http.StatusInternalServerError)
		return
	}
	s.setPageHeaders(w)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(injectBootstrap(pageDocument(shell, title, description, lang, noindex, bodyClass), lang, s.githubLoginEnabled(), s.googleLoginEnabled()))
}

// injectBootstrap embeds the small public bootstrap payload the SPA shell reads
// before its first render (locale + which third-party logins are available), so
// the login card renders in its final layout instead of shifting a frame later.
// It is inert JSON, so the page CSP still only allows same-origin scripts.
func injectBootstrap(doc []byte, locale string, githubLogin, googleLogin bool) []byte {
	payload, err := json.Marshal(map[string]any{"locale": locale, "githubLogin": githubLogin, "googleLogin": googleLogin})
	if err != nil {
		return doc
	}
	script := `<script id="__WF_BOOTSTRAP__" type="application/json">` + string(payload) + `</script>`
	text := string(doc)
	if strings.Contains(text, "</head>") {
		text = strings.Replace(text, "</head>", script+"</head>", 1)
	}
	return []byte(text)
}

// writePortalSSR renders public pages through the portal's goja runtime, then
// adds the same metadata the SPA shell gets. Render errors are logged without
// request bodies or provider details and shown to the user as a plain 500.
func (s *Server) writePortalSSR(w http.ResponseWriter, r *http.Request, title, description, locale string, noindex bool, user *store.SessionUser) {
	doc, err := s.Frontends.RenderPortal(r.URL.Path, locale, title, description, user, s.githubLoginEnabled(), s.googleLoginEnabled())
	if err != nil {
		log.Printf("portal SSR %s 渲染失败：%v", r.URL.Path, err)
		http.Error(w, "页面渲染失败，请稍后重试。", http.StatusInternalServerError)
		return
	}
	doc = enrichDocument(doc, locale, noindex, bodyClassForPath(r.URL.Path))
	s.setPageHeaders(w)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(doc)
}

func safeNextPath(value string) string {
	const fallback = "/"
	if !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.Contains(value, "\\") {
		return fallback
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.User != nil {
		return fallback
	}
	decoded, err := url.PathUnescape(parsed.Path)
	if err != nil || strings.HasPrefix(decoded, "//") {
		return fallback
	}
	if decoded == "/login" || strings.HasPrefix(decoded, "/login/") {
		return fallback
	}
	if strings.Contains(decoded, "%") && decoded != parsed.Path {
		return fallback
	}
	return value
}

func (s *Server) currentUser(r *http.Request) (*store.SessionUser, error) {
	return s.Auth.CurrentUser(r.Context(), r)
}

func (s *Server) sameOrigin(r *http.Request) bool { return httpx.SameOrigin(r, s.Settings) }

func (s *Server) clientIP(r *http.Request) (string, error) { return httpx.ClientIP(r, s.Settings) }

func (s *Server) dayStart(now time.Time) int64 { return httpx.DayStart(now) }

func (s *Server) siteOrigin(r *http.Request) string { return httpx.RequestOrigin(r, s.Settings) }

func (s *Server) dailyLimit(loggedIn bool) int {
	if loggedIn {
		return s.Settings.Int("USER_DAILY_GENERATION_LIMIT", 15)
	}
	return s.Settings.Int("GUEST_DAILY_GENERATION_LIMIT", 1)
}

func (s *Server) chatDailyLimit(loggedIn bool) int {
	if loggedIn {
		return s.Settings.Int("USER_DAILY_CHAT_LIMIT", 100)
	}
	return s.Settings.Int("GUEST_DAILY_CHAT_LIMIT", 100)
}

func (s *Server) ossEnabled() bool { return s.Settings.Get("OSS_ENABLED") == "true" }

func (s *Server) mediaStorage() string {
	if s.ossEnabled() {
		return "oss"
	}
	return "local"
}

func (s *Server) acquireChatSlot(ip string, limit int) (func(), bool) {
	if limit <= 0 {
		return func() {}, true
	}
	s.chatMu.Lock()
	defer s.chatMu.Unlock()
	if s.chatActive[ip] >= limit {
		return nil, false
	}
	s.chatActive[ip]++
	released := false
	return func() {
		s.chatMu.Lock()
		defer s.chatMu.Unlock()
		if released {
			return
		}
		released = true
		next := s.chatActive[ip] - 1
		if next > 0 {
			s.chatActive[ip] = next
		} else {
			delete(s.chatActive, ip)
		}
	}, true
}

func (s *Server) maybeRewardInvite(userID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = s.DB.MaybeRewardInvite(ctx, userID, int64(s.Pricing.InviteReward()), int64(s.Pricing.InviteBonus()),
		int64(s.Pricing.InviteDailyLimit()), s.dayStart(time.Now()), int64(s.Pricing.SignupBonus()))
}
