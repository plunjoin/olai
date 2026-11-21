package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"olai/internal/ai"
	"olai/internal/httpx"
	"olai/internal/media"
	"olai/internal/models"
	"olai/internal/secure"
	"olai/internal/store"
)

const maxProxyBody = 64 * 1024 * 1024

var (
	taskIDPattern = regexp.MustCompile(`^job_[a-zA-Z0-9_-]+$`)
	videoPathRE   = regexp.MustCompile(`^/api/videos/([^/]+)(/content)?$`)
)

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	// Public, non-secret capability flags let the SPA render the same entry
	// gates the previous server-rendered pages applied.
	writeJSON(w, http.StatusOK, map[string]any{
		"ready":        s.AI.Ready(),
		"imageMode":    s.Settings.Get("AI_IMAGE_API_MODE"),
		"audioMode":    s.Settings.Get("AI_AUDIO_API_MODE"),
		"videoMode":    s.AI.VideoMode(s.AI.ServerModel("video")),
		"shortFilm":    s.Settings.Get("AI_SHORT_FILM") == "true",
		"githubLogin":  s.githubLoginEnabled(),
		"googleLogin":  s.googleLoginEnabled(),
		"mediaStorage": s.mediaStorage(),
	})
}

type chargedPoints struct {
	userID string
	cost   int
	ref    string
	// chatHundredths marks a chat charge billed through the fractional
	// accumulator instead of ChargePoints.
	chatHundredths int64
}

func (s *Server) refundGeneration(ctx context.Context, reserveKey string, charged *chargedPoints) {
	if reserveKey != "" {
		_ = s.DB.Refund(ctx, reserveKey)
	}
	if charged != nil {
		if charged.chatHundredths > 0 {
			_ = s.DB.RefundChatPoints(ctx, charged.userID, charged.ref)
			return
		}
		_ = s.DB.CreditPoints(ctx, charged.userID, int64(charged.cost), "refund", charged.ref, "", int64(s.Pricing.SignupBonus()))
	}
}

