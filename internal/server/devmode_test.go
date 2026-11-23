package server

import "testing"

func TestDevInternalPath(t *testing.T) {
	cases := []struct {
		path string
		base string
		want bool
	}{
		// portal 根路径下的 DevServer 内部资源
		{"/src/main.ts", "", true},
		{"/@fs/F:/project/web/portal/src/App.vue", "", true},
		{"/@deps/vue.js", "", true},
		{"/@wf/client", "", true},
		{"/__wf_hmr", "", true},
		// 页面与业务路径不能被 DevServer 截走
		{"/", "", false},
		{"/download", "", false},
		{"/assets/app.js", "", false},
		{"/api/gallery", "", false},
		{"/src", "", false},
		// 后台挂在运行时前缀下，前缀本身不能误判
		{"/admin/src/main.ts", "/admin", true},
		{"/admin/@wf/client", "/admin", true},
		{"/admin//src/main.ts", "/admin", true},
		{"/admin", "/admin", false},
		{"/admin/users", "/admin", false},
		{"/administration/src/main.ts", "/admin", false},
		// 后台前缀下的 API 仍归 Go
		{"/admin/api/gallery", "/admin", false},
	}
	for _, c := range cases {
		if got := devInternalPath(c.path, c.base); got != c.want {
			t.Errorf("devInternalPath(%q, %q) = %v, want %v", c.path, c.base, got, c.want)
		}
	}
}

func TestPortalSSRPath(t *testing.T) {
	for _, path := range []string{"/", "/gallery", "/download"} {
		if !portalSSRPath(path) {
			t.Errorf("portalSSRPath(%q) = false, want true", path)
		}
	}
	for _, path := range []string{"/gallery/", "/login", "/download/thanks", "/account"} {
		if portalSSRPath(path) {
			t.Errorf("portalSSRPath(%q) = true, want false", path)
		}
	}
}
