package ai

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const ServiceError = "创作服务暂时无法完成请求，请稍后重试。"

type MediaOutput struct {
	URL    string `json:"url,omitempty"`
	Base64 string `json:"base64,omitempty"`
	Mime   string `json:"mime"`
}

func mapValue(value any, key string) any {
	if m, ok := value.(map[string]any); ok {
		return m[key]
	}
	return nil
}

func stringValue(value any) string {
	s, _ := value.(string)
	return s
}

func arrayValue(value any) []any {
	list, _ := value.([]any)
	return list
}

var (
	markdownImageRE = regexp.MustCompile(`!\[([^\]]*)\]\(([^)]+)\)`)
	dataImageRE     = regexp.MustCompile(`data:(image/[a-zA-Z0-9.+_-]+);base64,([A-Za-z0-9+/=]+)`)
	plainImageRE    = regexp.MustCompile(`(?i)https?://[^\s<>"')]+?\.(?:png|jpe?g|webp|gif|svg)(?:\?[^\s<>"')]*)?`)
	dataAudioRE     = regexp.MustCompile(`data:(audio/[a-zA-Z0-9.+;=_-]+);base64,([A-Za-z0-9+/=]+)`)
	audioLinkRE     = regexp.MustCompile(`(?i)^https?://[^\s<>"')]+?\.(?:mp3|wav|ogg|aac|m4a|flac)(?:\?[^\s<>"')]*)?`)
	plainAudioRE    = regexp.MustCompile(`(?i)https?://[^\s<>"')]+?\.(?:mp3|wav|ogg|aac|m4a|flac)(?:\?[^\s<>"')]*)?`)
	videoContentRE  = regexp.MustCompile(`(?i)!\[[^\]]*\]\(([^)]+)\)|(?:https?://[^\s<>"')]+\.(?:mp4|webm|mov)(?:\?[^\s<>"')]*)?)|(?:data:video/[\w.+-]+;base64,[A-Za-z0-9+/=]+)`)
	videoDataRE     = regexp.MustCompile(`(?i)^data:(video/[\w.+-]+);base64,(.+)$`)
	httpPrefixRE    = regexp.MustCompile(`(?i)^https?://`)
	audioMarkdownRE = regexp.MustCompile(`(?i)^https?://`)
)

func ExtractImagesFromContent(content string) []MediaOutput {
	var results []MediaOutput
	matched := map[string]bool{}
	for _, match := range markdownImageRE.FindAllStringSubmatch(content, -1) {
		link := strings.TrimSpace(match[2])
		matched[link] = true
		if strings.HasPrefix(link, "data:") {
			comma := strings.Index(link, ",")
			if comma < 0 {
				continue
			}
			meta := link[5:comma]
			base64 := strings.Join(strings.Fields(link[comma+1:]), "")
			mime := "image/png"
			if m := regexp.MustCompile(`^(image/[a-zA-Z0-9.+_-]+)`).FindStringSubmatch(meta); m != nil {
				mime = m[1]
			}
			results = append(results, MediaOutput{Base64: base64, Mime: mime})
		} else if httpPrefixRE.MatchString(link) {
			results = append(results, MediaOutput{URL: link, Mime: "image/png"})
		}
	}
	if len(results) == 0 {
		for _, match := range dataImageRE.FindAllStringSubmatch(content, -1) {
			results = append(results, MediaOutput{Base64: strings.Join(strings.Fields(match[2]), ""), Mime: match[1]})
		}
	}
	if len(results) == 0 {
		for _, match := range plainImageRE.FindAllString(content, -1) {
			if !matched[match] {
				results = append(results, MediaOutput{URL: match, Mime: "image/png"})
			}
		}
	}
	return results
}

func ExtractAudiosFromContent(content string) []MediaOutput {
	var results []MediaOutput
	matched := map[string]bool{}
	for _, match := range markdownImageRE.FindAllStringSubmatch(content, -1) {
		link := strings.TrimSpace(match[2])
		matched[link] = true
		if strings.HasPrefix(link, "data:audio/") {
			comma := strings.Index(link, ",")
			if comma < 0 {
				continue
			}
			base64 := strings.Join(strings.Fields(link[comma+1:]), "")
			mime := strings.TrimSuffix(link[5:comma], ";base64")
			results = append(results, MediaOutput{Base64: base64, Mime: mime})
		} else if audioLinkRE.MatchString(link) {
			results = append(results, MediaOutput{URL: link, Mime: "audio/mpeg"})
		}
	}
	if len(results) == 0 {
		for _, match := range dataAudioRE.FindAllStringSubmatch(content, -1) {
			results = append(results, MediaOutput{Base64: strings.Join(strings.Fields(match[2]), ""), Mime: match[1]})
		}
	}
	if len(results) == 0 {
		for _, match := range plainAudioRE.FindAllString(content, -1) {
			if !matched[match] {
				results = append(results, MediaOutput{URL: match, Mime: "audio/mpeg"})
			}
		}
	}
	return results
}

