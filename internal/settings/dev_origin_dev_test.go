//go:build dev

package settings

import (
	"context"
	"path/filepath"
	"testing"

	"olai/internal/config"
	"olai/internal/store"
)

func TestIgnoreSiteOrigin(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "settings.db")})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.SaveSettings(ctx, map[string]string{"SITE_ORIGIN": "https://olai.example.com/"}, nil, "test"); err != nil {
		t.Fatal(err)
	}

	m := New(db)
	m.Refresh(ctx, true)
	if got, want := m.SiteOrigin(), "https://olai.example.com"; got != want {
		t.Fatalf("SiteOrigin() = %q, want %q", got, want)
	}

	m.IgnoreSiteOrigin()
	if got := m.SiteOrigin(); got != "" {
		t.Fatalf("忽略后 SiteOrigin() = %q, want empty", got)
	}
	// 再次 Refresh 不能把数据库里的值带回来。
	m.Refresh(ctx, true)
	if got := m.SiteOrigin(); got != "" {
		t.Fatalf("Refresh 后 SiteOrigin() = %q, want empty", got)
	}
}
