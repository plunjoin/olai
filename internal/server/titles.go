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
	titleTimeout     = 15 * time.Second
	titleInputRunes  = 4000
	titleReplyRunes  = 2000
	titleMinuteLimit = 10
	titleDailyLimit  = 300
)

// handleTitle summarizes a conversation or work prompt with the configured
// default chat model and returns one short title in the caller's language. It
// is a best-effort enhancement: an unavailable model or a throttled caller
// gets an empty title and the client keeps its own truncated fallback.
func (s *Server) handleTitle(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	input, err := readJSONObject(r, 64*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "请求内容无效。")
		return
	}
	kind, _ := input["kind"].(string)
	if kind != "conversation" && kind != "work" {
		writeError(w, http.StatusBadRequest, "标题类型无效。")
		return
	}
	text, _ := input["text"].(string)
	text = strings.TrimSpace(text)
	if text == "" {
		writeError(w, http.StatusBadRequest, "缺少需要概括的内容。")
		return
	}
	text = ai.ClampTitleInput(text, titleInputRunes)
	reply := ""
	if value, ok := input["reply"].(string); ok {
		reply = ai.ClampTitleInput(strings.TrimSpace(value), titleReplyRunes)
	}
	locale := requestLocale(r)
	if value, _ := input["locale"].(string); value == "en" || value == "zh-CN" {
		locale = value
	}
	empty := func() { writeJSON(w, http.StatusOK, map[string]any{"title": ""}) }
	if !s.AI.Ready() {
		empty()
		return
	}
	if !s.titleAllowed(r) {
		empty()
		return
	}
	title, err := s.callTitleModel(r.Context(), kind, locale, text, reply)
	if err != nil {
		log.Printf("标题生成失败（%s）：%v", kind, err)
		empty()
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"title": title})
}

// titleAllowed throttles title calls per account (or guest IP). The endpoint is
// cheap but still reaches the model, so it must not be a free proxy for it.
func (s *Server) titleAllowed(r *http.Request) bool {
	if s.DB == nil {
		return false
	}
	owner := ""
	if user, err := s.currentUser(r); err == nil && user != nil {
		owner = "user:" + user.ID
	} else if ip, err := s.clientIP(r); err == nil {
		owner = "ip:" + httpx.Hash(ip)
	}
	if owner == "" {
		return false
	}
	ctx := r.Context()
	now := time.Now()
	minute := now.UnixMilli() / 60_000
	ok, err := s.DB.Reserve(ctx, httpx.Hash("title:"+owner+":"+fmtInt(minute)), titleMinuteLimit, now.UnixMilli()+120_000)
	if err != nil || !ok {
		return false
	}
	dayStart := s.dayStart(now)
	ok, err = s.DB.Reserve(ctx, httpx.Hash("title-day:"+owner+":"+fmtInt(dayStart)), titleDailyLimit, dayStart+48*3_600_000)
	return err == nil && ok
}

// callTitleModel asks the server's default chat model (AI_CHAT_MODEL) for one
// title. The reply is scrubbed of configured secrets but keeps ordinary words
// such as model names a user may legitimately mention in their prompt.
func (s *Server) callTitleModel(ctx context.Context, kind, locale, text, reply string) (string, error) {
	base := strings.TrimRight(s.AI.Env("AI_API_BASE_URL"), "/")
	key := s.AI.Env("AI_API_KEY")
	if base == "" || key == "" {
		return "", errors.New("AI 服务尚未配置")
	}
	payload := map[string]any{
		"model":       s.AI.ServerModel("chat"),
		"stream":      false,
		"temperature": 0.3,
		"max_tokens":  60,
		"messages": []any{
			map[string]any{"role": "system", "content": ai.TitleSystemPrompt(locale)},
			map[string]any{"role": "user", "content": ai.BuildTitlePrompt(kind, locale, text, reply)},
		},
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	genCtx, cancel := context.WithTimeout(ctx, titleTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(genCtx, http.MethodPost, base+"/chat/completions", bytes.NewReader(encoded))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "olai")
	client := &http.Client{
		Timeout:       titleTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
		return "", fmt.Errorf("上游返回 %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	if len(result.Choices) == 0 {
		return "", errors.New("上游没有返回内容")
	}
	content := ai.RedactSecrets(suggestionContent(result.Choices[0].Message.Content), s.AI.PrivateValues(nil))
	title := ai.ParseTitle(content)
	if title == "" {
		return "", errors.New("上游没有返回有效标题")
	}
	return title, nil
}
