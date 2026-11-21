package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"olai/internal/ai"
	"olai/internal/httpx"
)

const (
	suggestionTimeout    = 25 * time.Second
	suggestionRetryAfter = 10 * time.Minute
	suggestionSettingKey = "DAILY_SUGGESTIONS_"
)

// suggestionSet 是对话首页当前展示的一组灵感卡片，按北京时间每天一份。
type suggestionSet struct {
	Day   string          `json:"day"`
	Items []ai.Suggestion `json:"suggestions"`
}

// suggestionFallbacks 是模型不可用时的内置卡片池。按日期轮换，保证每天看到的
// 四张卡片也不相同；前四张与旧版首页保持一致。
var suggestionFallbacks = map[string][]ai.Suggestion{
	"zh-CN": {
		{Title: "日常闲聊与倾诉", Prompt: "今天有点累，想找你聊聊天，听听你轻松温暖的话语。"},
		{Title: "写点有意思的", Prompt: "为一家独立咖啡馆写 3 条有温度的品牌文案，简短而有记忆点。"},
		{Title: "一起想个点子", Prompt: "我想做一个周末创意项目，请帮我想 5 个有趣而且可以在两天内完成的点子。"},
		{Title: "把复杂变简单", Prompt: "用生动的语言和一个生活中的例子，向我解释什么是机器学习。"},
		{Title: "深夜情绪树洞", Prompt: "最近有点睡不好，陪我说说怎么让心慢慢静下来。"},
		{Title: "给老朋友写句话", Prompt: "帮我想几句真诚又不肉麻的话，写给很久没联系的老朋友。"},
		{Title: "换个角度看问题", Prompt: "我最近做了一个不太顺利的决定，陪我换个角度复盘一下吧。"},
		{Title: "假装在旅行", Prompt: "用文字带我逛一座适合独自散步的小城，最好有清晨的街景。"},
	},
	"en": {
		{Title: "Just talk", Prompt: "I'm a bit worn out today. I'd love to talk and hear something gentle and warm."},
		{Title: "Write something fun", Prompt: "Write 3 warm brand lines for an independent coffee shop — short and memorable."},
		{Title: "Brainstorm with me", Prompt: "I want a weekend creative project. Give me 5 fun ideas I can finish in two days."},
		{Title: "Make it simple", Prompt: "Explain machine learning with vivid language and one everyday example."},
		{Title: "A late-night heart-to-heart", Prompt: "I haven't been sleeping well. Walk me through a few gentle ways to calm my mind."},
		{Title: "Words for an old friend", Prompt: "Help me write something sincere but not sappy to a friend I haven't talked to in ages."},
		{Title: "A second look", Prompt: "I made a decision that didn't go well. Help me look at it from another angle."},
		{Title: "Take me traveling", Prompt: "Take me on a written walk through a small town that's perfect for wandering alone — early morning streets included."},
	},
}

// fallbackSuggestions 按日期在卡片池里取一段窗口，连续两天不会出现同一组。
func fallbackSuggestions(locale, day string) []ai.Suggestion {
	pool := suggestionFallbacks[locale]
	if len(pool) == 0 {
		pool = suggestionFallbacks["zh-CN"]
	}
	if len(pool) <= ai.SuggestionCount {
		return append([]ai.Suggestion(nil), pool...)
	}
	offset := 0
	if parsed, err := time.ParseInLocation("2006-01-02", day, time.UTC); err == nil {
		offset = int(parsed.Unix()/86400) % len(pool)
	}
	out := make([]ai.Suggestion, 0, ai.SuggestionCount)
	for index := 0; index < ai.SuggestionCount; index++ {
		out = append(out, pool[(offset+index)%len(pool)])
	}
	return out
}

func suggestionLocale(r *http.Request) string {
	if value := r.URL.Query().Get("locale"); value == "en" || value == "zh-CN" {
		return value
	}
	return requestLocale(r)
}

func (s *Server) handleSuggestions(w http.ResponseWriter, r *http.Request) {
	set := s.dailySuggestions(r.Context(), suggestionLocale(r))
	writeJSON(w, http.StatusOK, map[string]any{"day": set.Day, "suggestions": set.Items})
}

