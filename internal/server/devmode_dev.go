//go:build dev

package server

// devmode_dev.go：-tags dev 下的实际 DevServer 装配。
//
// 两个前端各自一个 DevServer：portal 挂根路径并开启 SSR 热换，admin 挂在
// 运行时 ADMIN_PATH 下。API、鉴权、setup、public 与 /assets 仍由 Server 的
// 原链路处理，因此开发时浏览器同源，不需要额外的网络反向代理。

import (
	"fmt"
	htmlpkg "html"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/plunjoin/webfront/compiler"
	"github.com/plunjoin/webfront/dev"
	devssr "github.com/plunjoin/webfront/dev/ssr"
)

func init() {
	devBuild = true
	attachDevHook = attachDevServers
}

// attachDevServers 启动两个开发服务器。调用方必须在 settings.Refresh 之后
// 调用，这样 adminBase 才是运行中的 ADMIN_PATH；运行期再改 ADMIN_PATH 需要重启。
func attachDevServers(s *Server, portalRoot, adminRoot string) error {
	// 开发端口可能和安装时保存的 SITE_ORIGIN 不同。继续用旧地址会让
	// 同源校验（Referer / Origin）失败并返回 403，媒体链接也会指向旧端口。
	// 开发态统一改用请求 Host；生产构建不会执行到这里。
	if origin := s.Settings.SiteOrigin(); origin != "" {
		log.Printf("[dev] 已忽略 SITE_ORIGIN=%s，同源校验改用请求 Host", origin)
	}
	s.Settings.IgnoreSiteOrigin()

	if s.dev != nil {
		return nil
	}
	if err := requireDevDir("portal", portalRoot); err != nil {
		return err
	}
	if err := requireDevDir("admin", adminRoot); err != nil {
		return err
	}
	ssrEntry := compiler.DetectServerEntry(portalRoot)
	if ssrEntry == "" {
		return fmt.Errorf("dev: %s 下没有 SSR 入口（src/entry-server.vue.ts 等）", portalRoot)
	}

	portal, err := dev.NewDevServer(portalRoot,
		dev.WithSSR(ssrEntry, devssr.Factory(2)),
		dev.WithHTMLShell(renderDevShell),
		// public 资源（/brand、/favicon.svg）在仓库根 public/，由 Go 的
		// Server.Public 继续提供；不要误开 web/portal/public。
		dev.WithPublicDir(""),
	)
	if err != nil {
		return fmt.Errorf("dev: portal 启动失败: %w", err)
	}

	adminBase := "/" + strings.Trim(strings.TrimSpace(s.Settings.AdminEntryPath()), "/")
	if adminBase == "/" {
		adminBase = "/admin"
	}
	admin, err := dev.NewDevServer(adminRoot,
		dev.WithBasePath(adminBase),
		dev.WithHTMLShell(renderDevShell),
		dev.WithPublicDir(""),
	)
	if err != nil {
		_ = portal.Close()
		return fmt.Errorf("dev: admin 启动失败: %w", err)
	}

	s.dev = &devFrontends{
		portal:    portal.Handler(),
		admin:     admin.Handler(),
		adminBase: adminBase,
		renderPortal: func(w http.ResponseWriter, r *http.Request, page DevPage) {
			portal.RenderPage(w, r, toDevPage(page))
		},
		renderAdmin: func(w http.ResponseWriter, r *http.Request, page DevPage) {
			admin.RenderPage(w, r, toDevPage(page))
		},
		close: func() error {
			var first error
			if err := admin.Close(); err != nil {
				first = err
			}
			if err := portal.Close(); err != nil && first == nil {
				first = err
			}
			return first
		},
	}
	return nil
}

func requireDevDir(label, root string) error {
	fi, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("dev: %s 前端目录 %s 不可用（请在项目根目录运行）：%w", label, root, err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("dev: %s 前端路径 %s 不是目录", label, root)
	}
	return nil
}

func toDevPage(p DevPage) dev.Page {
	return dev.Page{
		URL:         p.URL,
		Title:       p.Title,
		Description: p.Description,
		Props:       p.Props,
		Bootstrap:   p.Bootstrap,
		SSR:         p.SSR,
		HTMLAttrs:   p.HTMLAttrs,
		BodyAttrs:   p.BodyAttrs,
		HeadHTML:    p.HeadHTML,
	}
}

// renderDevShell 复刻 portal dist/index.html 的骨架，但把资源换成交给
// DevServer 注入的 import map / HMR 脚本。
//
// SSR 入口（entry-server.vue.ts）自己返回 <div id="root">…</div>，所以 SSR
// 页面直接把片段放进 body；只有 SPA 页面才需要空挂载点。两种形态都使用
// <!--wf-head--> / <!--wf-body--> / <!--wf-scripts--> 原位注入。
func renderDevShell(data dev.ShellData) ([]byte, error) {
	var b strings.Builder
	b.WriteString("<!doctype html><html")
	if attrs := strings.TrimSpace(data.HTMLAttrs); attrs != "" {
		b.WriteString(" ")
		b.WriteString(attrs)
	}
	b.WriteString("><head><meta charset=\"utf-8\"><title>")
	b.WriteString(htmlpkg.EscapeString(data.Title))
	b.WriteString("</title>")
	if data.Description != "" {
		b.WriteString(`<meta name="description" content="`)
		b.WriteString(htmlpkg.EscapeString(data.Description))
		b.WriteString(`">`)
	}
	b.WriteString(data.HeadHTML)
	b.WriteString("<!--wf-head--></head><body")
	if attrs := strings.TrimSpace(data.BodyAttrs); attrs != "" {
		b.WriteString(" ")
		b.WriteString(attrs)
	}
	b.WriteString(">")
	if data.SSR {
		b.WriteString("<!--wf-body-->")
	} else {
		b.WriteString(`<div id="root"><!--wf-body--></div>`)
	}
	b.WriteString("<!--wf-scripts--></body></html>")
	return []byte(b.String()), nil
}
