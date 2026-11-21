// Package pricing 只在服务端计算积分价格。客户端只拿到公开档位和单价。
package pricing

import (
	"math"

	"olai/internal/settings"
)

var ImageQualities = []string{"1K", "2K", "4K"}
var VideoResolutions = []string{"360p", "720p", "1080p", "4k"}

var imageDefaults = map[string]int{"1K": 1, "2K": 2, "4K": 4}
var videoDefaults = map[string]int{"360p": 1, "720p": 2, "1080p": 4, "4k": 8}

type Manager struct{ Settings *settings.Manager }

func (m *Manager) points(key string, fallback int) int {
	return m.Settings.Int(key, fallback)
}

func (m *Manager) ImageCost(quality string) int {
	fallback := imageDefaults[quality]
	return m.points("POINT_IMAGE_"+upper(quality), fallback)
}

func (m *Manager) VideoCostPerSecond(resolution string) int {
	fallback := videoDefaults[resolution]
	return m.points("POINT_VIDEO_"+upper(resolution), fallback)
}

func (m *Manager) VideoCost(resolution string, seconds float64) int {
	units := int(math.Ceil(seconds))
	if units < 0 {
		units = 0
	}
	return units * m.VideoCostPerSecond(resolution)
}

func (m *Manager) MusicCost(seconds float64) int {
	perMinute := m.points("POINT_MUSIC_PER_MINUTE", 2)
	minutes := int(math.Ceil(math.Max(1, seconds) / 60))
	if minutes < 1 {
		minutes = 1
	}
	return minutes * perMinute
}

func (m *Manager) ChatCost() int { return m.points("POINT_CHAT", 0) }

func (m *Manager) SignupBonus() int      { return m.points("POINT_SIGNUP_BONUS", 100) }
func (m *Manager) InviteReward() int     { return m.points("POINT_INVITE_REWARD", 30) }
func (m *Manager) InviteBonus() int      { return m.points("POINT_INVITE_BONUS", 20) }
func (m *Manager) InviteDailyLimit() int { return m.points("POINT_INVITE_DAILY_LIMIT", 5) }

type PublicPrices struct {
	Image          map[string]int `json:"image"`
	Video          map[string]int `json:"video"`
	MusicPerMinute int            `json:"musicPerMinute"`
	ChatPerMessage int            `json:"chatPerMessage"`
}

func (m *Manager) Public() PublicPrices {
	image := map[string]int{}
	for _, quality := range ImageQualities {
		image[quality] = m.ImageCost(quality)
	}
	video := map[string]int{}
	for _, resolution := range VideoResolutions {
		video[resolution] = m.VideoCostPerSecond(resolution)
	}
	return PublicPrices{
		Image: image, Video: video,
		MusicPerMinute: m.points("POINT_MUSIC_PER_MINUTE", 2),
		ChatPerMessage: m.ChatCost(),
	}
}

func upper(value string) string {
	out := make([]byte, len(value))
	for i := 0; i < len(value); i++ {
		c := value[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}
