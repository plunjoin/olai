package ai

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"

	"olai/internal/models"
	"olai/internal/pricing"
)

type InputError struct{ Message string }

func (e *InputError) Error() string { return e.Message }

const invalidMessage = "请提供有效的创作内容和参数。"

func invalid() error { return &InputError{Message: invalidMessage} }

// preferredTier keeps the usual default when the model supports it and falls
// back to the model's first supported tier otherwise.
func preferredTier(tiers []string, fallback string) string {
	for _, tier := range tiers {
		if tier == fallback {
			return fallback
		}
	}
	if len(tiers) > 0 {
		return tiers[0]
	}
	return fallback
}

func text(value any, max int) (string, error) {
	if s, ok := value.(string); ok && len([]rune(s)) <= max {
		return s, nil
	}
	return "", invalid()
}

func number(value any, fallback, min, max float64) (float64, error) {
	if value == nil {
		return fallback, nil
	}
	n, ok := value.(float64)
	if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < min || n > max {
		return 0, invalid()
	}
	return n, nil
}

func numberPresent(value any) bool { return value != nil }

func pick(value any, values []string, fallback string) (string, error) {
	if value == nil {
		return fallback, nil
	}
	s, ok := value.(string)
	if !ok {
		return "", invalid()
	}
	for _, candidate := range values {
		if candidate == s {
			return s, nil
		}
	}
	return "", invalid()
}

func object(value any) (map[string]any, error) {
	if m, ok := value.(map[string]any); ok {
		return m, nil
	}
	return nil, invalid()
}

func optionalBool(input map[string]any, key string) bool {
	value, _ := input[key].(bool)
	return value
}

type GenerationRequest struct {
	Path   string
	Kind   string
	Points int
	// ChatPointsHundredths carries the per-message chat price in hundredths of
	// a point so two-decimal prices can be billed by accumulation.
	ChatPointsHundredths int
	Payload              map[string]any
	Fallback             *GenerationFallback
}

type GenerationFallback struct {
	Path    string
	Payload map[string]any
}

func workflowInput(input map[string]any) ([]WorkflowElement, error) {
	if input["elements"] == nil {
		return nil, nil
	}
	raw, ok := input["elements"].([]any)
	if !ok || len(raw) > 100 {
		return nil, invalid()
	}
	var elements []WorkflowElement
	for _, item := range raw {
		source, err := object(item)
		if err != nil {
			return nil, err
		}
		id, err := text(source["id"], 100)
		if err != nil {
			return nil, err
		}
		name, err := text(source["name"], 200)
		if err != nil {
			return nil, err
		}
		description, err := text(source["description"], 5000)
		if err != nil {
			return nil, err
		}
		kind, err := pick(source["kind"], []string{"character", "scene", "prop"}, "character")
		if err != nil {
			return nil, err
		}
		elements = append(elements, WorkflowElement{ID: id, Kind: kind, Name: name, Description: description})
	}
	return elements, nil
}

func styleBible(value any) (StyleBible, error) {
	source, err := object(value)
	if err != nil {
		return StyleBible{}, err
	}
	var style StyleBible
	for _, field := range []struct {
		key  string
		dest *string
	}{
		{"appearance", &style.Appearance},
		{"wardrobe", &style.Wardrobe},
		{"artStyle", &style.ArtStyle},
		{"palette", &style.Palette},
	} {
		textValue, err := text(source[field.key], 5000)
		if err != nil {
			return StyleBible{}, err
		}
		*field.dest = textValue
	}
	return style, nil
}