func ExtractVideosFromContent(content string) []MediaOutput {
	var results []MediaOutput
	for _, match := range videoContentRE.FindAllStringSubmatch(content, -1) {
		link := match[1]
		if link == "" {
			link = match[0]
		}
		if !httpPrefixRE.MatchString(link) && !strings.HasPrefix(link, "data:video/") {
			continue
		}
		if data := videoDataRE.FindStringSubmatch(link); data != nil {
			results = append(results, MediaOutput{Base64: data[2], Mime: data[1]})
			continue
		}
		mime := "video/mp4"
		if regexp.MustCompile(`(?i)\.webm(?:\?|$)`).MatchString(link) {
			mime = "video/webm"
		}
		results = append(results, MediaOutput{URL: link, Mime: mime})
	}
	return results
}

func MediaOutputs(value any, kind string) []MediaOutput {
	if value == nil {
		return nil
	}
	if (kind == "image" || kind == "video") && arrayValue(mapValue(value, "steps")) != nil {
		var out []MediaOutput
		for _, rawStep := range arrayValue(mapValue(value, "steps")) {
			if stringValue(mapValue(rawStep, "type")) != "model_output" {
				continue
			}
			for _, part := range arrayValue(mapValue(rawStep, "content")) {
				if stringValue(mapValue(part, "type")) != kind {
					continue
				}
				data := stringValue(mapValue(part, "data"))
				uri := stringValue(mapValue(part, "uri"))
				if data == "" && uri == "" {
					continue
				}
				mime := stringValue(mapValue(part, "mime_type"))
				if mime == "" {
					if kind == "video" {
						mime = "video/mp4"
					} else {
						mime = "image/jpeg"
					}
				}
				out = append(out, MediaOutput{Base64: data, URL: uri, Mime: mime})
			}
		}
		return out
	}
	if choices := arrayValue(mapValue(value, "choices")); choices != nil {
		var out []MediaOutput
		for _, rawChoice := range choices {
			message := mapValue(rawChoice, "message")
			if message == nil {
				message = mapValue(rawChoice, "delta")
			}
			if kind == "image" {
				for _, image := range arrayValue(mapValue(message, "images")) {
					link := stringValue(mapValue(mapValue(image, "image_url"), "url"))
					if link == "" {
						link = stringValue(mapValue(image, "url"))
					}
					if link != "" {
						mime := stringValue(mapValue(image, "mime_type"))
						if mime == "" {
							mime = "image/png"
						}
						out = append(out, MediaOutput{URL: link, Mime: mime})
					}
				}
			}
			if kind == "music" {
				audio := mapValue(message, "audio")
				if data := stringValue(mapValue(audio, "data")); data != "" {
					format := stringValue(mapValue(audio, "format"))
					if format == "" {
						format = "wav"
					}
					mime := stringValue(mapValue(audio, "mime_type"))
					if mime == "" {
						if format == "mp3" {
							mime = "audio/mpeg"
						} else {
							mime = "audio/" + format
						}
					}
					out = append(out, MediaOutput{Base64: data, Mime: mime})
				}
			}
			if kind == "video" {
				for _, video := range arrayValue(mapValue(message, "videos")) {
					link := stringValue(mapValue(mapValue(video, "video_url"), "url"))
					if link == "" {
						link = stringValue(mapValue(video, "url"))
					}
					if link != "" {
						mime := stringValue(mapValue(video, "mime_type"))
						if mime == "" {
							mime = "video/mp4"
						}
						out = append(out, MediaOutput{URL: link, Mime: mime})
					}
				}
			}
			content := mapValue(message, "content")
			if content == nil {
				content = mapValue(rawChoice, "delta")
				content = mapValue(content, "content")
			}
			if text, ok := content.(string); ok {
				switch kind {
				case "image":
					out = append(out, ExtractImagesFromContent(text)...)
				case "video":
					out = append(out, ExtractVideosFromContent(text)...)
				default:
					out = append(out, ExtractAudiosFromContent(text)...)
				}
			} else if parts := arrayValue(content); parts != nil {
				for _, part := range parts {
					if partText := stringValue(mapValue(part, "text")); partText != "" {
						switch kind {
						case "image":
							out = append(out, ExtractImagesFromContent(partText)...)
						case "video":
							out = append(out, ExtractVideosFromContent(partText)...)
						default:
							out = append(out, ExtractAudiosFromContent(partText)...)
						}
					} else if kind == "image" {
						if link := stringValue(mapValue(mapValue(part, "image_url"), "url")); link != "" {
							out = append(out, MediaOutput{URL: link, Mime: "image/png"})
						}
					} else if kind == "video" {
						if link := stringValue(mapValue(mapValue(part, "video_url"), "url")); link != "" {
							out = append(out, MediaOutput{URL: link, Mime: "video/mp4"})
						}
					}
				}
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	rows := arrayValue(mapValue(value, "data"))
	if rows == nil {
		rows = arrayValue(mapValue(value, "output"))
	}
	if rows == nil {
		output := mapValue(value, "output")
		if output == nil {
			output = value
		}
		rows = []any{output}
	}
	var out []MediaOutput
	for _, row := range rows {
		var item MediaOutput
		if text, ok := row.(string); ok {
			item.URL = text
		} else {
			item.URL = firstString(mapValue(row, "url"), mapValue(row, "video_url"), mapValue(row, "audio_url"), mapValue(row, "image_url"), mapValue(mapValue(row, "audio"), "url"))
			item.Base64 = firstString(mapValue(row, "b64_json"), mapValue(row, "video_base64"), mapValue(row, "audio_base64"), mapValue(mapValue(row, "audio"), "data"))
			item.Mime = stringValue(mapValue(row, "mime_type"))
		}
		if item.Mime == "" {
			switch kind {
			case "image":
				item.Mime = "image/png"
			case "video":
				item.Mime = "video/mp4"
			default:
				item.Mime = "audio/mpeg"
			}
		}
		if item.URL != "" || item.Base64 != "" {
			out = append(out, item)
		}
	}
	return out
}

func firstString(values ...any) string {
	for _, value := range values {
		if s, ok := value.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// ---- redaction ----

var secretEnvRE = regexp.MustCompile(`(?i)(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD)(?:$|_)`)
var promptSplitRE = regexp.MustCompile(`[\n。]`)

func (m *Manager) PrivateValues(extra []string) []string {
	prompts := []string{DefaultSystemPrompt, SongSystemPrompt, AlignmentSystemPrompt, SuggestionSystemPrompt, m.Settings.Get("AI_SYSTEM_PROMPT")}
	prompts = append(prompts, extra...)
	values := []string{}
	for _, model := range ServerModels {
		values = append(values, model)
	}
	for _, kind := range []string{"chat", "image", "video", "music"} {
		values = append(values, m.ServerModel(kind))
	}
	for _, entry := range os.Environ() {
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) == 2 && secretEnvRE.MatchString(parts[0]) {
			values = append(values, parts[1])
		}
	}
	for _, key := range []string{"AI_API_KEY", "MAIL_PASS", "OSS_ACCESS_KEY_SECRET", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET", "GOOGLE_PROXY"} {
		values = append(values, m.Settings.Get(key))
	}
	values = append(values, prompts...)
	for _, prompt := range prompts {
		for _, part := range promptSplitRE.Split(prompt, -1) {
			if len([]rune(part)) >= 15 {
				values = append(values, part)
			}
		}
	}
	seen := map[string]bool{}
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if len([]rune(value)) < 4 || seen[value] {
			continue
		}
		seen[value] = true
		unique = append(unique, value)
	}
	sort.SliceStable(unique, func(i, j int) bool { return len(unique[i]) > len(unique[j]) })
	return unique
}

func redactLiterals(text string, secrets []string) string {
	output := text
	for _, value := range secrets {
		if value == "" {
			continue
		}
		re, err := regexp.Compile(`(?i)` + regexp.QuoteMeta(value))
		if err != nil {
			continue
		}
		output = re.ReplaceAllString(output, "[已隐藏]")
	}
	return output
}

var (
	modelNameRE = regexp.MustCompile(`(?i)\b(?:gemini|gemma|lyria|veo|claude|gpt|nano[-\s]?banana)[\w.\s-]*\b`)
	skKeyRE     = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{8,}\b`)
)

func RedactText(text string, secrets []string) string {
	output := redactLiterals(text, secrets)
	output = modelNameRE.ReplaceAllString(output, "[已隐藏]")
	return skKeyRE.ReplaceAllString(output, "[已隐藏]")
}

// RedactSecrets removes stored secret values and API keys but leaves public
// model names readable. The model catalog already publishes the same aliases,
// so a vendor-style name is not a secret; upstream IDs are still redacted when
// they appear in the configured secret values.
func RedactSecrets(text string, secrets []string) string {
	return skKeyRE.ReplaceAllString(redactLiterals(text, secrets), "[已隐藏]")
}

var (
	dataMediaRE   = regexp.MustCompile(`(?i)^data:(?:image|audio|video)/[\w.+-]+(?:;[\w=.-]+)*;base64,[A-Za-z0-9+/=\s]+$`)
	sensitiveKey  = regexp.MustCompile(`(?i)key|token|secret|authorization|prompt|model`)
	mediaMimeRE   = regexp.MustCompile(`^(?:image|audio|video)/[\w.+-]+(?:;[\w=.-]+)*$`)
	base64OnlyRE  = regexp.MustCompile(`^[A-Za-z0-9+/=\s]+$`)
	imageMimeRE   = regexp.MustCompile(`^image/`)
	audioMimeRE   = regexp.MustCompile(`^audio/`)
	videoMimeRE   = regexp.MustCompile(`^video/`)
	validTaskMime = regexp.MustCompile(`^(?:image|audio|video)/`)
)

func safeMedia(value string, secrets []string) string {
	if dataMediaRE.MatchString(value) {
		return value
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return ""
	}
	for key := range parsed.Query() {
		if sensitiveKey.MatchString(key) {
			return ""
		}
	}
	decoded, err := url.PathUnescape(value)
	if err != nil {
		decoded = value
	}
	if RedactText(decoded, secrets) != decoded {
		return ""
	}
	return value
}

// PublicJSON strips provider metadata, model IDs, prompts and secrets from a
// successful JSON response.
func PublicJSON(value any, kind string, secrets []string, taskID string) (map[string]any, error) {
	if taskID != "" {
		status := stringValue(mapValue(value, "status"))
		switch status {
		case "queued", "pending", "in_progress", "processing", "completed", "failed":
		default:
			status = "pending"
		}
		result := map[string]any{"id": taskID, "status": status}
		if status == "failed" {
			result["error"] = map[string]any{"message": ServiceError}
		}
		return result, nil
	}
	if kind != "" {
		outputs := MediaOutputs(value, kind)
		data := []any{}
		for _, output := range outputs {
			mime := output.Mime
			if !mediaMimeRE.MatchString(mime) || RedactText(mime, secrets) != mime {
				switch kind {
				case "image":
					mime = "image/png"
				case "video":
					mime = "video/mp4"
				default:
					mime = "audio/mpeg"
				}
			}
			if output.Base64 != "" && base64OnlyRE.MatchString(output.Base64) {
				data = append(data, map[string]any{"b64_json": output.Base64, "mime_type": mime})
				continue
			}
			if link := safeMedia(output.URL, secrets); link != "" {
				data = append(data, map[string]any{"url": link, "mime_type": mime})
			}
		}
		if len(data) == 0 {
			return nil, errors.New("invalid media response")
		}
		return map[string]any{"data": data}, nil
	}
	choices := arrayValue(mapValue(value, "choices"))
	if len(choices) == 0 {
		return nil, errors.New("invalid response")
	}
	content := stringValue(mapValue(mapValue(choices[0], "message"), "content"))
	if strings.TrimSpace(content) == "" {
		return nil, errors.New("invalid response")
	}
	return map[string]any{"choices": []any{map[string]any{
		"message": map[string]any{"role": "assistant", "content": RedactText(content, secrets)},
	}}}, nil
}

// ---- SSE ----

type sseSanitizer struct {
	reader  io.Reader
	secrets []string
	pipeR   *io.PipeReader
	pipeW   *io.PipeWriter
	once    sync.Once
}

// PublicSSE parses upstream SSE events and re-emits only public assistant text.
// The returned reader closes when the upstream ends, the client cancels, or an
// upstream error is replaced with a generic message.
func PublicSSE(body io.ReadCloser, secrets []string) io.ReadCloser {
	r, w := io.Pipe()
	s := &sseSanitizer{reader: body, secrets: secrets, pipeR: r, pipeW: w}
	go s.run()
	return &sseReadCloser{Reader: r, cancel: func() {
		s.once.Do(func() { _ = body.Close(); _ = r.Close() })
	}}
}

type sseReadCloser struct {
	io.Reader
	cancel func()
}

func (r *sseReadCloser) Close() error {
	r.cancel()
	return nil
}

const sseMaxEvent = 1024 * 1024

func (s *sseSanitizer) run() {
	defer s.pipeW.Close()
	buffered := bufio.NewReaderSize(s.reader, 64*1024)
	var event strings.Builder
	pending := ""
	emitted := 0
	finished := false

	emit := func(text string) error {
		if text == "" {
			return nil
		}
		payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": text}}}})
		_, err := s.pipeW.Write([]byte("data: " + string(payload) + "\n\n"))
		if err == nil {
			emitted++
		}
		return err
	}
	flush := func(final bool) error {
		if strings.Contains(pending, "[Error]") {
			return errors.New("upstream stream error")
		}
		pending = redactLiterals(pending, s.secrets)
		keep := 0
		if !final {
			protected := append([]string{}, s.secrets...)
			protected = append(protected, "[Error]", "sk-", "gemini", "gemma", "lyria", "veo", "claude", "gpt", "nano-banana", "nano banana", "nanobanana")
			lowerPending := strings.ToLower(pending)
			for _, value := range protected {
				lower := strings.ToLower(value)
				maxLength := len(lower) - 1
				if len(pending) < maxLength {
					maxLength = len(pending)
				}
				for length := maxLength; length > keep; length-- {
					if strings.HasSuffix(lowerPending, lower[:length]) {
						keep = length
						break
					}
				}
			}
			if match := regexp.MustCompile(`(?i)\b(?:gemini|gemma|lyria|veo|claude|gpt|nano[-\s]?banana|sk-)[\w.-]*$`).FindString(pending); match != "" && len(match) > keep {
				keep = len(match)
			}
		}
		cut := len(pending) - keep
		if cut < 0 {
			cut = 0
		}
		if err := emit(RedactText(pending[:cut], s.secrets)); err != nil {
			return err
		}
		if keep > 0 {
			pending = pending[len(pending)-keep:]
		} else {
			pending = ""
		}
		return nil
	}
	finish := func() error {
		if err := flush(true); err != nil {
			return err
		}
		_, err := s.pipeW.Write([]byte("data: [DONE]\n\n"))
		finished = true
		return err
	}
	handleEvent := func(raw string) error {
		var dataLines []string
		for _, line := range strings.Split(raw, "\n") {
			if strings.HasPrefix(line, "data:") {
				dataLines = append(dataLines, strings.TrimLeft(line[5:], " \t"))
			}
		}
		data := strings.Join(dataLines, "\n")
		if strings.TrimSpace(data) == "" || finished {
			return nil
		}
		if strings.TrimSpace(data) == "[DONE]" {
			return finish()
		}
		var payload any
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			return err
		}
		if mapValue(payload, "error") != nil {
			return errors.New("upstream stream error")
		}
		choices := arrayValue(mapValue(payload, "choices"))
		if len(choices) == 0 {
			return nil
		}
		delta := mapValue(choices[0], "delta")
		if delta == nil {
			delta = mapValue(choices[0], "message")
		}
		content := mapValue(delta, "content")
		switch value := content.(type) {
		case string:
			pending += value
		case []any:
			for _, part := range value {
				if text := stringValue(mapValue(part, "text")); text != "" {
					pending += text
				}
			}
		}
		return flush(false)
	}
	fail := func() {
		if finished {
			return
		}
		finished = true
		payload, _ := json.Marshal(map[string]any{"error": map[string]any{"message": ServiceError}})
		_, _ = s.pipeW.Write([]byte("data: " + string(payload) + "\n\ndata: [DONE]\n\n"))
	}

	for !finished {
		before := emitted
		line, err := buffered.ReadString('\n')
		if len(line) > 0 {
			line = strings.ReplaceAll(line, "\r\n", "\n")
			if line == "\n" || line == "\r\n" {
				raw := event.String()
				event.Reset()
				if strings.TrimSpace(raw) != "" {
					if handleErr := handleEvent(raw); handleErr != nil {
						fail()
						return
					}
				}
			} else {
				if event.Len()+len(line) > sseMaxEvent {
					fail()
					return
				}
				event.WriteString(line)
			}
		}
		if err != nil {
			if err != io.EOF {
				fail()
				return
			}
			if tail := strings.TrimSpace(event.String()); tail != "" && !finished {
				if handleErr := handleEvent(tail); handleErr != nil {
					fail()
					return
				}
			}
			if !finished {
				if handleErr := finish(); handleErr != nil {
					return
				}
			}
			break
		}
		// Keep reading metadata/partial events until there is public output;
		// returning here is fine because we are in a goroutine and the pipe
		// buffers writes.
		_ = before
	}
	_ = validTaskMime
}
