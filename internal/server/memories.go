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
	"unicode/utf8"

	"olai/internal/ai"
	"olai/internal/secure"
	"olai/internal/store"
)

const (
	memoryWriteWindow    = 10 * time.Minute
	memoryWriteLimit     = 40
	memoryExtractWindow  = time.Hour
	memoryExtractLimit   = 20
	memoryExtractTimeout = 30 * time.Second
	memoryExtractInput   = 12000
)

// normalizeMemoryContent collapses whitespace and enforces the shared length
// limit. Memories are one short note each, so line breaks become spaces.
func normalizeMemoryContent(value any) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	text = strings.Join(strings.Fields(text), " ")
	length := utf8.RuneCountInString(text)
	if length == 0 || length > ai.MemoryContentMax {
		return "", false
	}
	return text, true
}

func memoryStateResponse(settings store.MemorySettings, items []store.Memory) map[string]any {
	if items == nil {
		items = []store.Memory{}
	}
	return map[string]any{
		"enabled": settings.Enabled, "autoCapture": settings.AutoCapture,
		"limit": ai.MemoryLimit, "maxLength": ai.MemoryContentMax, "memories": items,
	}
}

func (s *Server) memoryUser(w http.ResponseWriter, r *http.Request) (*store.SessionUser, bool) {
	user, err := s.currentUser(r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return nil, false
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录后管理记忆。")
		return nil, false
	}
	return user, true
}

// memoryWriteAllowed throttles add/edit/delete calls. Reads are cheap enough to
// stay unthrottled.
func (s *Server) memoryWriteAllowed(ctx context.Context, w http.ResponseWriter, userID, bucket string, limit int, window time.Duration) bool {
	now := time.Now().UnixMilli()
	windowMs := window.Milliseconds()
	ok, err := s.DB.Reserve(ctx, hashKey("memory:"+bucket+":"+userID)+":"+fmtInt(now/windowMs), limit, now+2*windowMs)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号服务暂不可用，请稍后重试。")
		return false
	}
	if !ok {
		writeError(w, http.StatusTooManyRequests, "记忆操作过于频繁，请稍后再试。")
		return false
	}
	return true
}

func (s *Server) handleMemoryList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.memoryUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	settings, err := s.DB.MemorySettings(ctx, user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	items, err := s.DB.MemoryList(ctx, user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusOK, memoryStateResponse(settings, items))
}

func (s *Server) handleMemoryCreate(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, ok := s.memoryUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if !s.memoryWriteAllowed(ctx, w, user.ID, "write", memoryWriteLimit, memoryWriteWindow) {
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		writeError(w, http.StatusBadRequest, "请求内容无效。")
		return
	}
	content, valid := normalizeMemoryContent(input["content"])
	if !valid {
		writeError(w, http.StatusBadRequest, "记忆内容需要 1–280 个字符。")
		return
	}
	items, err := s.DB.MemoryList(ctx, user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	for _, item := range items {
		if strings.EqualFold(item.Content, content) {
			writeError(w, http.StatusConflict, "这条记忆已经存在。")
			return
		}
	}
	item, err := s.DB.CreateMemory(ctx, user.ID, secure.ID(), content, "manual", ai.MemoryLimit)
	if errors.Is(err, store.ErrMemoryLimit) {
		writeError(w, http.StatusConflict, "记忆数量已达上限，请先删除不再需要的记忆。")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"memory": item})
}

func (s *Server) handleMemoryUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, ok := s.memoryUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if !s.memoryWriteAllowed(ctx, w, user.ID, "write", memoryWriteLimit, memoryWriteWindow) {
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" || len(id) > 64 {
		writeError(w, http.StatusNotFound, "这条记忆不存在或已被删除。")
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		writeError(w, http.StatusBadRequest, "请求内容无效。")
		return
	}
	content, valid := normalizeMemoryContent(input["content"])
	if !valid {
		writeError(w, http.StatusBadRequest, "记忆内容需要 1–280 个字符。")
		return
	}
	items, err := s.DB.MemoryList(ctx, user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	for _, item := range items {
		if item.ID != id && strings.EqualFold(item.Content, content) {
			writeError(w, http.StatusConflict, "这条记忆已经存在。")
			return
		}
	}
	updated, err := s.DB.UpdateMemory(ctx, user.ID, id, content)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	if !updated {
		writeError(w, http.StatusNotFound, "这条记忆不存在或已被删除。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"memory": map[string]any{
		"id": id, "content": content, "updatedAt": time.Now().UnixMilli(),
	}})
}