func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	path := ""
	videoID := ""
	videoContent := false
	if r.URL.Path == "/api/chat/completions" {
		path = "chat/completions"
	} else if kind := r.PathValue("kind"); kind != "" {
		if kind != "image" && kind != "music" && kind != "video" {
			writeError(w, http.StatusNotFound, "接口路径或方法不受支持。")
			return
		}
		path = "generate/" + kind
	} else if match := videoPathRE.FindStringSubmatch(r.URL.Path); match != nil {
		videoID = match[1]
		videoContent = match[2] != ""
		if !taskIDPattern.MatchString(videoID) {
			writeError(w, http.StatusNotFound, "接口路径或方法不受支持。")
			return
		}
		path = "videos/" + videoID
		if videoContent {
			path += "/content"
		}
	} else {
		writeError(w, http.StatusNotFound, "接口路径或方法不受支持。")
		return
	}
	if r.Method == http.MethodPost && videoID != "" || r.Method == http.MethodGet && videoID == "" {
		writeError(w, http.StatusMethodNotAllowed, "接口路径或方法不受支持。")
		return
	}
	if (r.Method == http.MethodPost || r.Header.Get("Origin") != "") && !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	if !s.AI.Ready() {
		writeError(w, http.StatusServiceUnavailable, "创作服务尚未就绪，请联系服务提供方。")
		return
	}

	timeoutCtx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()
	var reservedKey string
	var charged *chargedPoints
	var releaseSlot func()

	defer func() {
		if releaseSlot != nil {
			releaseSlot()
		}
	}()
	refund := func() {
		if reservedKey != "" || charged != nil {
			s.refundGeneration(context.Background(), reservedKey, charged)
			reservedKey = ""
			charged = nil
		}
	}
	charge := func(userID string, cost int) (*int64, error) {
		if cost <= 0 {
			balance, err := s.DB.BalanceOf(timeoutCtx, userID, int64(s.Pricing.SignupBonus()))
			return &balance, err
		}
		ref := secure.ID()
		balance, err := s.DB.ChargePoints(timeoutCtx, userID, int64(cost), ref, int64(s.Pricing.SignupBonus()))
		if err != nil {
			return nil, err
		}
		if balance != nil {
			charged = &chargedPoints{userID: userID, cost: cost, ref: ref}
		}
		return balance, nil
	}

	user, err := s.Auth.CurrentUser(timeoutCtx, r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "账号或额度服务暂不可用，请稍后重试。")
		return
	}
	peerIP, err := s.clientIP(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	owner := "ip:" + httpx.Hash(peerIP)
	if user != nil {
		owner = "user:" + user.ID
	}
	ownsTask := func(id string) (string, error) {
		if !taskIDPattern.MatchString(id) {
			return "", &ai.InputError{Message: "视频任务不存在。"}
		}
		jobOwner, err := s.DB.VideoJobOwner(timeoutCtx, id)
		if errors.Is(err, store.ErrNotFound) || (err == nil && jobOwner != owner) {
			return "", &ai.InputError{Message: "视频任务不存在。"}
		}
		if err != nil {
			return "", err
		}
		internal, err := s.AI.DecodeTaskID(id)
		if err != nil {
			return "", &ai.InputError{Message: "视频任务不存在。"}
		}
		return internal, nil
	}

	var generation *ai.GenerationRequest
	var selection *models.Choice
	usesPreset := false
	upstreamPath := path
	publicTaskID := ""
	if videoID != "" {
		internal, err := ownsTask(videoID)
		if err != nil {
			s.proxyError(w, err, false, timeoutCtx, r)
			return
		}
		upstreamPath = "videos/" + url.PathEscape(internal)
		if videoContent {
			upstreamPath += "/content"
		}
		publicTaskID = videoID
	} else {
		input, err := readJSONObject(r, maxProxyBody)
		if err != nil {
			if errors.Is(err, errBodyTooLarge) {
				writeError(w, http.StatusRequestEntityTooLarge, "请求内容过长。")
			} else {
				writeError(w, http.StatusBadRequest, "请求内容需要是有效的 JSON 对象。")
			}
			return
		}
		// A browser-selected model only applies to ordinary chat and the three
		// generation kinds; internal workflow actions keep the server model.
		if modelID, ok := input["modelId"].(string); ok && modelID != "" {
			expected := models.Kind("")
			switch {
			case path == "chat/completions":
				if action, exists := input["action"]; !exists || action == "chat" {
					expected = models.KindChat
				}
			case path == "generate/image":
				expected = models.KindImage
			case path == "generate/music":
				expected = models.KindMusic
			case path == "generate/video":
				expected = models.KindVideo
			}
			if expected != "" {
				choice, err := s.Models.Resolve(timeoutCtx, modelID, expected)
				if err != nil {
					writeError(w, http.StatusServiceUnavailable, "创作服务暂时无法完成请求，请稍后重试。")
					return
				}
				if choice == nil {
					writeError(w, http.StatusBadRequest, "所选模型不可用，请刷新页面后重新选择。")
					return
				}
				selection = choice
			}
		}
		var memories []string
		if path == "chat/completions" && user != nil {
			if action, _ := input["action"].(string); action == "" || action == "chat" {
				memories, _ = s.DB.ChatMemories(timeoutCtx, user.ID)
			}
		}
		generation, err = s.AI.Build(path, input, selection, s.Pricing, memories)
		if err != nil {
			s.proxyError(w, err, false, timeoutCtx, r)
			return
		}
		if action, ok := input["action"].(string); ok && action != "" && action != "chat" {
			usesPreset = true
		}
		if generation.Kind != "" {
			usesPreset = true
		}
		if extend, exists := input["extendFrom"]; exists {
			text, ok := extend.(string)
			if generation.Path != "videos" || !ok {
				writeError(w, http.StatusBadRequest, "视频延续参数无效。")
				return
			}
			internal, err := ownsTask(text)
			if err != nil {
				s.proxyError(w, err, false, timeoutCtx, r)
				return
			}
			generation.Payload["extend_from"] = internal
		}
		upstreamPath = generation.Path
		if generation.Kind != "" {
			limit := s.dailyLimit(user != nil)
			key := generationReserveKey(owner, generation.Kind, s.dayStart(time.Now()))
			ok, err := s.DB.Reserve(timeoutCtx, key, limit, s.dayStart(time.Now())+48*3_600_000)
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "账号或额度服务暂不可用，请稍后重试。")
				return
			}
			if !ok {
				label := map[string]string{"image": "图片", "music": "音乐", "video": "视频"}[generation.Kind]
				suffix := "登录后可使用账号额度。"
				if user != nil {
					suffix = "请北京时间零点后再试。"
				}
				writeError(w, http.StatusTooManyRequests, "今日"+label+"生成额度已用完（每天 "+strconv.Itoa(limit)+" 次）。"+suffix)
				return
			}
			reservedKey = key
			if user != nil && generation.Points > 0 {
				balance, err := charge(user.ID, generation.Points)
				if err != nil {
					refund()
					writeError(w, http.StatusServiceUnavailable, "账号或额度服务暂不可用，请稍后重试。")
					return
				}
				if balance == nil {
					refund()
					writeError(w, http.StatusPaymentRequired, "积分不足：本次生成需要 "+strconv.Itoa(generation.Points)+" 积分。邀请好友注册可获得积分。")
					return
				}
			}
		} else {
			limit := s.chatDailyLimit(user != nil)
			if limit == 0 {
				writeError(w, http.StatusTooManyRequests, "对话功能已停用。")
				return
			}
			now := time.Now().UnixMilli()
			rate := s.Settings.Int("CHAT_RATE_LIMIT", 30)
			if rate > 0 {
				ok, err := s.DB.Reserve(timeoutCtx, httpx.Hash("chat-rate:"+peerIP+":"+strconv.FormatInt(now/60_000, 10)), rate, now+120_000)
				if err != nil {
					writeError(w, http.StatusServiceUnavailable, "账号或额度服务暂不可用，请稍后重试。")
					return
				}
				if !ok {
					w.Header().Set("Retry-After", "60")
					writeError(w, http.StatusTooManyRequests, "对话请求过于频繁（每分钟最多 "+strconv.Itoa(rate)+" 条），请稍后再试。")
					return
				}
			}
			concurrency := s.Settings.Int("CHAT_CONCURRENT_LIMIT", 20)
			slot, ok := s.acquireChatSlot(peerIP, concurrency)
			if !ok {
				w.Header().Set("Retry-After", "10")
				writeError(w, http.StatusTooManyRequests, "同一 IP 同时进行的对话请求过多（最多 "+strconv.Itoa(concurrency)+" 个），请等待已有请求完成后再试。")
				return
			}
			releaseSlot = slot
			key := generationReserveKey(owner, "chat", s.dayStart(time.Now()))
			ok, err = s.DB.Reserve(timeoutCtx, key, limit, s.dayStart(time.Now())+48*3_600_000)
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "账号或额度服务暂不可用，请稍后重试。")
				return
			}
			if !ok {
				writeError(w, http.StatusTooManyRequests, "今日对话额度已用完（每天 "+strconv.Itoa(limit)+" 条），请北京时间零点后再试。")
				return
			}
			reservedKey = key
			if user != nil && generation.ChatPointsHundredths > 0 {
				ref := secure.ID()
				balance, needed, err := s.DB.ChargeChatPoints(timeoutCtx, user.ID, int64(generation.ChatPointsHundredths), ref, int64(s.Pricing.SignupBonus()))
				if err != nil {
					refund()
					writeError(w, http.StatusServiceUnavailable, "账号或额度服务暂不可用，请稍后重试。")
					return
				}
				if balance == nil {
					refund()
					writeError(w, http.StatusPaymentRequired, "积分不足：本次对话需要 "+strconv.FormatInt(needed, 10)+" 积分。")
					return
				}
				charged = &chargedPoints{userID: user.ID, ref: ref, chatHundredths: int64(generation.ChatPointsHundredths)}
			}
		}
	}

	// The portal records which model produced a work. Only the public alias is
	// exposed: a selected model carries it on the choice, and the server default
	// is matched to its catalog alias by upstream ID. The header is set on
	// successful generation responses only.
	modelLabel := ""
	if generation != nil && generation.Kind != "" {
		if selection != nil {
			modelLabel = selection.Alias
		} else {
			modelLabel = s.Models.AliasForUpstream(timeoutCtx, models.Kind(generation.Kind), s.AI.ServerModel(generation.Kind))
		}
	}
	setModelHeader := func() {
		if label := strings.TrimSpace(modelLabel); label != "" {
			w.Header().Set("X-Olai-Model", url.PathEscape(label))
		}
	}

	base := strings.TrimRight(s.AI.Env("AI_API_BASE_URL"), "/")
	send := func(target string, payload map[string]any) (*http.Response, error) {
		var body io.Reader
		if payload != nil {
			encoded, err := json.Marshal(payload)
			if err != nil {
				return nil, err
			}
			body = bytes.NewReader(encoded)
		}
		request, err := http.NewRequestWithContext(timeoutCtx, r.Method, base+"/"+target, body)
		if err != nil {
			return nil, err
		}
		request.Header.Set("Authorization", "Bearer "+s.AI.Env("AI_API_KEY"))
		request.Header.Set("Accept", "*/*")
		request.Header.Set("User-Agent", "olai")
		if payload != nil {
			request.Header.Set("Content-Type", "application/json")
		}
		client := &http.Client{
			CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
		}
		return client.Do(request)
	}
	var payload map[string]any
	if generation != nil {
		payload = generation.Payload
	}
	upstream, err := send(upstreamPath, payload)
	if err != nil {
		refund()
		s.proxyError(w, err, true, timeoutCtx, r)
		return
	}
	if upstream.StatusCode >= 400 && generation != nil && generation.Fallback != nil &&
		(upstream.StatusCode == http.StatusNotFound || (upstreamPath == "images/generations" && upstream.StatusCode == http.StatusBadGateway)) {
		_, _ = io.Copy(io.Discard, io.LimitReader(upstream.Body, 1<<20))
		upstream.Body.Close()
		upstream, err = send(generation.Fallback.Path, generation.Fallback.Payload)
		if err != nil {
			refund()
			s.proxyError(w, err, true, timeoutCtx, r)
			return
		}
	}
	if upstream.StatusCode < 200 || upstream.StatusCode > 299 {
		status := upstream.StatusCode
		_, _ = io.Copy(io.Discard, io.LimitReader(upstream.Body, 1<<20))
		upstream.Body.Close()
		refund()
		if releaseSlot != nil {
			releaseSlot()
			releaseSlot = nil
		}
		message := "创作服务暂时无法完成请求，请稍后重试。"
		if status == http.StatusTooManyRequests {
			message = "创作服务请求受限，请稍后重试。"
		}
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		writeError(w, status, message)
		return
	}
	if user != nil && generation != nil {
		go s.maybeRewardInvite(user.ID)
	}

	contentType := upstream.Header.Get("Content-Type")
	privatePrompts := []string{}
	if generation != nil {
		for _, item := range []map[string]any{generation.Payload, fallbackPayload(generation.Fallback)} {
			if item == nil {
				continue
			}
			if prompt, ok := item["prompt"].(string); ok {
				privatePrompts = append(privatePrompts, prompt)
			}
			if input, ok := item["input"].(string); ok {
				privatePrompts = append(privatePrompts, input)
			}
			if messages, ok := item["messages"].([]any); ok {
				for _, raw := range messages {
					message, _ := raw.(map[string]any)
					if message == nil {
						continue
					}
					role, _ := message["role"].(string)
					if role != "system" && !usesPreset {
						continue
					}
					switch content := message["content"].(type) {
					case string:
						privatePrompts = append(privatePrompts, content)
					case []any:
						for _, part := range content {
							piece, _ := part.(map[string]any)
							if piece == nil || piece["type"] != "text" {
								continue
							}
							if text, ok := piece["text"].(string); ok {
								privatePrompts = append(privatePrompts, text)
							}
						}
					}
				}
			}
		}
	}
	secrets := s.AI.PrivateValues(privatePrompts)
	lowerType := strings.ToLower(contentType)
	if strings.Contains(lowerType, "text/event-stream") {
		if generation == nil || generation.Kind != "" || !streamRequested(generation.Payload) || upstream.Body == nil {
			upstream.Body.Close()
			refund()
			s.proxyError(w, errors.New("invalid stream response"), true, timeoutCtx, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Accel-Buffering", "no")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		sanitized := ai.PublicSSE(upstream.Body, secrets)
		defer sanitized.Close()
		writer := &flushWriter{w: w}
		if flusher, ok := w.(http.Flusher); ok {
			writer.flusher = flusher
			flusher.Flush()
		}
		_, _ = io.Copy(writer, sanitized)
		return
	}
	if strings.Contains(lowerType, "json") {
		var value any
		err := json.NewDecoder(upstream.Body).Decode(&value)
		upstream.Body.Close()
		if err != nil {
			refund()
			s.proxyError(w, err, true, timeoutCtx, r)
			return
		}
		if object, ok := value.(map[string]any); ok && object["error"] != nil {
			refund()
			if releaseSlot != nil {
				releaseSlot()
				releaseSlot = nil
			}
			writeError(w, http.StatusBadGateway, "创作服务暂时无法完成请求，请稍后重试。")
			return
		}
		if generation != nil && generation.Path == "videos" {
			object, _ := value.(map[string]any)
			internal, _ := object["id"].(string)
			if internal == "" || len(internal) > 2000 {
				refund()
				s.proxyError(w, errors.New("invalid video response"), true, timeoutCtx, r)
				return
			}
			encoded, err := s.AI.EncodeTaskID(internal)
			if err != nil {
				refund()
				s.proxyError(w, err, true, timeoutCtx, r)
				return
			}
			publicTaskID = encoded
			if err := s.DB.InsertVideoJob(timeoutCtx, encoded, owner); err != nil && !store.IsUniqueViolation(err) {
				refund()
				s.proxyError(w, err, true, timeoutCtx, r)
				return
			}
		}
		var result map[string]any
		if generation != nil && generation.Kind != "" && publicTaskID == "" && s.ossEnabled() {
			identity, err := s.Media.Identify(timeoutCtx, w, r)
			if err != nil {
				refund()
				s.proxyError(w, err, true, timeoutCtx, r)
				return
			}
			result, err = s.Media.PersistGeneratedJSON(timeoutCtx, value, generation.Kind, identity)
			if err != nil {
				refund()
				s.proxyError(w, err, true, timeoutCtx, r)
				return
			}
		} else {
			kind := ""
			if generation != nil {
				kind = generation.Kind
			}
			result, err = ai.PublicJSON(value, kind, secrets, publicTaskID)
			if err != nil {
				refund()
				s.proxyError(w, err, true, timeoutCtx, r)
				return
			}
		}
		if releaseSlot != nil {
			releaseSlot()
			releaseSlot = nil
		}
		setModelHeader()
		writeJSON(w, upstream.StatusCode, result)
		return
	}

	expected := ""
	if generation != nil {
		switch generation.Kind {
		case "video":
			expected = "video/"
		case "image":
			expected = "image/"
		case "music":
			expected = "audio/"
		}
	}
	if videoContent {
		expected = "video/"
	}
	lowerCT := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	if expected == "" || (!strings.HasPrefix(lowerCT, expected) && lowerCT != "application/octet-stream") {
		upstream.Body.Close()
		refund()
		s.proxyError(w, errors.New("invalid media response"), true, timeoutCtx, r)
		return
	}
	if ai.RedactText(contentType, secrets) != contentType {
		upstream.Body.Close()
		refund()
		s.proxyError(w, errors.New("invalid media type"), true, timeoutCtx, r)
		return
	}
	if s.ossEnabled() {
		identity, err := s.Media.Identify(timeoutCtx, w, r)
		if err != nil {
			upstream.Body.Close()
			refund()
			s.proxyError(w, err, true, timeoutCtx, r)
			return
		}
		data, err := s.Media.ReadMediaBody(upstream.Body, upstream.ContentLength)
		upstream.Body.Close()
		if err != nil {
			refund()
			s.proxyError(w, err, true, timeoutCtx, r)
			return
		}
		mime := lowerCT
		if mime == "application/octet-stream" {
			switch expected {
			case "video/":
				mime = "video/mp4"
			case "image/":
				mime = "image/png"
			default:
				mime = "audio/mpeg"
			}
		}
		if expected == "audio/" {
			data, mime = media.NormalizeAudio(data, contentType)
		}
		if err := s.Media.ReserveBytes(timeoutCtx, identity, int64(len(data))); err != nil {
			refund()
			s.proxyError(w, err, true, timeoutCtx, r)
			return
		}
		attachment := secure.ID()
		if publicTaskID != "" {
			attachment = "video-" + httpx.Hash(publicTaskID)
		}
		stored, err := s.Media.Store(timeoutCtx, data, mime, attachment, identity)
		if err != nil {
			refund()
			s.proxyError(w, err, true, timeoutCtx, r)
			return
		}
		if releaseSlot != nil {
			releaseSlot()
			releaseSlot = nil
		}
		if videoContent {
			w.Header().Set("Content-Type", stored.Mime)
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Olai-Media-Url", "/api/media/"+stored.ID)
			w.WriteHeader(upstream.StatusCode)
			if r.Method != http.MethodHead {
				_, _ = w.Write(data)
			}
			return
		}
		setModelHeader()
		writeJSON(w, upstream.StatusCode, map[string]any{"data": []any{map[string]any{
			"url": "/api/media/" + stored.ID, "mime_type": stored.Mime,
		}}})
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	setModelHeader()
	w.WriteHeader(upstream.StatusCode)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, upstream.Body)
	}
	upstream.Body.Close()
}

