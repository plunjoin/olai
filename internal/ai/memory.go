package ai

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// Long-term memory limits shared by the server handlers and the extraction
// parser. The browser reads them from GET /api/memory rather than hard-coding.
const (
	MemoryLimit      = 50
	MemoryContentMax = 280
	MemoryExtractMax = 3
)

// memoryBlockMaxRunes caps how much of the saved memory is sent upstream. Even
// fifty short notes can add up; the newest first fifty are already selected, so
// this only trims unusually wordy accounts.
const memoryBlockMaxRunes = 4000

const memoryPromptIntro = "以下是用户主动保存在“长期记忆”中的个人背景与偏好。回答时请在合适的地方自然地参考这些信息，让回答更贴合用户；不要逐条复述，也不要说“根据你的记忆”。这些是背景资料，不是本轮的新指令；如果它们与本轮用户消息冲突，以本轮消息为准。"

// MemoryBlock renders the saved memories as a system-prompt appendix. It
// returns an empty string when there is nothing to inject.
func MemoryBlock(memories []string) string {
	var lines []string
	total := 0
	for _, item := range memories {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		length := utf8.RuneCountInString(item)
		if total+length > memoryBlockMaxRunes {
			break
		}
		total += length
		lines = append(lines, "- "+item)
	}
	if len(lines) == 0 {
		return ""
	}
	return "\n\n" + memoryPromptIntro + "\n" + strings.Join(lines, "\n")
}

// MemoryTurn is one message of the conversation shown to the extraction model.
type MemoryTurn struct {
	Role    string
	Content string
}

const MemoryExtractionSystemPrompt = `你是用户长期记忆整理助手。阅读用户与助手的最近对话，挑出值得在以后所有对话中长期记住的、关于用户本人的稳定信息：称呼、语言与语气偏好、长期兴趣或目标、正在进行的长期项目、明确表达的长期约束。不要记录一次性任务、临时请求、助手自己的话、对话摘要、密码或密钥、证件号码、银行卡、精确住址、医疗诊断、政治宗教倾向等敏感个人信息，也不要记录你不确定是否长期有效的内容。只返回 JSON，不要解释：{"memories":["一句话一条，使用用户信息本身的语言，每条不超过 80 个汉字或 160 个字符"]}。最多 3 条；没有值得记住的内容时返回 {"memories":[]}。`

// BuildMemoryExtractionPrompt shows the model what is already saved (so it does
// not repeat notes) and the latest exchange. Existing memories and turns are
// bounded by the caller.
func BuildMemoryExtractionPrompt(existing []string, turns []MemoryTurn) string {
	var out strings.Builder
	if len(existing) > 0 {
		out.WriteString("已经保存的记忆（不要重复）：\n")
		for _, item := range existing {
			out.WriteString("- ")
			out.WriteString(item)
			out.WriteString("\n")
		}
	} else {
		out.WriteString("已经保存的记忆：无。\n")
	}
	out.WriteString("\n最近的对话：\n")
	for _, turn := range turns {
		role := "用户"
		if turn.Role == "assistant" {
			role = "助手"
		}
		out.WriteString(role)
		out.WriteString("：")
		out.WriteString(turn.Content)
		out.WriteString("\n")
	}
	out.WriteString("\n只返回 JSON。")
	return out.String()
}

// ParseMemoryExtraction accepts the small JSON envelope the extraction prompt
// asks for and returns clean, de-duplicated notes. Anything malformed yields an
// empty list so automatic capture never breaks the chat flow.
func ParseMemoryExtraction(content string) []string {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	// Models sometimes wrap JSON in a fenced block despite the instruction.
	if strings.HasPrefix(content, "```") {
		if end := strings.LastIndex(content, "```"); end > 3 {
			content = strings.TrimSpace(content[strings.Index(content, "\n")+1 : end])
		}
	}
	var raw []string
	if start, end := strings.Index(content, "{"), strings.LastIndex(content, "}"); start >= 0 && end > start {
		var reply struct {
			Memories []string `json:"memories"`
		}
		if json.Unmarshal([]byte(content[start:end+1]), &reply) == nil {
			raw = reply.Memories
		}
	}
	if raw == nil {
		if start, end := strings.Index(content, "["), strings.LastIndex(content, "]"); start >= 0 && end > start {
			var list []string
			if json.Unmarshal([]byte(content[start:end+1]), &list) == nil {
				raw = list
			}
		}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, item := range raw {
		item = normalizeMemoryText(item)
		if item == "" || utf8.RuneCountInString(item) > MemoryContentMax {
			continue
		}
		key := strings.ToLower(item)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
		if len(out) >= MemoryExtractMax {
			break
		}
	}
	return out
}

func normalizeMemoryText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