func (s *Server) handleMemoryDelete(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, ok := s.memoryUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if !s.memoryWriteAllowed(ctx, w, user.ID, "write", memoryWriteLimit, memoryWriteWindow) {
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" || len(id) > 64 {
		writeError(w, http.StatusNotFound, "这条记忆不存在或已被删除。")
		return
	}
	deleted, err := s.DB.DeleteMemory(ctx, user.ID, id)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "这条记忆不存在或已被删除。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMemoryClear(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, ok := s.memoryUser(w, r)
	if !ok {
		return
	}
	if !s.memoryWriteAllowed(r.Context(), w, user.ID, "write", memoryWriteLimit, memoryWriteWindow) {
		return
	}
	if err := s.DB.ClearMemories(r.Context(), user.ID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMemorySettings(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, ok := s.memoryUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if !s.memoryWriteAllowed(ctx, w, user.ID, "write", memoryWriteLimit, memoryWriteWindow) {
		return
	}
	input, err := readJSONObject(r, 4096)
	if err != nil {
		writeError(w, http.StatusBadRequest, "请求内容无效。")
		return
	}
	enabled, okEnabled := input["enabled"].(bool)
	autoCapture, okAuto := input["autoCapture"].(bool)
	if !okEnabled || !okAuto {
		writeError(w, http.StatusBadRequest, "记忆设置无效。")
		return
	}
	// Automatic capture only makes sense while memory is on; keep the two
	// switches consistent even if an older client sends an impossible pair.
	if !enabled {
		autoCapture = false
	}
	settings := store.MemorySettings{Enabled: enabled, AutoCapture: autoCapture}
	if err := s.DB.SaveMemorySettings(ctx, user.ID, settings); err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": settings.Enabled, "autoCapture": settings.AutoCapture})
}

// memoryTurns validates the excerpt the browser submits for automatic capture.
// Anything larger is ignored, never forwarded as-is.
func memoryTurns(value any) []ai.MemoryTurn {
	raw, _ := value.([]any)
	if len(raw) == 0 {
		return nil
	}
	if len(raw) > 6 {
		raw = raw[len(raw)-6:]
	}
	turns := make([]ai.MemoryTurn, 0, len(raw))
	total := 0
	for _, item := range raw {
		object, _ := item.(map[string]any)
		if object == nil {
			continue
		}
		role, _ := object["role"].(string)
		if role != "user" && role != "assistant" {
			continue
		}
		content, _ := object["content"].(string)
		content = strings.TrimSpace(content)
		if content == "" {
			continue
		}
		runes := []rune(content)
		if len(runes) > 4000 {
			content = string(runes[:4000])
		}
		total += utf8.RuneCountInString(content)
		if total > memoryExtractInput {
			break
		}
		turns = append(turns, ai.MemoryTurn{Role: role, Content: content})
	}
	return turns
}

func (s *Server) handleMemoryExtract(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	user, ok := s.memoryUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	settings, err := s.DB.MemorySettings(ctx, user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	// Disabled capture is not an error: the client fires this after replies and
	// must not surface a failure to the user.
	if !settings.Enabled || !settings.AutoCapture || !s.AI.Ready() {
		writeJSON(w, http.StatusOK, map[string]any{"memories": []store.Memory{}})
		return
	}
	if !s.memoryWriteAllowed(ctx, w, user.ID, "extract", memoryExtractLimit, memoryExtractWindow) {
		return
	}
	input, err := readJSONObject(r, 256*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "请求内容无效。")
		return
	}
	turns := memoryTurns(input["messages"])
	if len(turns) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"memories": []store.Memory{}})
		return
	}
	existing, err := s.DB.MemoryList(ctx, user.ID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "记忆服务暂不可用，请稍后重试。")
		return
	}
	contents := make([]string, 0, len(existing))
	known := make(map[string]bool, len(existing))
	for _, item := range existing {
		contents = append(contents, item.Content)
		known[strings.ToLower(item.Content)] = true
	}
	reply, err := s.callMemoryExtraction(ctx, contents, turns)
	if err != nil {
		log.Printf("自动记忆提取失败：%v", err)
		writeJSON(w, http.StatusOK, map[string]any{"memories": []store.Memory{}})
		return
	}
	candidates := ai.ParseMemoryExtraction(reply)
	created := []store.Memory{}
	count := len(existing)
	for _, content := range candidates {
		key := strings.ToLower(content)
		if known[key] {
			continue
		}
		if count >= ai.MemoryLimit {
			break
		}
		item, err := s.DB.CreateMemory(ctx, user.ID, secure.ID(), content, "auto", ai.MemoryLimit)
		if errors.Is(err, store.ErrMemoryLimit) {
			break
		}
		if err != nil {
			log.Printf("自动记忆保存失败：%v", err)
			break
		}
		known[key] = true
		count++
		created = append(created, *item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": created})
}

// callMemoryExtraction asks the default chat model for JSON memory candidates.
// The reply is redacted with the same secret list as ordinary chat output.
func (s *Server) callMemoryExtraction(ctx context.Context, existing []string, turns []ai.MemoryTurn) (string, error) {
	base := strings.TrimRight(s.AI.Env("AI_API_BASE_URL"), "/")
	key := s.AI.Env("AI_API_KEY")
	if base == "" || key == "" {
		return "", errors.New("AI 服务尚未配置")
	}
	payload := map[string]any{
		"model":       s.AI.ServerModel("chat"),
		"stream":      false,
		"temperature": 0.2,
		"max_tokens":  512,
		"messages": []any{
			map[string]any{"role": "system", "content": ai.MemoryExtractionSystemPrompt},
			map[string]any{"role": "user", "content": ai.BuildMemoryExtractionPrompt(existing, turns)},
		},
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	genCtx, cancel := context.WithTimeout(ctx, memoryExtractTimeout)
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
		Timeout:       memoryExtractTimeout,
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
	var reply struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &reply); err != nil {
		return "", err
	}
	if len(reply.Choices) == 0 {
		return "", errors.New("上游没有返回内容")
	}
	return ai.RedactText(suggestionContent(reply.Choices[0].Message.Content), s.AI.PrivateValues(nil)), nil
}