func fallbackPayload(fallback *ai.GenerationFallback) map[string]any {
	if fallback == nil {
		return nil
	}
	return fallback.Payload
}

func streamRequested(payload map[string]any) bool {
	value, ok := payload["stream"].(bool)
	return ok && value
}

func generationReserveKey(owner, kind string, dayStart int64) string {
	return httpx.Hash("gen:" + owner + ":" + kind + ":" + strconv.FormatInt(dayStart, 10))
}

func (s *Server) proxyError(w http.ResponseWriter, err error, upstreamStarted bool, ctx context.Context, r *http.Request) {
	var input *ai.InputError
	if errors.As(err, &input) {
		status := http.StatusBadRequest
		if input.Message == "视频任务不存在。" {
			status = http.StatusNotFound
		}
		writeError(w, status, input.Message)
		return
	}
	var clientErr *httpx.ClientIPError
	if errors.As(err, &clientErr) {
		writeError(w, http.StatusBadRequest, clientErr.Message)
		return
	}
	var mediaErr *media.Error
	if errors.As(err, &mediaErr) {
		media.WriteFailure(w, mediaErr, r.Method == http.MethodHead)
		return
	}
	if !upstreamStarted {
		writeError(w, http.StatusServiceUnavailable, "账号或额度服务暂不可用，请稍后重试。")
		return
	}
	switch {
	case ctx.Err() == context.DeadlineExceeded:
		writeError(w, http.StatusBadGateway, "创作请求超时，请稍后重试。")
	case r.Context().Err() != nil:
		writeError(w, http.StatusBadGateway, "请求已停止。")
	default:
		writeError(w, http.StatusBadGateway, "创作服务暂时无法完成请求，请稍后重试。")
	}
}

type flushWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func (f *flushWriter) Write(p []byte) (int, error) {
	n, err := f.w.Write(p)
	if f.flusher != nil {
		f.flusher.Flush()
	}
	return n, err
}
