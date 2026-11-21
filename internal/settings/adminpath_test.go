package settings

import "testing"

func TestNormalizeAdminPath(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
		ok    bool
	}{
		{"default entry", "/admin", DefaultAdminPath, true},
		{"custom entry", "/console-x7k2", "/console-x7k2", true},
		{"nested custom entry", "/console/x7k2", "/console/x7k2", true},
		{"trailing slash", "/console-x7k2/", "/console-x7k2", true},
		{"too short", "/qa", "", false},
		{"missing slash", "console-x7k2", "", false},
		{"invalid character", "/console x7k2", "", false},
		{"uppercase default still resolves to default", "/ADMIN", "/ADMIN", true},
		{"setup route", "/setup", "", false},
		{"chat route", "/chat", "", false},
		{"image route", "/image", "", false},
		{"video route", "/video", "", false},
		{"music route", "/music", "", false},
		{"workflow route", "/workflow", "", false},
		{"login route", "/login", "", false},
		{"account route", "/account", "", false},
		{"gallery route", "/gallery", "", false},
		{"library route", "/library", "", false},
		{"api prefix", "/api/console", "", false},
		{"admin prefix", "/admin/console", "", false},
		{"asset prefix", "/assets", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := NormalizeAdminPath(tc.input)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("NormalizeAdminPath(%q) = (%q, %v), want (%q, %v)", tc.input, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestAdminPathFromSettingFallsBackToDefault(t *testing.T) {
	for _, raw := range []string{"", "   ", "/setup", "not-a-path"} {
		if got := AdminPathFromSetting(raw); got != DefaultAdminPath {
			t.Fatalf("AdminPathFromSetting(%q) = %q, want %q", raw, got, DefaultAdminPath)
		}
	}
}

func TestAdminEntryIsDefault(t *testing.T) {
	if !IsOldAdminPath("/admin/settings", "/console-x7k2") {
		t.Fatal("old /admin subpaths must be treated as old admin paths")
	}
	if IsOldAdminPath("/admin", DefaultAdminPath) {
		t.Fatal("the default entry must not be treated as an old path")
	}
	if !MatchesAdminPath("/Console-X7K2/", "/console-x7k2") {
		t.Fatal("admin path matching must ignore trailing slash and case")
	}
	if !MatchesAdminLoginPath("/Console-X7K2/Login/", "/console-x7k2") {
		t.Fatal("admin login path must live under the configured entry")
	}
	if MatchesAdminPath("/admin/login", DefaultAdminPath) {
		t.Fatal("the login page must not be treated as the console root")
	}
	if AdminLoginPath("bad path") != DefaultAdminPath+"/login" {
		t.Fatal("a broken entry must fall back to the default login path")
	}
}
