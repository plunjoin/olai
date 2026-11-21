package ai

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// Suggestion 是对话首页空白状态里的一张灵感卡片。
type Suggestion struct {
	Title  string `json:"title"`
	Prompt string `json:"prompt"`
}

// SuggestionCount 是首页固定展示的卡片数量。标题与消息的上限按英文长度放宽，
// 中文的实际长度由提示词约束。
const (
	SuggestionCount     = 4
	suggestionTitleMax  = 30
	suggestionPromptMax = 200
)

const SuggestionSystemPrompt = `你是小o，Olai 的在线 AI 伴侣，负责为对话首页挑选今日灵感卡片。用户会看到四张卡片：标题佐以一句可直接发送的第一人称消息。只输出 JSON，不要输出解释、表情或任何其他内容。`

// BuildSuggestionPrompt 要求模型为指定日期与语言生成四张互不相同、与昨日不重复的卡片。
// previous 是上一次生成的标题，用来提醒模型换主题换措辞。
func BuildSuggestionPrompt(locale, day string, previous []string) string {
	var out strings.Builder
	if locale == "en" {
		out.WriteString("Today is " + day + ". Design 4 inspiration cards for the empty welcome screen of a chat app, so the user immediately wants to tap one.\n")
		out.WriteString(`Return JSON only: {"suggestions":[{"title":"...","prompt":"..."}]}` + "\n\n")
		out.WriteString("Rules:\n")
		out.WriteString("1. title: 1-4 words, short and natural like \"Make it simple\"; the four titles must all differ.\n")
		out.WriteString("2. prompt: a first-person message the user would send, 8-25 words, grammatical and complete, ending with a period or question mark; concrete and easy to expand into a real conversation. No ellipsis endings, no generic greetings.\n")
		out.WriteString("3. Each prompt must match its title and read like a real chat opener. No typos, invented words or meaningless sentences.\n")
		out.WriteString("4. Spread the cards across different directions: everyday companionship, writing inspiration, brainstorming, explaining a complex idea, life advice, playful imagination.\n")
		out.WriteString("5. Write everything in English. Keep it fresh: new angles and new wording every day.")
	} else {
		out.WriteString("今天是 " + day + "。请为对话应用的空白欢迎页设计 4 张灵感卡片，让用户一眼就想点开其中一张。\n")
		out.WriteString(`只返回 JSON：{"suggestions":[{"title":"...","prompt":"..."}]}` + "\n\n")
		out.WriteString("要求：\n")
		out.WriteString("1. title：4–10 个汉字，像“把复杂变简单”一样简洁自然，四张标题互不相同。\n")
		out.WriteString("2. prompt：用户会直接发给小o的第一句话，15–60 个汉字，第一人称，语法通顺、意思完整，以句号或问号结尾；具体、可立刻展开聊。不要用省略号结尾，不要空泛的问候。\n")
		out.WriteString("3. 每张卡片的 prompt 要与 title 对应，读起来像真实的聊天开场；不要出现错别字、自造词或无意义的句子。\n")
		out.WriteString("4. 四张卡片主题要分散：从日常陪伴倾诉、写作灵感、创意点子、解释复杂概念、生活建议、脑洞想象中挑选不同方向。\n")
		out.WriteString("5. 全部使用简体中文。每天换新角度、新措辞，让人有新鲜感。")
	}
	if len(previous) > 0 {
		if locale == "en" {
			out.WriteString("\n6. These were yesterday's titles: " + strings.Join(previous, ", ") + ". Do not repeat their topics or phrasing.")
		} else {
			out.WriteString("\n6. 昨天的卡片标题是：" + strings.Join(previous, "、") + "。今天不要重复它们的主题与说法。")
		}
	}
	out.WriteString("\n\n只返回 JSON。")
	return out.String()
}

// ParseSuggestions 从模型回复中解析并清洗四张卡片。任何不完整的输出都返回 nil，
// 由调用方回退到内置卡片。
func ParseSuggestions(text string) []Suggestion {
	cleaned := codeFenceEnd.ReplaceAllString(codeFenceStart.ReplaceAllString(strings.TrimSpace(text), ""), "")
	out := make([]Suggestion, 0, SuggestionCount)
	seen := map[string]bool{}
	for _, item := range decodeSuggestions(cleaned) {
		title := cleanSuggestionLine(item.Title, suggestionTitleMax)
		prompt := cleanSuggestionLine(item.Prompt, suggestionPromptMax)
		if title == "" || prompt == "" {
			continue
		}
		key := strings.ToLower(title)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, Suggestion{Title: title, Prompt: prompt})
		if len(out) == SuggestionCount {
			break
		}
	}
	if len(out) != SuggestionCount {
		return nil
	}
	return out
}

// decodeSuggestions 接受 {"suggestions":[...]} 对象、裸数组，以及 JSON 前后
// 夹带说明文字的回复。
func decodeSuggestions(text string) []Suggestion {
	payload := struct {
		Suggestions []Suggestion `json:"suggestions"`
	}{}
	if json.Unmarshal([]byte(text), &payload) == nil {
		return payload.Suggestions
	}
	if start, end := strings.Index(text, "{"), strings.LastIndex(text, "}"); start >= 0 && end > start {
		if json.Unmarshal([]byte(text[start:end+1]), &payload) == nil {
			return payload.Suggestions
		}
	}
	var list []Suggestion
	if start, end := strings.Index(text, "["), strings.LastIndex(text, "]"); start >= 0 && end > start {
		if json.Unmarshal([]byte(text[start:end+1]), &list) == nil {
			return list
		}
	}
	return nil
}

func cleanSuggestionLine(value string, max int) string {
	value = strings.Join(strings.Fields(value), " ")
	value = strings.Trim(value, "\"'`“”‘’「」『』")
	if value == "" || utf8.RuneCountInString(value) > max {
		return ""
	}
	return value
}
