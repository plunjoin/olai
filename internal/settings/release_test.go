package settings

import (
	"context"
	"path/filepath"
	"testing"

	"olai/internal/config"
	"olai/internal/store"
)

func TestValidateReleaseSettings(t *testing.T) {
	value, err := ValidateValue("APP_IOS_LATEST_VERSION", "v1.4.0")
	if err != nil || value != "1.4.0" {
		t.Fatalf("version normalization = %q, %v; want 1.4.0", value, err)
	}
	if _, err := ValidateValue("APP_ANDROID_MIN_VERSION", "latest"); err == nil {
		t.Fatal("invalid minimum version must be rejected")
	}
	value, err = ValidateValue("APP_IOS_DOWNLOAD_URL", "https://apps.apple.com/app/id123?l=zh")
	if err != nil || value == "" {
		t.Fatalf("App Store URL with query = %q, %v; want accepted", value, err)
	}
	if _, err := ValidateValue("APP_ANDROID_DOWNLOAD_URL", "javascript:alert(1)"); err == nil {
		t.Fatal("non-http download URL must be rejected")
	}
}

func TestSaveRejectsMinimumAboveLatest(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	manager := New(db)
	_, err = manager.Save(ctx, map[string]any{
		"APP_IOS_LATEST_VERSION": "1.2.0",
		"APP_IOS_MIN_VERSION":    "1.3.0",
	}, nil, "admin")
	if err == nil {
		t.Fatal("minimum version above latest must be rejected")
	}
	if _, err := manager.Save(ctx, map[string]any{
		"APP_IOS_LATEST_VERSION": "1.3.0",
		"APP_IOS_MIN_VERSION":    "1.2.0",
	}, nil, "admin"); err != nil {
		t.Fatalf("valid release pair rejected: %v", err)
	}
}
