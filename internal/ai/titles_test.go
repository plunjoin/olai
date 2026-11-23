package ai

import (
	"strings"
	"testing"
)

func TestParseTitleCleansModelDecorations(t *testing.T) {
	cases := []struct{ name, input, want string }{
		{"plain", "夏日海风", "夏日海风"},
		{"quotes and period", "“ 夏日海风。 ”", "夏日海风"},
		{"zh label", "标题：清晨的山谷", "清晨的山谷"},
		{"en label", "Title: Quiet Harbor", "Quiet Harbor"},
		{"json object", `{"title":"城市夜景"}`, "城市夜景"},
		{"label on its own line", "标题：\n夏日海风", "夏日海风"},
		{"first line only", "第一行标题\n第二行解释", "第一行标题"},
		{"markdown", "**星光下的旅程**", "星光下的旅程"},
		{"book marks", "《海边来信》", "海边来信"},
		{"blank", "   ", ""},
		{"punctuation only", "。。。", ""},
	}
	for _, item := range cases {
		if got := ParseTitle(item.input); got != item.want {
			t.Fatalf("%s: ParseTitle(%q) = %q, want %q", item.name, item.input, got, item.want)
		}
	}
}

func TestParseTitleClampsLongReplies(t *testing.T) {
	title := ParseTitle(strings.Repeat("长", TitleMaxRunes+10))
	if count := len([]rune(title)); count != TitleMaxRunes {
		t.Fatalf("title runes = %d, want %d", count, TitleMaxRunes)
	}
}

// The generated title must follow the user's interface language and include the
// material it summarizes, not a hardcoded language.
func TestBuildTitlePromptFollowsLocale(t *testing.T) {
	zh := BuildTitlePrompt("work", "zh-CN", "月光下看书的小猫", "")
	for _, want := range []string{"中文标题", "月光下看书的小猫"} {
		if !strings.Contains(zh, want) {
			t.Fatalf("zh prompt missing %q: %s", want, zh)
		}
	}
	en := BuildTitlePrompt("conversation", "en", "Help me plan a quiet weekend", "Sure, let's start with Saturday.")
	for _, want := range []string{"English title", "Help me plan a quiet weekend", "Sure, let's start with Saturday."} {
		if !strings.Contains(en, want) {
			t.Fatalf("en prompt missing %q: %s", want, en)
		}
	}
	if strings.Contains(en, "中文") {
		t.Fatalf("English prompt must not ask for Chinese: %s", en)
	}
	if TitleSystemPrompt("en") == TitleSystemPrompt("zh-CN") {
		t.Fatal("system prompt must follow the locale")
	}
}