// dailySuggestions 返回今天的四张卡片。默认对话模型每天每种语言生成一次，
// 结果写入 app_settings，重启或多实例部署都不会重复生成。生成完成前、以及
// 模型调用失败时，返回按日期轮换的内置卡片。
func (s *Server) dailySuggestions(ctx context.Context, locale string) suggestionSet {
	day := httpx.DayKey(time.Now())
	fallback := suggestionSet{Day: day, Items: fallbackSuggestions(locale, day)}

	s.suggestMu.Lock()
	if entry, ok := s.suggestCache[locale]; ok && entry.Day == day {
		s.suggestMu.Unlock()
		return entry
	}
	if s.suggestPending[locale] {
		// 另一个请求正在生成；先展示内置卡片，结果就绪后自动生效。
		s.suggestMu.Unlock()
		return fallback
	}
	if retryAt, ok := s.suggestRetryAt[locale]; ok && time.Now().Before(retryAt) {
		s.suggestMu.Unlock()
		return fallback
	}
	s.suggestPending[locale] = true
	previous := s.suggestCache[locale].Items
	s.suggestMu.Unlock()

	entry, ok := s.generateDailySuggestions(ctx, locale, day, previous)

	s.suggestMu.Lock()
	delete(s.suggestPending, locale)
	if ok {
		s.suggestCache[locale] = entry
		delete(s.suggestRetryAt, locale)
	} else {
		s.suggestRetryAt[locale] = time.Now().Add(suggestionRetryAfter)
	}
	s.suggestMu.Unlock()
	if !ok {
		return fallback
	}
	return entry
}

// generateDailySuggestions 先读数据库里今天的结果，未命中再调用默认对话模型。
func (s *Server) generateDailySuggestions(ctx context.Context, locale, day string, previous []ai.Suggestion) (suggestionSet, bool) {
	if stored, ok := s.loadStoredSuggestions(ctx, locale); ok {
		if stored.Day == day {
			return stored, true
		}
		if len(previous) == 0 {
			previous = stored.Items
		}
	}
	if !s.AI.Ready() {
		return suggestionSet{}, false
	}
	// 即使浏览器提前断开，也把这次生成跑完并缓存，供下一位访客使用。
	genCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), suggestionTimeout)
	defer cancel()
	titles := make([]string, 0, len(previous))
	for _, item := range previous {
		titles = append(titles, item.Title)
	}
	items, err := s.callSuggestionModel(genCtx, locale, day, titles)
	if err != nil {
		log.Printf("每日灵感卡片生成失败（%s）：%v", locale, err)
		return suggestionSet{}, false
	}
	entry := suggestionSet{Day: day, Items: items}
	s.storeSuggestions(genCtx, locale, entry)
	return entry, true
}

func (s *Server) loadStoredSuggestions(ctx context.Context, locale string) (suggestionSet, bool) {
	if s.DB == nil {
		return suggestionSet{}, false
	}
	raw, ok, err := s.DB.SettingValue(ctx, suggestionSettingKey+locale)
	if err != nil || !ok {
		return suggestionSet{}, false
	}
	var entry suggestionSet
	if json.Unmarshal([]byte(raw), &entry) != nil || entry.Day == "" || len(entry.Items) != ai.SuggestionCount {
		return suggestionSet{}, false
	}
	return entry, true
}

func (s *Server) storeSuggestions(ctx context.Context, locale string, entry suggestionSet) {
	if s.DB == nil {
		return
	}
	encoded, err := json.Marshal(entry)
	if err != nil {
		return
	}
	if err := s.DB.SaveSettings(ctx, map[string]string{suggestionSettingKey + locale: string(encoded)}, nil, "system:suggestions"); err != nil {
		log.Printf("每日灵感卡片保存失败（%s）：%v", locale, err)
	}
}

// callSuggestionModel 用默认对话模型生成四张卡片；输出会经过与对话相同的
// 脱敏处理，避免模型把服务端提示词或模型名带回页面。
func (s *Server) callSuggestionModel(ctx context.Context, locale, day string, previous []string) ([]ai.Suggestion, error) {
	base := strings.TrimRight(s.AI.Env("AI_API_BASE_URL"), "/")
	key := s.AI.Env("AI_API_KEY")
	if base == "" || key == "" {
		return nil, errors.New("AI 服务尚未配置")
	}
	payload := map[string]any{
		"model":       s.AI.ServerModel("chat"),
		"stream":      false,
		"temperature": 0.9,
		"messages": []any{
			map[string]any{"role": "system", "content": ai.SuggestionSystemPrompt},
			map[string]any{"role": "user", "content": ai.BuildSuggestionPrompt(locale, day, previous)},
		},
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/chat/completions", bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "olai")
	client := &http.Client{
		Timeout:       suggestionTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
		return nil, fmt.Errorf("上游返回 %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var reply struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &reply); err != nil {
		return nil, err
	}
	if len(reply.Choices) == 0 {
		return nil, errors.New("上游没有返回内容")
	}
	content := ai.RedactText(suggestionContent(reply.Choices[0].Message.Content), s.AI.PrivateValues(nil))
	items := ai.ParseSuggestions(content)
	if len(items) != ai.SuggestionCount {
		return nil, errors.New("上游返回的卡片格式不完整")
	}
	return items, nil
}

func suggestionContent(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		var out strings.Builder
		for _, part := range typed {
			if object, ok := part.(map[string]any); ok {
				if text, ok := object["text"].(string); ok {
					out.WriteString(text)
				}
			}
		}
		return out.String()
	default:
		return ""
	}
}
