package media

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"olai/internal/ai"
)

var dataURIRE = regexp.MustCompile(`(?i)^data:((?:image|audio|video)/[\w.+-]+(?:;[\w=.-]+)*);base64,([A-Za-z0-9+/=\s]+)$`)

func decodeDataURI(value string) ([]byte, string, bool) {
	match := dataURIRE.FindStringSubmatch(value)
	if match == nil {
		return nil, "", false
	}
	data, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(match[2]), ""))
	if err != nil {
		return nil, "", false
	}
	return data, match[1], true
}

func isRIFFWav(data []byte) bool {
	return len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WAVE"
}

func isMP3(data []byte) bool {
	if len(data) >= 3 && data[0] == 0x49 && data[1] == 0x44 && data[2] == 0x33 {
		return true
	}
	return len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0
}

var pcmRateRE = regexp.MustCompile(`(?i)rate[=:]\s*(\d+)`)

func wrapPCM(mime string, data []byte) ([]byte, string) {
	rate := 24000
	if match := pcmRateRE.FindStringSubmatch(mime); match != nil {
		if parsed, err := strconv.Atoi(match[1]); err == nil && parsed > 0 && parsed <= 384000 {
			rate = parsed
		}
	}
	channels := 1
	if strings.Contains(strings.ToLower(mime), "stereo") {
		channels = 2
	}
	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:8], uint32(36+len(data)))
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 1)
	binary.LittleEndian.PutUint16(header[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(header[24:28], uint32(rate))
	binary.LittleEndian.PutUint32(header[28:32], uint32(rate*channels*2))
	binary.LittleEndian.PutUint16(header[32:34], uint16(channels*2))
	binary.LittleEndian.PutUint16(header[34:36], 16)
	copy(header[36:40], "data")
	binary.LittleEndian.PutUint32(header[40:44], uint32(len(data)))
	return append(header, data...), "audio/wav"
}

// NormalizeAudio converts raw PCM into WAV and keeps real RIFF/MP3 containers,
// matching what the browser-side generated-media wrapper used to do.
func NormalizeAudio(data []byte, mime string) ([]byte, string) {
	return normalizeAudioBytes(data, mime)
}

// Downloaded exposes the bytes fetched by ImportRemoteMedia.
type Downloaded = downloadedMedia

func normalizeAudioBytes(data []byte, mime string) ([]byte, string) {
	lower := strings.ToLower(mime)
	if strings.Contains(lower, "pcm") {
		return wrapPCM(mime, data)
	}
	if isRIFFWav(data) {
		return data, "audio/wav"
	}
	if isMP3(data) {
		return data, "audio/mpeg"
	}
	switch {
	case strings.HasPrefix(lower, "image/"):
		return data, lower
	case strings.HasPrefix(lower, "video/"):
		return data, lower
	case lower == "" || strings.Contains(lower, "octet-stream"):
		return data, "audio/wav"
	default:
		return data, lower
	}
}

func randomUUID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return formatUUID(buf)
}

// PersistGeneratedJSON stores generated media in private OSS and returns only
// local media handles.
func (m *Manager) PersistGeneratedJSON(ctx context.Context, value any, kind string, identity Identity) (map[string]any, error) {
	outputs := ai.MediaOutputs(value, kind)
	if len(outputs) == 0 || len(outputs) > 8 {
		return nil, errors.New("invalid generated media")
	}
	group := randomUUID()
	data := []any{}
	expected := kind + "/"
	if kind == "music" {
		expected = "audio/"
	}
	for index, output := range outputs {
		var bytes []byte
		mime := output.Mime
		base64Data := output.Base64
		if base64Data == "" && strings.HasPrefix(output.URL, "data:") {
			decoded, decodedMime, ok := decodeDataURI(output.URL)
			if !ok {
				return nil, errors.New("invalid generated media")
			}
			bytes, mime = decoded, decodedMime
			base64Data = "decoded"
		}
		if base64Data != "" && base64Data != "decoded" {
			if !regexp.MustCompile(`^[A-Za-z0-9+/=\s]+$`).MatchString(base64Data) {
				return nil, errors.New("invalid generated media")
			}
			decoded, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(base64Data), ""))
			if err != nil {
				return nil, errors.New("invalid generated media")
			}
			bytes = decoded
		} else if base64Data == "" && output.URL != "" {
			remote, err := m.ImportRemoteMedia(ctx, output.URL)
			if err != nil {
				return nil, err
			}
			bytes, mime = remote.Bytes, remote.Mime
		}
		if len(bytes) == 0 {
			return nil, errors.New("invalid generated media")
		}
		if kind == "music" {
			bytes, mime = normalizeAudioBytes(bytes, mime)
		}
		if !strings.HasPrefix(strings.ToLower(mime), expected) {
			return nil, errors.New("invalid generated media type")
		}
		if err := m.ReserveBytes(ctx, identity, int64(len(bytes))); err != nil {
			return nil, err
		}
		stored, err := m.Store(ctx, bytes, mime, group+"-"+strconv.Itoa(index), identity)
		if err != nil {
			return nil, err
		}
		data = append(data, map[string]any{"url": "/api/media/" + stored.ID, "mime_type": stored.Mime})
	}
	return map[string]any{"data": data}, nil
}

