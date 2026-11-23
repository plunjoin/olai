package server

// devmode.go：开发态接线的构建无关部分。
//
// 真正的 DevServer 只在 -tags dev 里编译（devmode_dev.go），并通过 init
// 注册到这里；生产构建里 s.dev 始终为 nil，AttachDev 是空操作。本文件
// 只依赖标准库，因此生产二进制不会链接 esbuild / fsnotify / websocket。

import (
	"net/http"
	"strings"

	"olai/internal/store"
)

var (
	devBuild      bool
	attachDevHook func(*Server, string, string) error
)

// DevBuild 报告当前二进制是否使用 -tags dev 编译。
func DevBuild() bool {
	return devBuild
}

// AttachDev 在 dev 构建里启动 portal/admin 开发服务器；正式构建直接返回 nil。
func (s *Server) AttachDev(portalRoot, adminRoot string) error {
	if attachDevHook == nil {
		return nil
	}
	return attachDevHook(s, portalRoot, adminRoot)
}

// DevPage 是项目侧交给开发渲染器的一页。字段与 dev.Page 一一对应，放在
// server 包是为了让无 build tag 的路由链不必 import webfront/dev。
type DevPage struct {
	URL         string
	Title       string
	Description string
	Props       map[string]any
	Bootstrap   map[string]any
	SSR         bool
	HTMLAttrs   string
	BodyAttrs   string
	HeadHTML    string
}

// devFrontends 持有两个 DevServer 的 handler 与页面渲染回调。
type devFrontends struct {
	portal       http.Handler
	admin        http.Handler
	adminBase    string
	renderPortal func(w http.ResponseWriter, r *http.Request, page DevPage)
	renderAdmin  func(w http.ResponseWriter, r *http.Request, page DevPage)
	close        func() error
}

// devInternalPrefixes 是 DevServer 自己拥有的无扩展名路由。它们必须绕过
// setup 门禁，否则首装阶段会被当成页面重定向。
var devInternalPrefixes = []string{"/src/", "/@fs/", "/@deps/", "/@wf/", "/__wf_"}

// devInternalPath 判断 pathname 在 base 下是否属于 DevServer 内部资源。
func devInternalPath(pathname, base string) bool {
	if base != "" {
		if pathname != base && !strings.HasPrefix(pathname, base+"/") {
			return false
		}
		pathname = strings.TrimPrefix(pathname, base)
		if pathname == "" {
			pathname = "/"
		}
	}
	// 折叠重复斜杠：/admin//src/main.ts 也要交给后台 DevServer，由它用
	// 带挂载前缀的 302 规范化，而不是落到 Go 的静态 404。
	for strings.Contains(pathname, "//") {
		pathname = strings.ReplaceAll(pathname, "//", "/")
	}
	for _, prefix := range devInternalPrefixes {
		if strings.HasPrefix(pathname, prefix) {
			return true
		}
	}
	return false
}

// serveDevInternal 把模块/依赖/资源/HMR 请求交给对应的 DevServer。
// /api、/assets、public 与页面路径不会命中这些前缀，仍走原有 Go 链路。
func (s *Server) serveDevInternal(w http.ResponseWriter, r *http.Request) bool {
	d := s.dev
	if d == nil {
		return false
	}
	if d.adminBase != "" && devInternalPath(r.URL.Path, d.adminBase) {
		d.admin.ServeHTTP(w, r)
		return true
	}
	if devInternalPath(r.URL.Path, "") {
		d.portal.ServeHTTP(w, r)
		return true
	}
	return false
}

// portalSSRPath 与生产 handlePage 的 SSR 分派保持一致。
func portalSSRPath(pathname string) bool {
	switch pathname {
	case "/", "/gallery", "/download":
		return true
	}
	return false
}

// devHeadHTML 复刻生产 enrichDocument 注入的公共 meta。
func devHeadHTML(noindex bool) string {
	head := ""
	if noindex {
		head += `<meta name="robots" content="noindex, nofollow">`
	}
	head += `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
	head += `<meta name="theme-color" content="#f6f8fc">`
	head += `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
	return head
}

func devBodyClass(class string) string {
	if class == "" {
		return ""
	}
	return `class="` + htmlEscape(class) + `"`
}

// renderDevPortalPage 用生产同款的 title/props/bootstrap 渲染 portal 页面。
// 返回 false 表示当前不是 dev 构建；SSR 渲染失败由 DevServer 自己写 500。
func (s *Server) renderDevPortalPage(w http.ResponseWriter, r *http.Request, title, description, locale string, noindex bool, user *store.SessionUser) bool {
	d := s.dev
	if d == nil || d.renderPortal == nil {
		return false
	}
	props := map[string]any{
		"locale":      locale,
		"githubLogin": s.githubLoginEnabled(),
		"googleLogin": s.googleLoginEnabled(),
	}
	if user != nil {
		props["initialUser"] = user
	}
	// SPA 页面用 __WF_BOOTSTRAP__；SSR 成功时 DevServer 另注入 __WF_DATA__。
	// SSR 构建失败退回 SPA 时，bootstrap 仍能让首屏拿到语言与登录开关。
	bootstrap := map[string]any{
		"locale":      locale,
		"githubLogin": s.githubLoginEnabled(),
		"googleLogin": s.googleLoginEnabled(),
	}
	d.renderPortal(w, r, DevPage{
		URL:         r.URL.Path,
		Title:       title,
		Description: description,
		Props:       props,
		Bootstrap:   bootstrap,
		SSR:         portalSSRPath(r.URL.Path),
		HTMLAttrs:   `lang="` + htmlEscape(locale) + `"`,
		BodyAttrs:   devBodyClass(bodyClassForPath(r.URL.Path)),
		HeadHTML:    devHeadHTML(noindex),
	})
	return true
}

// renderDevAdminPage 渲染后台 SPA 外壳（无 SSR）。
func (s *Server) renderDevAdminPage(w http.ResponseWriter, r *http.Request, title, locale string) bool {
	d := s.dev
	if d == nil || d.renderAdmin == nil {
		return false
	}
	d.renderAdmin(w, r, DevPage{
		URL:       r.URL.Path,
		Title:     title,
		Bootstrap: map[string]any{"locale": locale, "githubLogin": s.githubLoginEnabled(), "googleLogin": s.googleLoginEnabled()},
		HTMLAttrs: `lang="` + htmlEscape(locale) + `"`,
		BodyAttrs: `class="adm-body"`,
		HeadHTML:  devHeadHTML(true),
	})
	return true
}

// CloseDev 关闭两个开发服务器（停止 watcher、HMR 连接与 SSR 池）。
// 生产构建里是空操作，可安全 defer。
func (s *Server) CloseDev() error {
	d := s.dev
	if d == nil {
		return nil
	}
	s.dev = nil
	if d.close != nil {
		return d.close()
	}
	return nil
}