func shotInput(value any) (Shot, error) {
	source, err := object(value)
	if err != nil {
		return Shot{}, err
	}
	var shot Shot
	if shot.ID, err = text(source["id"], 100); err != nil {
		return Shot{}, err
	}
	shotNumber, err := number(source["number"], 1, 1, 1000)
	if err != nil {
		return Shot{}, err
	}
	shot.Number = int(shotNumber)
	if shot.Duration, err = number(source["duration"], 4, 1, 30); err != nil {
		return Shot{}, err
	}
	if shot.SceneDescription, err = text(source["sceneDescription"], 10000); err != nil {
		return Shot{}, err
	}
	if shot.Framing, err = text(source["framing"], 1000); err != nil {
		return Shot{}, err
	}
	if shot.CameraMovement, err = text(source["cameraMovement"], 1000); err != nil {
		return Shot{}, err
	}
	if raw, ok := source["elementIds"].([]any); ok {
		for _, item := range raw {
			if value, ok := item.(string); ok && len(shot.ElementIDs) < 100 {
				shot.ElementIDs = append(shot.ElementIDs, value)
			}
		}
	}
	return shot, nil
}

var ratioPattern = regexp.MustCompile(`^(\d{1,4}(?:\.\d{1,2})?)\s*[:：/]\s*(\d{1,4}(?:\.\d{1,2})?)$`)

func normalizeRatio(value string) (string, error) {
	if value == "auto" {
		return value, nil
	}
	match := ratioPattern.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return "", &InputError{Message: "请填写有效比例，例如 16:9 或 2.35:1。"}
	}
	w, h := parseFloat(match[1]), parseFloat(match[2])
	if w <= 0 || h <= 0 {
		return "", &InputError{Message: "请填写有效比例，例如 16:9 或 2.35:1。"}
	}
	return formatNumber(w) + ":" + formatNumber(h), nil
}

func parseFloat(value string) float64 {
	out, _ := strconv.ParseFloat(value, 64)
	return out
}

func imageDimensions(ratio, quality string) string {
	if ratio == "auto" {
		return ""
	}
	normalized, err := normalizeRatio(ratio)
	if err != nil {
		return ""
	}
	parts := strings.SplitN(normalized, ":", 2)
	w, h := parseFloat(parts[0]), parseFloat(parts[1])
	edge := 1024.0
	switch quality {
	case "4K":
		edge = 4096
	case "2K":
		edge = 2048
	}
	return itoa(int(math.Max(1, math.Round(edge*math.Min(1, w/h))))) + "x" +
		itoa(int(math.Max(1, math.Round(edge*math.Min(1, h/w)))))
}

var referencePattern = regexp.MustCompile(`(?i)^data:image/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$`)
var interactionImagePattern = regexp.MustCompile(`(?i)^data:(image/[^;]+);base64,(.+)$`)

var interactionRatios = map[string]bool{
	"1:1": true, "2:3": true, "3:2": true, "3:4": true, "4:3": true, "4:5": true,
	"5:4": true, "9:16": true, "16:9": true, "21:9": true, "1:8": true, "8:1": true,
	"1:4": true, "4:1": true,
}

// Build assembles a provider request from the application contract. Provider
// payloads from the browser are never forwarded.
// memories are the account's saved long-term notes. They are read from the
// database by the server and appended only to ordinary chat system prompts, so
// a browser request can never inject or edit them.
func (m *Manager) Build(path string, input map[string]any, choice *models.Choice, price *pricing.Manager, memories []string) (*GenerationRequest, error) {
	for _, forbidden := range []string{"model", "key", "apiKey", "systemPrompt", "system"} {
		if _, exists := input[forbidden]; exists {
			return nil, invalid()
		}
	}
	if path == "chat/completions" {
		return m.buildChat(input, choice, price, memories)
	}
	var kind string
	switch path {
	case "generate/image":
		kind = "image"
	case "generate/music":
		kind = "music"
	case "generate/video":
		kind = "video"
	default:
		return nil, invalid()
	}
	return m.buildMedia(kind, input, choice, price)
}