// PersistServerRecordMedia converts legacy Base64 or remote media inside a
// record into private OSS references before it is committed.
func (m *Manager) PersistServerRecordMedia(ctx context.Context, value any, identity Identity) (any, error) {
	source, ok := value.(map[string]any)
	if !ok {
		return value, nil
	}
	row := make(map[string]any, len(source))
	for key, entry := range source {
		row[key] = entry
	}
	var slot func(target map[string]any, data, urlField, id string) error
	slot = func(target map[string]any, dataField, urlField, id string) error {
		rawData, _ := target[dataField].(string)
		rawURL, _ := target[urlField].(string)
		mediaSource := rawData
		if mediaSource == "" {
			mediaSource = rawURL
		}
		if mediaSource != "" {
			stored, err := m.storeSourceMedia(ctx, mediaSource, id, identity)
			if err != nil {
				return err
			}
			target[urlField] = stored
		}
		delete(target, dataField)
		return nil
	}
	recordID, _ := row["id"].(string)
	if err := slot(row, "blobData", "url", recordID+"-media"); err != nil {
		return nil, err
	}
	if cover, _ := row["coverUrl"].(string); cover != "" {
		stored, err := m.storeSourceMedia(ctx, cover, recordID+"-cover", identity)
		if err != nil {
			return nil, err
		}
		row["coverUrl"] = stored
	}
	if shots, ok := row["shots"].([]any); ok {
		nextShots := make([]any, 0, len(shots))
		for _, rawShot := range shots {
			original, ok := rawShot.(map[string]any)
			if !ok {
				nextShots = append(nextShots, rawShot)
				continue
			}
			shot := make(map[string]any, len(original))
			for key, entry := range original {
				shot[key] = entry
			}
			shotID, _ := shot["id"].(string)
			if err := slot(shot, "keyframeBlobData", "keyframeUrl", recordID+"-"+shotID+"-keyframe"); err != nil {
				return nil, err
			}
			if err := slot(shot, "videoBlobData", "videoUrl", recordID+"-"+shotID+"-video"); err != nil {
				return nil, err
			}
			nextShots = append(nextShots, shot)
		}
		row["shots"] = nextShots
	}
	if err := slot(row, "musicBlobData", "musicUrl", recordID+"-music"); err != nil {
		return nil, err
	}
	if err := slot(row, "finalVideoBlobData", "finalVideoUrl", recordID+"-final"); err != nil {
		return nil, err
	}
	for _, field := range []string{"lyrics", "lrc"} {
		text, _ := row[field].(string)
		if text == "" {
			continue
		}
		mime := "text/plain"
		if field == "lrc" {
			mime = "text/lrc"
		}
		if err := m.ReserveBytes(ctx, identity, int64(len(text))); err != nil {
			return nil, err
		}
		stored, err := m.Store(ctx, []byte(text), mime, recordID+"-"+field, identity)
		if err != nil {
			return nil, err
		}
		row[field+"Url"] = "/api/media/" + stored.ID
	}
	if err := m.ClaimMediaURLs(ctx, row, identity); err != nil {
		return nil, err
	}
	return row, nil
}

func (m *Manager) storeSourceMedia(ctx context.Context, source, attachmentID string, identity Identity) (string, error) {
	if path := m.MediaURLPath(source, identity); path != "" {
		return path, nil
	}
	if strings.HasPrefix(source, "data:") {
		bytes, mime, ok := decodeDataURI(source)
		if !ok {
			return "", errors.New("媒体编码无效或超过大小限制。")
		}
		if err := m.ReserveBytes(ctx, identity, int64(len(bytes))); err != nil {
			return "", err
		}
		stored, err := m.Store(ctx, bytes, mime, attachmentID, identity)
		if err != nil {
			return "", err
		}
		return "/api/media/" + stored.ID, nil
	}
	if strings.HasPrefix(strings.ToLower(source), "blob:") {
		return "", errors.New("浏览器临时媒体需要从原设备重新同步。")
	}
	remote, err := m.ImportRemoteMedia(ctx, source)
	if err != nil {
		return "", err
	}
	if err := m.ReserveBytes(ctx, identity, int64(len(remote.Bytes))); err != nil {
		return "", err
	}
	stored, err := m.Store(ctx, remote.Bytes, remote.Mime, attachmentID, identity)
	if err != nil {
		return "", err
	}
	return "/api/media/" + stored.ID, nil
}

var mediaFields = map[string]bool{
	"url": true, "coverUrl": true, "keyframeUrl": true, "videoUrl": true,
	"musicUrl": true, "finalVideoUrl": true, "lyricsUrl": true, "lrcUrl": true,
}

// PublicRecordMedia hides legacy bucket/provider domains from record responses
// while a background migration is still pending.
func (m *Manager) PublicRecordMedia(value any, identity Identity) any {
	switch typed := value.(type) {
	case []any:
		out := make([]any, len(typed))
		for i, entry := range typed {
			out[i] = m.PublicRecordMedia(entry, identity)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, entry := range typed {
			if mediaFields[key] {
				if text, ok := entry.(string); ok {
					if local := m.MediaURLPath(text, identity); local != "" {
						out[key] = local
					} else if strings.HasPrefix(text, "data:") {
						out[key] = text
					}
					continue
				}
			}
			out[key] = m.PublicRecordMedia(entry, identity)
		}
		return out
	default:
		return value
	}
}
