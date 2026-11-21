// Package ai 组装上游请求、清洗公开响应，并保存所有服务端提示词。
package ai

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"

	"olai/internal/settings"
)

var ServerModels = map[string]string{
	"chat":  "gemini-3.5-flash",
	"image": "gemini-3.1-flash-image",
	"video": "gemini-omni-1.1-flash",
	"music": "lyria-3.5",
}

const DefaultSystemPrompt = "你是小o，Olai（Online AI Chat Companion）的星球伙伴，一个温暖、善解人意且知识渊博的在线 AI 伴侣与创意助手。用“小o”介绍自己，默认用中文回答。陪伴用户畅聊日常、倾听心声、激发灵感并协助创作。"

const SongSystemPrompt = `你是专业作词和编曲助手。将灵感整理为可编辑的完整歌曲。只返回 JSON: {"title":"歌曲名","style":"流派、节奏、乐器、人声和氛围","instrumental":false,"sections":[{"type":"intro|verse|chorus|bridge|outro","direction":"该段编曲说明","lyrics":"该段实际歌词，换行分句"}]}。按音乐逻辑安排段落，可重复 verse/chorus。保留用户已给出的歌词，不要把编曲说明混入歌词。用户明确要求无人声时 instrumental=true 且所有 lyrics 为空。否则根据主题写歌词，语言跟随用户。至少包含 intro, verse, chorus, bridge, outro。`

const AlignmentSystemPrompt = `你是音频歌词对齐助手。必须聆听提供的实际音频，标出每句歌词人声开始与结束的秒数，包含前奏、间奏、尾奏留白。禁止按总时长平均分配或猜测。按编号返回每一句（包括重复句），只返回 JSON: {"lines":[{"index":0,"start":12.34,"end":15.67}]}。index 从 0 开始，start/end 必须是实际秒数、递增且不重叠。未听到的句子或无法访问音频时返回 {"lines":[]}。`

type Manager struct{ Settings *settings.Manager }

func (m *Manager) Env(name string) string { return m.Settings.Get(name) }

func (m *Manager) ServerModel(kind string) string {
	if value := m.Settings.Get("AI_" + strings.ToUpper(kind) + "_MODEL"); value != "" {
		return value
	}
	return ServerModels[kind]
}

func (m *Manager) Ready() bool {
	return m.Settings.Get("AI_API_KEY") != "" && m.Settings.Get("AI_API_BASE_URL") != ""
}

func (m *Manager) VideoMode(model string) string {
	lower := strings.ToLower(model)
	if strings.HasPrefix(lower, "veo-") || strings.HasPrefix(lower, "veo.") || m.Settings.Get("AI_VIDEO_OMNI_ASYNC") == "true" {
		return "task"
	}
	return "chat"
}

func (m *Manager) taskKey() []byte {
	sum := sha256.Sum256([]byte(m.Settings.Get("AI_API_KEY")))
	return sum[:]
}

var ErrInvalidTask = errors.New("invalid task")

func (m *Manager) EncodeTaskID(id string) (string, error) {
	block, err := aes.NewCipher(m.taskKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, iv, []byte(id), nil)
	// Go's GCM appends the 16-byte tag to the ciphertext, matching iv|tag|data.
	out := append(iv, sealed...)
	return "job_" + base64.RawURLEncoding.EncodeToString(out), nil
}

func (m *Manager) DecodeTaskID(id string) (string, error) {
	if !strings.HasPrefix(id, "job_") {
		return "", ErrInvalidTask
	}
	bytes, err := base64.RawURLEncoding.DecodeString(id[4:])
	if err != nil || len(bytes) < 28 {
		return "", ErrInvalidTask
	}
	block, err := aes.NewCipher(m.taskKey())
	if err != nil {
		return "", ErrInvalidTask
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", ErrInvalidTask
	}
	plain, err := gcm.Open(nil, bytes[:12], bytes[12:], nil)
	if err != nil {
		return "", ErrInvalidTask
	}
	return string(plain), nil
}