func (m *Manager) buildChat(input map[string]any, choice *models.Choice, price *pricing.Manager, memories []string) (*GenerationRequest, error) {
	action := "chat"
	if value, ok := input["action"].(string); ok && value != "" {
		action = value
	}
	var selected *models.Choice
	if choice != nil && choice.Kind == models.KindChat && action == "chat" {
		selected = choice
	}
	var messages []any
	system := ""
	switch action {
	case "chat":
		raw, ok := input["messages"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 500 {
			return nil, invalid()
		}
		for _, item := range raw {
			source, err := object(item)
			if err != nil {
				return nil, err
			}
			role, err := pick(source["role"], []string{"user", "assistant"}, "user")
			if err != nil {
				return nil, err
			}
			content, err := text(source["content"], 100000)
			if err != nil {
				return nil, err
			}
			messages = append(messages, map[string]any{"role": role, "content": content})
		}
		system = m.Settings.Get("AI_SYSTEM_PROMPT")
		if system == "" {
			system = DefaultSystemPrompt
		}
		system += MemoryBlock(memories)
	case "compose-song":
		system = SongSystemPrompt
		inspiration, err := text(input["inspiration"], 10000)
		if err != nil {
			return nil, err
		}
		style := ""
		if input["style"] != nil {
			if style, err = text(input["style"], 2000); err != nil {
				return nil, err
			}
		}
		if style == "" {
			style = "根据灵感选择"
		}
		vocal := "遵循灵感中的人声偏好。"
		if optionalBool(input, "instrumental") {
			vocal = "必须为纯音乐，不要歌词。"
		}
		messages = []any{map[string]any{"role": "user", "content": inspiration + "\n风格偏好：" + style + "\n" + vocal}}
	case "align-lyrics":
		raw, ok := input["lines"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 1000 {
			return nil, invalid()
		}
		var lines []string
		for _, item := range raw {
			line, err := text(item, 6000)
			if err != nil {
				return nil, err
			}
			lines = append(lines, line)
		}
		audio, err := text(input["audio"], 48*1024*1024)
		if err != nil || !regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`).MatchString(audio) {
			return nil, invalid()
		}
		duration, err := number(input["duration"], 0, 0.01, 3600)
		if err != nil {
			return nil, err
		}
		system = AlignmentSystemPrompt
		var list strings.Builder
		for index, line := range lines {
			if index > 0 {
				list.WriteString("\n")
			}
			list.WriteString(itoa(index) + ": " + line)
		}
		messages = []any{map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "text", "text": "音频实际时长：" + fixed(duration, 3) + " 秒。逐句校准以下歌词：\n" + list.String()},
			map[string]any{"type": "input_audio", "input_audio": map[string]any{"data": audio, "format": "wav"}},
		}}}
	case "workflow-script", "workflow-shots":
		elements, err := workflowInput(input)
		if err != nil {
			return nil, err
		}
		if m.Settings.Get("AI_SHORT_FILM") != "true" {
			return nil, &InputError{Message: "此创作功能尚未开放。"}
		}
		duration, err := number(input["targetLength"], 30, 5, 180)
		if err != nil {
			return nil, err
		}
		if action == "workflow-script" {
			system = "你是一位专业的短视频编剧。输出格式严格为 JSON，不要添加任何其他说明文字。"
			idea, err := text(input["idea"], 10000)
			if err != nil {
				return nil, err
			}
			messages = []any{map[string]any{"role": "user", "content": BuildScriptPrompt(idea, duration, elements)}}
		} else {
			system = "你是一位专业的短片导演。输出格式严格为 JSON 数组，不要添加任何其他说明文字。"
			script, err := text(input["script"], 50000)
			if err != nil {
				return nil, err
			}
			style, err := styleBible(input["styleBible"])
			if err != nil {
				return nil, err
			}
			messages = []any{map[string]any{"role": "user", "content": BuildShotListPrompt(script, style, duration, elements)}}
		}
	default:
		return nil, invalid()
	}
	model := m.ServerModel("chat")
	chatHundredths := price.ChatCost() * 100
	if selected != nil {
		model = selected.UpstreamID
		chatHundredths = models.ChatHundredths(*selected, price)
	}
	temperature := 0.7
	if action == "align-lyrics" {
		temperature = 0
	} else {
		value, err := number(input["temperature"], 0.7, 0, 2)
		if err != nil {
			return nil, err
		}
		temperature = value
	}
	all := []any{map[string]any{"role": "system", "content": system}}
	all = append(all, messages...)
	return &GenerationRequest{
		Path: "chat/completions", Kind: "", ChatPointsHundredths: chatHundredths,
		Payload: map[string]any{
			"model": model, "stream": action == "chat" && optionalBool(input, "stream"),
			"temperature": temperature, "messages": all,
		},
	}, nil
}

func (m *Manager) buildMedia(kind string, input map[string]any, choice *models.Choice, price *pricing.Manager) (*GenerationRequest, error) {
	prompt, err := text(input["prompt"], 100000)
	if err != nil {
		if input["prompt"] == nil {
			prompt = ""
		} else {
			return nil, err
		}
	}
	action := ""
	if value, ok := input["action"].(string); ok {
		action = value
	}
	if strings.HasPrefix(action, "workflow-") {
		elements, err := workflowInput(input)
		if err != nil {
			return nil, err
		}
		style, err := styleBible(input["styleBible"])
		if err != nil {
			return nil, err
		}
		if m.Settings.Get("AI_SHORT_FILM") != "true" {
			return nil, &InputError{Message: "此创作功能尚未开放。"}
		}
		switch {
		case action == "workflow-keyframe" && kind == "image":
			shot, err := shotInput(input["shot"])
			if err != nil {
				return nil, err
			}
			prompt = BuildKeyframePrompt(shot, style, elements)
		case action == "workflow-video" && kind == "video":
			shot, err := shotInput(input["shot"])
			if err != nil {
				return nil, err
			}
			prompt = BuildVideoPrompt(shot, style, optionalBool(input, "hasKeyframe"), elements)
		case action == "workflow-music" && kind == "music":
			script, err := text(input["script"], 50000)
			if err != nil {
				return nil, err
			}
			duration, err := number(input["duration"], 30, 1, 600)
			if err != nil {
				return nil, err
			}
			prompt = BuildMusicPrompt(script, style, duration)
		default:
			return nil, invalid()
		}
	} else if action == "cover" && kind == "image" {
		var song *Song
		if input["song"] != nil {
			encoded, err := json.Marshal(input["song"])
			if err == nil {
				song, _ = ParseSong(string(encoded))
			}
		}
		title := prompt
		musicStyle := "根据主题设计"
		lyrics := ""
		if song != nil {
			title = song.Title
			musicStyle = song.Style
			var parts []string
			for _, section := range song.Sections {
				parts = append(parts, section.Lyrics)
			}
			lyrics = strings.Join(parts, "\n")
		}
		inspiration := prompt
		if raw, ok := input["inspiration"].(string); ok {
			inspiration = raw
		}
		if raw, ok := input["lyrics"].(string); ok && lyrics == "" {
			lyrics = raw
		}
		if len(title) > 100 {
			title = truncateRunes(title, 100)
		}
		prompt = "为原创歌曲设计一张精美的方形专辑封面，以视觉画面表达歌曲主题与情绪，构图完整，适合音乐作品展示。只生成一张封面图片。\n歌曲：" + title +
			"\n音乐风格：" + musicStyle + "\n主题灵感：" + truncateRunes(inspiration, 3000) + "\n歌词意象：" + truncateRunes(lyrics, 3000) + "\n无需文字，不要水印。"
	} else if action != "" {
		return nil, invalid()
	}
	if strings.TrimSpace(prompt) == "" && input["song"] == nil {
		return nil, invalid()
	}
	switch kind {
	case "image":
		return m.buildImage(input, prompt, action, choice, price)
	case "music":
		return m.buildMusic(input, prompt, choice, price)
	default:
		return m.buildVideo(input, prompt, choice, price)
	}
}

func (m *Manager) buildImage(input map[string]any, prompt, action string, choice *models.Choice, price *pricing.Manager) (*GenerationRequest, error) {
	ratio := "auto"
	var err error
	if action == "cover" {
		ratio = "1:1"
	} else {
		raw := "auto"
		if input["aspectRatio"] != nil {
			if raw, err = text(input["aspectRatio"], 40); err != nil {
				return nil, err
			}
		}
		if ratio, err = normalizeRatio(raw); err != nil {
			return nil, err
		}
	}
	var selected *models.Choice
	if choice != nil && choice.Kind == models.KindImage {
		selected = choice
	}
	tiers := models.TiersForKind(models.KindImage)
	if selected != nil && len(selected.Tiers) > 0 {
		tiers = selected.Tiers
	}
	if selected != nil {
		if value, ok := input["imageSize"].(string); ok && !selected.SupportsTier(value) {
			return nil, &InputError{Message: "所选模型不支持该分辨率，请重新选择。"}
		}
	}
	quality, err := pick(input["imageSize"], tiers, preferredTier(tiers, "1K"))
	if err != nil {
		return nil, err
	}
	effort, err := pick(input["reasoningEffort"], []string{"minimal", "medium", "high"}, "medium")
	if err != nil {
		return nil, err
	}
	var referenceImages []string
	if input["referenceImages"] != nil {
		raw, ok := input["referenceImages"].([]any)
		if !ok || len(raw) > 4 {
			return nil, invalid()
		}
		for _, item := range raw {
			url, err := text(item, 12*1024*1024)
			if err != nil || !referencePattern.MatchString(url) {
				return nil, invalid()
			}
			referenceImages = append(referenceImages, url)
		}
	}
	model := m.ServerModel("image")
	if selected != nil {
		model = selected.UpstreamID
	}
	referenceNote := ""
	if len(referenceImages) > 0 {
		referenceNote = "\n请将所附参考图作为画面主体、构图或风格的参考。"
	}
	ratioNote := "自动，根据描述构图"
	if ratio != "auto" {
		ratioNote = ratio
	}
	nativeText := prompt + referenceNote + "\n画面比例：" + ratioNote + "。联想等级：" + effort + "。只生成图片，不输出文字说明。"
	var nativeContent any = nativeText
	if len(referenceImages) > 0 {
		parts := []any{map[string]any{"type": "text", "text": nativeText}}
		for _, url := range referenceImages {
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}})
		}
		nativeContent = parts
	}
	maxTokens := 2048
	if quality == "4K" {
		maxTokens = 8192
	} else if quality == "2K" {
		maxTokens = 4096
	}
	native := map[string]any{
		"model":    model,
		"messages": []any{map[string]any{"role": "user", "content": nativeContent}},
		"stream":   false, "image_size": quality, "max_tokens": maxTokens,
	}
	size := imageDimensions(ratio, quality)
	upstreamPayload := map[string]any{
		"model": model, "prompt": prompt + referenceNote + "\n画面比例：" + ratio + "。画质：" + quality + "。联想等级：" + effort + "。",
		"n": 1, "response_format": "b64_json",
	}
	if size != "" {
		upstreamPayload["size"] = size
	}
	if len(referenceImages) > 0 {
		upstreamPayload["image"] = referenceImages
	}
	points := price.ImageCost(quality)
	if selected != nil {
		points = models.Points(*selected, models.PointOptions{Quality: quality}, price)
	}
	mode := m.Settings.Get("AI_IMAGE_API_MODE")
	if mode == "" {
		mode = "auto"
	}
	if mode == "interactions" {
		var interactionInput any = nativeText
		if len(referenceImages) > 0 {
			parts := []any{map[string]any{"type": "text", "text": nativeText}}
			for _, url := range referenceImages {
				match := interactionImagePattern.FindStringSubmatch(url)
				if match == nil {
					return nil, invalid()
				}
				parts = append(parts, map[string]any{"type": "image", "mime_type": match[1], "data": match[2]})
			}
			interactionInput = parts
		}
		responseFormat := map[string]any{"type": "image", "image_size": quality, "delivery": "inline"}
		if interactionRatios[ratio] {
			responseFormat["aspect_ratio"] = ratio
		}
		return &GenerationRequest{Kind: "image", Points: points, Path: "interactions", Payload: map[string]any{
			"model": model, "input": interactionInput, "response_format": responseFormat, "stream": false, "store": false,
		}}, nil
	}
	upstream := &GenerationFallback{Path: "images/generations", Payload: upstreamPayload}
	nativeRequest := &GenerationFallback{Path: "chat/completions", Payload: native}
	lowerModel := strings.ToLower(model)
	upstreamModel := regexp.MustCompile(`^(dall-e|flux|sd|stable-diffusion)`).MatchString(lowerModel)
	if mode == "upstream" || (mode == "auto" && upstreamModel) {
		req := &GenerationRequest{Kind: "image", Points: points, Path: upstream.Path, Payload: upstream.Payload}
		if mode == "auto" {
			req.Fallback = nativeRequest
		}
		return req, nil
	}
	req := &GenerationRequest{Kind: "image", Points: points, Path: nativeRequest.Path, Payload: nativeRequest.Payload}
	if mode == "auto" {
		req.Fallback = upstream
	}
	return req, nil
}

func (m *Manager) buildMusic(input map[string]any, prompt string, choice *models.Choice, price *pricing.Manager) (*GenerationRequest, error) {
	if input["song"] != nil {
		encoded, err := json.Marshal(input["song"])
		if err != nil {
			return nil, invalid()
		}
		song, err := ParseSong(string(encoded))
		if err != nil {
			return nil, &InputError{Message: err.Error()}
		}
		prompt = SongPrompt(song)
	}
	seconds, err := number(input["duration"], 120, 1, 600)
	if err != nil {
		return nil, err
	}
	duration := ""
	if input["duration"] != nil {
		duration = "\nTarget duration: " + itoa(int(seconds)) + " seconds."
	}
	var selected *models.Choice
	if choice != nil && choice.Kind == models.KindMusic {
		selected = choice
	}
	model := m.ServerModel("music")
	if selected != nil {
		model = selected.UpstreamID
	}
	points := price.MusicCost(seconds)
	if selected != nil {
		points = models.Points(*selected, models.PointOptions{Seconds: seconds}, price)
	}
	if m.Settings.Get("AI_AUDIO_API_MODE") == "upstream" {
		voice := "alloy"
		if input["voice"] != nil {
			if voice, err = text(input["voice"], 100); err != nil {
				return nil, err
			}
		}
		speed, err := number(input["speed"], 1, 0.25, 4)
		if err != nil {
			return nil, err
		}
		format, err := pick(input["responseFormat"], []string{"mp3", "wav", "opus", "aac", "flac", "pcm"}, "mp3")
		if err != nil {
			return nil, err
		}
		return &GenerationRequest{Kind: "music", Points: points, Path: "audio/speech", Payload: map[string]any{
			"model": model, "input": prompt, "voice": voice, "speed": speed, "response_format": format,
		}}, nil
	}
	return &GenerationRequest{Kind: "music", Points: points, Path: "chat/completions", Payload: map[string]any{
		"model": model, "messages": []any{map[string]any{"role": "user", "content": prompt + duration + "\nReturn the generated audio."}}, "stream": false,
	}}, nil
}

func (m *Manager) buildVideo(input map[string]any, prompt string, choice *models.Choice, price *pricing.Manager) (*GenerationRequest, error) {
	options := map[string]any{}
	if input["options"] != nil {
		var err error
		if options, err = object(input["options"]); err != nil {
			return nil, err
		}
	}
	var selected *models.Choice
	if choice != nil && choice.Kind == models.KindVideo {
		selected = choice
	}
	resolutionRaw := ""
	if value, ok := options["resolution"].(string); ok {
		resolutionRaw = strings.ToLower(value)
	}
	if selected != nil && resolutionRaw != "" && !selected.SupportsTier(resolutionRaw) {
		return nil, &InputError{Message: "所选模型不支持该画质，请重新选择。"}
	}
	tiers := models.TiersForKind(models.KindVideo)
	if selected != nil && len(selected.Tiers) > 0 {
		tiers = selected.Tiers
	}
	resolution, err := pick(nilIfEmpty(resolutionRaw), tiers, preferredTier(tiers, "720p"))
	if err != nil {
		return nil, err
	}
	ratio, err := pick(options["aspect_ratio"], []string{"16:9", "9:16"}, "16:9")
	if err != nil {
		return nil, err
	}
	effort, err := pick(options["reasoning_effort"], []string{"minimal", "medium", "high"}, "medium")
	if err != nil {
		return nil, err
	}
	model := m.ServerModel("video")
	if selected != nil {
		model = selected.UpstreamID
	}
	pointsFor := func(seconds float64) int {
		if selected != nil {
			return models.Points(*selected, models.PointOptions{Resolution: resolution, Seconds: seconds}, price)
		}
		return price.VideoCost(resolution, seconds)
	}
	if m.VideoMode(model) == "chat" {
		seconds, err := number(options["seconds"], 4, 3, 10)
		if err != nil {
			return nil, err
		}
		if seconds != math.Trunc(seconds) || input["extendFrom"] != nil || input["inputReference"] != nil {
			return nil, invalid()
		}
		return &GenerationRequest{Kind: "video", Points: pointsFor(seconds), Path: "chat/completions", Payload: map[string]any{
			"model": model,
			"messages": []any{map[string]any{"role": "user", "content": "请根据以下描述生成视频，返回生成的视频文件或视频链接。\n" + prompt +
				"\n目标时长：" + itoa(int(seconds)) + " 秒。\n画面比例：" + ratio + "。\n目标画质：" + strings.ToUpper(resolution) + "。\n创意丰富程度：" + effort + "。"}},
			"stream": false, "resolution": resolution,
		}}, nil
	}
	sizes := map[string][2]int{"360p": {640, 360}, "720p": {1280, 720}, "1080p": {1920, 1080}, "4k": {3840, 2160}}
	size := sizes[resolution]
	width, height := size[0], size[1]
	if ratio == "9:16" {
		width, height = height, width
	}
	prefix := ""
	if input["extendFrom"] != nil {
		prefix = "Extend this video. "
	}
	payload := map[string]any{
		"model": model, "prompt": prefix + prompt + "\n创意丰富程度：" + effort + "。",
		"size": itoa(width) + "x" + itoa(height),
	}
	lowerModel := strings.ToLower(model)
	if strings.HasPrefix(lowerModel, "veo-") || strings.HasPrefix(lowerModel, "veo.") {
		seconds := 4.0
		if resolution == "4k" {
			seconds = 8
		} else if value, err := number(options["seconds"], 4, 4, 8); err == nil {
			seconds = value
		} else {
			return nil, err
		}
		if seconds != math.Trunc(seconds) {
			return nil, invalid()
		}
		payload["seconds"] = int(seconds)
	}
	if input["inputReference"] != nil {
		image, err := text(input["inputReference"], 20*1024*1024)
		if err != nil || !regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`).MatchString(image) {
			return nil, invalid()
		}
		payload["input_reference"] = image
	}
	secondsSource := options["seconds"]
	if payload["seconds"] != nil {
		secondsSource = payload["seconds"]
	}
	if value, ok := secondsSource.(int); ok {
		secondsSource = float64(value)
	}
	seconds, err := number(secondsSource, 4, 1, 60)
	if err != nil {
		return nil, err
	}
	return &GenerationRequest{Kind: "video", Points: pointsFor(seconds), Path: "videos", Payload: payload}, nil
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func fixed(value float64, digits int) string {
	return strconv.FormatFloat(value, 'f', digits, 64)
}
