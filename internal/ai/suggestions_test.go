package ai

import (
	"strings"
	"testing"
)

const validSuggestionJSON = `{
  "suggestions": [
    {"title": "深夜树洞", "prompt": "最近有点累，陪我聊聊怎么让心静下来。"},
    {"title": "写点文案", "prompt": "为一家书店写三条温暖而有记忆点的文案。"},
    {"title": "想个点子", "prompt": "给我五个周末就能完成的小创意项目。"},
    {"title": "讲个概念", "prompt": "用一个生活里的例子解释什么是复利。"}
  ]
}`

func TestParseSuggestionsFencedJSON(t *testing.T) {
	items := ParseSuggestions("```json\n" + validSuggestionJSON + "\n```")
	if len(items) != SuggestionCount {
		t.Fatalf("expected %d suggestions, got %d", SuggestionCount, len(items))
	}
	if items[0].Title != "深夜树洞" || !strings.Contains(items[0].Prompt, "陪我聊聊") {
		t.Fatalf("unexpected first suggestion: %+v", items[0])
	}
}

func TestParseSuggestionsBareArray(t *testing.T) {
	raw := `[
		{"title":"聊聊今天","prompt":"今天过得怎么样，想听你说说。"},
		{"title":"写点文案","prompt":"为一家书店写三条温暖的文案。"},
		{"title":"想个点子","prompt":"给我三个周末可完成的小项目。"},
		{"title":"解释概念","prompt":"用一个例子解释什么是机器学习。"}
	]`
	if items := ParseSuggestions(raw); len(items) != SuggestionCount {
		t.Fatalf("expected %d suggestions from a bare array, got %d", SuggestionCount, len(items))
	}
}

func TestParseSuggestionsSurroundingProse(t *testing.T) {
	items := ParseSuggestions("好的，这是今天的卡片：\n" + validSuggestionJSON + "\n希望你喜欢。")
	if len(items) != SuggestionCount {
		t.Fatalf("expected %d suggestions, got %d", SuggestionCount, len(items))
	}
}

func TestParseSuggestionsRejectsIncompleteSets(t *testing.T) {
	if items := ParseSuggestions(`{"suggestions":[{"title":"只有一个","prompt":"你好呀。"}]}`); items != nil {
		t.Fatalf("expected nil for an incomplete set, got %+v", items)
	}
	if items := ParseSuggestions("not json"); items != nil {
		t.Fatalf("expected nil for invalid JSON, got %+v", items)
	}
	duplicated := strings.Replace(validSuggestionJSON, "写点文案", "深夜树洞", 1)
	if items := ParseSuggestions(duplicated); items != nil {
		t.Fatalf("expected nil when titles repeat, got %+v", items)
	}
}

func TestParseSuggestionsCleansWhitespaceAndQuotes(t *testing.T) {
	raw := `{"suggestions":[
		{"title":"  「聊聊今天」 ","prompt":"  今天有点累，\n陪我聊聊天吧。  "},
		{"title":"写点东西","prompt":"为一家花店写三条文案。"},
		{"title":"想个点子","prompt":"给我三个周末可完成的小项目。"},
		{"title":"解释概念","prompt":"用一个例子解释什么是机器学习。"}
	]}`
	items := ParseSuggestions(raw)
	if len(items) != SuggestionCount {
		t.Fatalf("expected %d suggestions, got %d", SuggestionCount, len(items))
	}
	if items[0].Title != "聊聊今天" || strings.Contains(items[0].Prompt, "\n") {
		t.Fatalf("suggestion was not cleaned: %+v", items[0])
	}
}

// English titles run longer than Chinese ones; a natural card must survive.
func TestParseSuggestionsAcceptsEnglishCards(t *testing.T) {
	raw := `{"suggestions":[
		{"title":"A late-night heart-to-heart","prompt":"I haven't been sleeping well. Walk me through a few gentle ways to calm my mind."},
		{"title":"Words for an old friend","prompt":"Help me write something sincere but not sappy to a friend I haven't talked to in ages."},
		{"title":"Take me traveling","prompt":"Take me on a written walk through a small town that's perfect for wandering alone — early morning streets included."},
		{"title":"A second look","prompt":"I made a decision that didn't go well. Help me look at it from another angle."}
	]}`
	if items := ParseSuggestions(raw); len(items) != SuggestionCount {
		t.Fatalf("expected %d English cards, got %d", SuggestionCount, len(items))
	}
}

func TestBuildSuggestionPromptIncludesLocaleAndPrevious(t *testing.T) {
	zh := BuildSuggestionPrompt("zh-CN", "2026-11-20", []string{"旧标题 A", "旧标题 B"})
	for _, want := range []string{"2026-11-20", "旧标题 A", "旧标题 B"} {
		if !strings.Contains(zh, want) {
			t.Fatalf("Chinese prompt is missing %q: %s", want, zh)
		}
	}
	en := BuildSuggestionPrompt("en", "2026-11-20", []string{"Old title"})
	if !strings.Contains(en, "Today is 2026-11-20") || !strings.Contains(en, "Old title") {
		t.Fatalf("English prompt is missing date or previous titles: %s", en)
	}
}
