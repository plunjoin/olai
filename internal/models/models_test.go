package models

import (
	"context"
	"path/filepath"
	"testing"

	"olai/internal/config"
	"olai/internal/pricing"
	"olai/internal/settings"
	"olai/internal/store"
)

func chatPrices(t *testing.T, perMessage any) Prices {
	t.Helper()
	manager := &Manager{}
	prices, err := manager.NormalizePrices(KindChat, map[string]any{
		"chat": map[string]any{"perMessage": perMessage},
	})
	if err != nil {
		t.Fatalf("NormalizePrices(chat, %v) failed: %v", perMessage, err)
	}
	return prices
}

func TestNormalizeChatPricesAcceptsTwoDecimals(t *testing.T) {
	for _, value := range []float64{0, 0.05, 0.25, 2.5, 3, 1000000} {
		prices := chatPrices(t, value)
		if prices.Chat == nil || prices.Chat.PerMessage != value {
			t.Fatalf("perMessage %v normalized to %+v", value, prices.Chat)
		}
	}
}

func TestNormalizeChatPricesRejectsInvalid(t *testing.T) {
	for _, value := range []any{0.005, -0.5, 1.234, 1000000.5, "1", nil} {
		manager := &Manager{}
		_, err := manager.NormalizePrices(KindChat, map[string]any{
			"chat": map[string]any{"perMessage": value},
		})
		if err == nil {
			t.Fatalf("perMessage %v was accepted", value)
		}
	}
}

func TestNormalizeTiers(t *testing.T) {
	if tiers, err := NormalizeTiers(KindImage, nil); err != nil || len(tiers) != 3 || tiers[0] != "1K" {
		t.Fatalf("image default tiers = %v, %v", tiers, err)
	}
	tiers, err := NormalizeTiers(KindImage, []any{"2K", "1K"})
	if err != nil {
		t.Fatalf("NormalizeTiers(image) failed: %v", err)
	}
	if len(tiers) != 2 || tiers[0] != "1K" || tiers[1] != "2K" {
		t.Fatalf("image tiers = %v, want canonical order [1K 2K]", tiers)
	}
	if _, err := NormalizeTiers(KindImage, []any{}); err == nil {
		t.Fatal("empty image tiers were accepted")
	}
	if _, err := NormalizeTiers(KindImage, []any{"8K"}); err == nil {
		t.Fatal("unknown image tier was accepted")
	}
	if tiers, err := NormalizeTiers(KindChat, []any{"1K"}); err != nil || tiers != nil {
		t.Fatalf("chat tiers = %v, %v; want none", tiers, err)
	}
}

func TestReadTiersFallsBackToAll(t *testing.T) {
	if tiers := ReadTiers(KindVideo, ""); len(tiers) != 4 || tiers[3] != "4k" {
		t.Fatalf("empty stored tiers = %v, want every video tier", tiers)
	}
	if tiers := ReadTiers(KindVideo, `["720p","4k"]`); len(tiers) != 2 || tiers[1] != "4k" {
		t.Fatalf("stored video tiers = %v", tiers)
	}
	if tiers := ReadTiers(KindVideo, `not-json`); len(tiers) != 4 {
		t.Fatalf("malformed stored tiers = %v, want every tier", tiers)
	}
	if !(Choice{Kind: KindVideo, Tiers: []string{"720p", "4k"}}).SupportsTier("4K") {
		t.Fatal("SupportsTier is not case-insensitive")
	}
	if (Choice{Kind: KindVideo, Tiers: []string{"720p"}}).SupportsTier("4k") {
		t.Fatal("SupportsTier accepted an unsupported tier")
	}
}

func TestChatHundredths(t *testing.T) {
	price := &pricing.Manager{Settings: settings.New(nil)}
	t.Setenv("POINT_CHAT", "3")
	if got := ChatHundredths(Choice{Kind: KindChat}, price); got != 300 {
		t.Fatalf("fallback ChatHundredths = %d, want 300", got)
	}
	choice := Choice{Kind: KindChat, Prices: Prices{Chat: &ChatPrices{PerMessage: 0.25}}}
	if got := ChatHundredths(choice, price); got != 25 {
		t.Fatalf("model ChatHundredths = %d, want 25", got)
	}
	if got := Points(choice, PointOptions{}, price); got != 0 {
		t.Fatalf("Points(0.25/message) = %d, want 0 whole points", got)
	}
}

func TestAliasForUpstreamReturnsPublicAliasOnly(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "models.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	settingsManager := settings.New(db)
	manager := &Manager{DB: db, Settings: settingsManager, Pricing: &pricing.Manager{Settings: settingsManager}}
	rows := []store.ModelRow{
		{PublicID: "mdl_aaaaaaaaaaaaaaaaaaaaaaaa", UpstreamID: "upstream-image", Alias: "Nano Banana 2", Kind: "image", Enabled: true, Prices: "{}"},
		{PublicID: "mdl_bbbbbbbbbbbbbbbbbbbbbbbb", UpstreamID: "upstream-disabled", Alias: "Hidden Model", Kind: "image", Enabled: false, Prices: "{}"},
	}
	for _, row := range rows {
		if err := db.UpsertModel(ctx, row); err != nil {
			t.Fatalf("upsert %s: %v", row.UpstreamID, err)
		}
	}
	if got := manager.AliasForUpstream(ctx, KindImage, "upstream-image"); got != "Nano Banana 2" {
		t.Fatalf("alias = %q, want Nano Banana 2", got)
	}
	if got := manager.AliasForUpstream(ctx, KindImage, "upstream-disabled"); got != "" {
		t.Fatalf("disabled alias = %q, want empty", got)
	}
	if got := manager.AliasForUpstream(ctx, KindVideo, "upstream-image"); got != "" {
		t.Fatalf("wrong-kind alias = %q, want empty", got)
	}
	if got := manager.AliasForUpstream(ctx, KindImage, ""); got != "" {
		t.Fatalf("empty upstream alias = %q, want empty", got)
	}
	choice, err := manager.Resolve(ctx, rows[0].PublicID, KindImage)
	if err != nil || choice == nil || choice.Alias != "Nano Banana 2" {
		t.Fatalf("resolved choice = %+v err=%v", choice, err)
	}
}
