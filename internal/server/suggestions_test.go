package server

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"olai/internal/ai"
	"olai/internal/config"
	"olai/internal/httpx"
)

func suggestionTitles(items []ai.Suggestion) string {
	out := ""
	for _, item := range items {
		out += item.Title + "|"
	}
	return out
}

// The built-in pool must still show a different set of cards on consecutive
// days, so a failed model call never freezes the welcome screen.
func TestFallbackSuggestionsRotateDaily(t *testing.T) {
	today := fallbackSuggestions("zh-CN", "2026-11-20")
	tomorrow := fallbackSuggestions("zh-CN", "2026-11-21")
	if len(today) != ai.SuggestionCount || len(tomorrow) != ai.SuggestionCount {
		t.Fatalf("expected %d cards per day, got %d and %d", ai.SuggestionCount, len(today), len(tomorrow))
	}
	if suggestionTitles(today) == suggestionTitles(tomorrow) {
		t.Fatalf("consecutive days must differ, both showed %q", suggestionTitles(today))
	}
	english := fallbackSuggestions("en", "2026-11-20")
	inPool := map[string]bool{}
	for _, item := range suggestionFallbacks["en"] {
		inPool[item.Title] = true
	}
	for _, item := range english {
		if !inPool[item.Title] {
			t.Fatalf("unexpected English fallback card: %+v", item)
		}
	}
}

func TestSuggestionLocalePrefersQuery(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/suggestions?locale=en", nil)
	request.Header.Set("Accept-Language", "zh-CN")
	if got := suggestionLocale(request); got != "en" {
		t.Fatalf("expected query locale en, got %q", got)
	}
	request = httptest.NewRequest("GET", "/api/suggestions", nil)
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	if got := suggestionLocale(request); got != "en" {
		t.Fatalf("expected header locale en, got %q", got)
	}
	request = httptest.NewRequest("GET", "/api/suggestions?locale=de", nil)
	request.Header.Set("Accept-Language", "zh-CN")
	if got := suggestionLocale(request); got != "zh-CN" {
		t.Fatalf("unsupported locale must fall back to the request locale, got %q", got)
	}
}

// Without a configured AI service the endpoint still serves the rotating
// built-in cards instead of failing.
func TestDailySuggestionsFallBackWithoutAI(t *testing.T) {
	t.Setenv("AI_API_KEY", "")
	t.Setenv("AI_API_BASE_URL", "")
	app := New(config.Config{}, nil, nil, nil)
	set := app.dailySuggestions(context.Background(), "zh-CN")
	day := httpx.DayKey(time.Now())
	if set.Day != day {
		t.Fatalf("expected day %q, got %q", day, set.Day)
	}
	if len(set.Items) != ai.SuggestionCount {
		t.Fatalf("expected %d cards, got %d", ai.SuggestionCount, len(set.Items))
	}
	again := app.dailySuggestions(context.Background(), "zh-CN")
	if suggestionTitles(again.Items) != suggestionTitles(set.Items) {
		t.Fatal("cards must stay stable within the same day")
	}
	if len(app.suggestCache) != 0 {
		t.Fatal("a failed generation must not be cached as today's result")
	}
}
