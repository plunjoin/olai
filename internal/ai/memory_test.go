package ai

import (
	"strings"
	"testing"

	"olai/internal/pricing"
	"olai/internal/settings"
)

func TestBuildChatAppendsSavedMemoryToSystemPrompt(t *testing.T) {
	manager := &Manager{Settings: &settings.Manager{}}
	price := &pricing.Manager{Settings: &settings.Manager{}}
	input := map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": "帮我写一段介绍"}},
	}
	request, err := manager.Build("chat/completions", input, nil, price, []string{"用户叫约翰。", "偏好英文回答。"})
	if err != nil {
		t.Fatalf("build chat: %v", err)
	}
	messages := request.Payload["messages"].([]any)
	system := messages[0].(map[string]any)["content"].(string)
	if !strings.Contains(system, DefaultSystemPrompt) {
		t.Fatal("saved memory must extend, not replace, the system prompt")
	}
	if !strings.Contains(system, "- 用户叫约翰。") || !strings.Contains(system, "- 偏好英文回答。") {
		t.Fatalf("memory missing from system prompt: %q", system)
	}

	without, err := manager.Build("chat/completions", input, nil, price, nil)
	if err != nil {
		t.Fatalf("build chat without memory: %v", err)
	}
	plain := without.Payload["messages"].([]any)[0].(map[string]any)["content"].(string)
	if plain != DefaultSystemPrompt {
		t.Fatalf("no memory must leave the prompt unchanged: %q", plain)
	}
}

func TestMemoryBlockKeepsNotesStableAndBounded(t *testing.T) {
	if MemoryBlock(nil) != "" {
		t.Fatal("empty memory must add nothing to the system prompt")
	}
	block := MemoryBlock([]string{"  用户叫约翰。 ", "", "喜欢简洁的回答。"})
	if !strings.Contains(block, "- 用户叫约翰。") || !strings.Contains(block, "- 喜欢简洁的回答。") {
		t.Fatalf("memory block missed notes: %q", block)
	}
	if strings.Contains(block, "-  ") {
		t.Fatalf("memory block kept stray whitespace: %q", block)
	}
	if !strings.Contains(block, "以本轮消息为准") {
		t.Fatalf("memory block must defer to the current message: %q", block)
	}

	long := strings.Repeat("很", memoryBlockMaxRunes+100)
	if trimmed := MemoryBlock([]string{long}); strings.Contains(trimmed, long) {
		t.Fatal("oversized memory must be trimmed instead of forwarded whole")
	}
}

func TestParseMemoryExtractionAcceptsFencedJSON(t *testing.T) {
	reply := "```json\n{\"memories\":[\"用户叫约翰。\",\"用户叫约翰。\",\" 喜欢简洁、直接的答案 \",\"正在写一部科幻小说。\",\"第四条\"]}\n```"
	items := ParseMemoryExtraction(reply)
	if len(items) != MemoryExtractMax {
		t.Fatalf("expected %d de-duplicated notes, got %#v", MemoryExtractMax, items)
	}
	if items[0] != "用户叫约翰。" || items[1] != "喜欢简洁、直接的答案" {
		t.Fatalf("unexpected parsed notes: %#v", items)
	}
}

func TestParseMemoryExtractionFallsBackToArray(t *testing.T) {
	items := ParseMemoryExtraction(`["用户叫约翰。", "偏好英文回答"]`)
	if len(items) != 2 || items[1] != "偏好英文回答" {
		t.Fatalf("array reply not parsed: %#v", items)
	}
}

func TestParseMemoryExtractionRejectsOversizedAndMalformed(t *testing.T) {
	if items := ParseMemoryExtraction("not json"); len(items) != 0 {
		t.Fatalf("malformed reply must yield no memories: %#v", items)
	}
	tooLong := strings.Repeat("很", MemoryContentMax+1)
	if items := ParseMemoryExtraction(`{"memories":["` + tooLong + `"]}`); len(items) != 0 {
		t.Fatalf("oversized note must be dropped: %d", len(items))
	}
	if items := ParseMemoryExtraction(`{"memories":[]}`); len(items) != 0 {
		t.Fatalf("empty reply must yield no memories: %#v", items)
	}
}

func TestBuildMemoryExtractionPromptLabelsTurns(t *testing.T) {
	prompt := BuildMemoryExtractionPrompt([]string{"用户叫约翰。"}, []MemoryTurn{
		{Role: "user", Content: "我更喜欢简洁的回答"},
		{Role: "assistant", Content: "好的，我会注意。"},
	})
	for _, want := range []string{"用户叫约翰。", "用户：我更喜欢简洁的回答", "助手：好的，我会注意。", "只返回 JSON"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q: %s", want, prompt)
		}
	}
}
