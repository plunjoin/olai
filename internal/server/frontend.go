package server

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net/http"
	"strings"

	"github.com/plunjoin/webfront"
	"github.com/plunjoin/webfront/jsruntime"

	"olai/internal/store"
)

// Frontends owns the two webfront runtimes: the portal engine renders the
// public pages through goja (SSR) and serves the SPA shell for the studio;
// the admin engine is a pure client-side SPA mounted under /admin.
type Frontends struct {
	PortalShell  []byte
	AdminShell   []byte
	PortalAssets http.Handler
	AdminAssets  http.Handler

	portal         *webfront.Engine
	admin          *webfront.Engine
	portalVersions map[string]string
}

// LoadFrontends reads both dist trees, starts the SSR VM pool, and versions
// the fixed-name client bundles so browsers never keep an old client.js.
func LoadFrontends(portalDist, adminDist fs.FS) (*Frontends, error) {
	portalShell, err := fs.ReadFile(portalDist, "index.html")
	if err != nil {
		return nil, fmt.Errorf("缺少 web/portal/dist/index.html，请先构建 portal：%w", err)
	}
	adminShell, err := fs.ReadFile(adminDist, "index.html")
	if err != nil {
		return nil, fmt.Errorf("缺少 web/admin/dist/index.html，请先构建 admin：%w", err)
	}
	ssrBundle, err := fs.ReadFile(portalDist, "ssr.js")
	if err != nil {
		return nil, fmt.Errorf("缺少 web/portal/dist/ssr.js，portal 需要 SSR 构建：%w", err)
	}
	pool, err := jsruntime.New(ssrBundle, 4)
	if err != nil {
		return nil, fmt.Errorf("portal SSR 运行时初始化失败：%w", err)
	}
	portal, err := webfront.New(webfront.Config{
		Mode:     webfront.ModeSSR,
		EmbedFS:  portalDist,
		DistDir:  ".",
		Renderer: pool,
	})
	if err != nil {
		_ = pool.Close()
		return nil, fmt.Errorf("portal 运行时初始化失败：%w", err)
	}
	admin, err := webfront.New(webfront.Config{
		Mode:     webfront.ModeSPA,
		BasePath: "/admin",
		EmbedFS:  adminDist,
		DistDir:  ".",
	})
	if err != nil {
		_ = portal.Close()
		return nil, fmt.Errorf("admin 运行时初始化失败：%w", err)
	}

	f := &Frontends{
		portal:         portal,
		admin:          admin,
		portalVersions: assetVersions(portalDist),
	}
	f.PortalShell = f.versionAssets(portalShell, "", f.portalVersions)
	f.AdminShell = f.versionAssets(ensureAdminAssetPrefix(adminShell), "/admin", assetVersions(adminDist))
	f.PortalAssets = RevalidatingAssets(portal.StaticHandler())
	f.AdminAssets = RevalidatingAssets(admin.StaticHandler())
	return f, nil
}

// RenderPortal renders one public page. Only title, description, locale,
// third-party login availability and the signed-in user's own public profile
// cross into the frontend; no server secrets or provider details do.
func (f *Frontends) RenderPortal(url, locale, title, description string, user *store.SessionUser, githubLogin, googleLogin bool) ([]byte, error) {
	if f == nil || f.portal == nil {
		return nil, fmt.Errorf("portal SSR 未配置")
	}
	props := map[string]any{"locale": locale, "githubLogin": githubLogin, "googleLogin": googleLogin}
	if user != nil {
		props["initialUser"] = user
	}
	doc, err := f.portal.RenderHTML(url, webfront.Page{
		URL:   url,
		Props: props,
		Head:  webfront.Head{Title: title, Description: description},
	})
	if err != nil {
		return nil, err
	}
	return f.versionAssets([]byte(doc), "", f.portalVersions), nil
}

func (f *Frontends) Close() error {
	if f == nil {
		return nil
	}
	var first error
	if f.admin != nil {
		if err := f.admin.Close(); err != nil && first == nil {
			first = err
		}
	}
	if f.portal != nil {
		if err := f.portal.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// ensureAdminAssetPrefix pins the admin shell to its own bundles. A dist built
// without "-base /admin" would reference "/assets/..." and silently load the
// portal's client bundle inside the console, so rewrite those references here.
func ensureAdminAssetPrefix(shell []byte) []byte {
	doc := string(shell)
	for _, quote := range []string{`"`, `'`} {
		doc = strings.ReplaceAll(doc, quote+"/assets/", quote+"/admin/assets/")
	}
	return []byte(doc)
}

// assetVersions hashes the two fixed-name bundles emitted by webfront.
func assetVersions(dist fs.FS) map[string]string {
	versions := make(map[string]string, 2)
	for _, name := range []string{"client.js", "client.css"} {
		data, err := fs.ReadFile(dist, "assets/"+name)
		if err != nil {
			continue
		}
		sum := sha256.Sum256(data)
		versions[name] = hex.EncodeToString(sum[:])[:12]
	}
	return versions
}

// versionAssets appends ?v=<hash> to client.js/client.css references. The
// prefix keeps the admin shell (/admin/assets/...) distinct from the portal.
func (f *Frontends) versionAssets(content []byte, prefix string, versions map[string]string) []byte {
	doc := string(content)
	for _, name := range []string{"client.js", "client.css"} {
		hash := versions[name]
		if hash == "" {
			continue
		}
		ref := prefix + "/assets/" + name
		doc = strings.ReplaceAll(doc, ref, ref+"?v="+hash)
	}
	return []byte(doc)
}
