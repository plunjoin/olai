package ai

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

type SongSection struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Direction string `json:"direction"`
	Lyrics    string `json:"lyrics"`
}

type Song struct {
	Title        string        `json:"title"`
	Style        string        `json:"style"`
	Instrumental bool          `json:"instrumental"`
	Sections     []SongSection `json:"sections"`
}

var sectionTypes = map[string]bool{"intro": true, "verse": true, "chorus": true, "bridge": true, "outro": true}

var ErrSong = errors.New("歌曲整理结果格式不完整，请重试。")

func truncateRunes(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}

var codeFenceStart = regexp.MustCompile(`(?i)^` + "```" + `(?:json)?\s*`)
var codeFenceEnd = regexp.MustCompile("\\s*```$")

func ParseSong(text string) (*Song, error) {
	cleaned := codeFenceEnd.ReplaceAllString(codeFenceStart.ReplaceAllString(strings.TrimSpace(text), ""), "")
	var value map[string]any
	if err := json.Unmarshal([]byte(cleaned), &value); err != nil {
		return nil, ErrSong
	}
	title, titleOK := value["title"].(string)
	style, styleOK := value["style"].(string)
	instrumental, instOK := value["instrumental"].(bool)
	sectionsRaw, sectionsOK := value["sections"].([]any)
	if !titleOK || !styleOK || !instOK || !sectionsOK || len(sectionsRaw) == 0 || len(sectionsRaw) > 30 {
		return nil, errors.New("歌曲整理结果缺少有效段落，请重试。")
	}
	song := &Song{Title: truncateRunes(title, 100), Style: truncateRunes(style, 2000), Instrumental: instrumental}
	for index, raw := range sectionsRaw {
		section, ok := raw.(map[string]any)
		if !ok {
			return nil, errors.New("歌曲段落格式不正确，请重试。")
		}
		kind, _ := section["type"].(string)
		direction, directionOK := section["direction"].(string)
		lyrics, lyricsOK := section["lyrics"].(string)
		if !sectionTypes[kind] || !directionOK || !lyricsOK {
			return nil, errors.New("歌曲段落格式不正确，请重试。")
		}
		if instrumental {
			lyrics = ""
		}
		song.Sections = append(song.Sections, SongSection{
			ID:        "section-" + itoa(index),
			Type:      kind,
			Direction: truncateRunes(direction, 2000),
			Lyrics:    truncateRunes(lyrics, 6000),
		})
	}
	return song, nil
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var buf [12]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	return string(buf[i:])
}

func SongPrompt(song *Song) string {
	title := song.Title
	if title == "" {
		title = "未命名歌曲"
	}
	style := song.Style
	if style == "" {
		style = "自由创作"
	}
	vocal := "Create a complete song. Sing the lyrics exactly as written."
	if song.Instrumental {
		vocal = "Instrumental only. No vocals."
	}
	parts := []string{
		"Title: " + title,
		"Style: " + style,
		vocal,
	}
	for _, section := range song.Sections {
		var body strings.Builder
		body.WriteString("[" + section.Type + "]\n")
		if section.Direction != "" {
			body.WriteString("Direction: " + section.Direction + "\n")
		}
		if song.Instrumental {
			body.WriteString("(instrumental)")
		} else {
			body.WriteString(section.Lyrics)
		}
		parts = append(parts, body.String())
	}
	return strings.Join(parts, "\n\n")
}

// ---- workflow prompts ----

type WorkflowElement struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type StyleBible struct {
	Appearance string `json:"appearance"`
	Wardrobe   string `json:"wardrobe"`
	ArtStyle   string `json:"artStyle"`
	Palette    string `json:"palette"`
}

type Shot struct {
	ID               string   `json:"id"`
	Number           int      `json:"number"`
	Duration         float64  `json:"duration"`
	SceneDescription string   `json:"sceneDescription"`
	Framing          string   `json:"framing"`
	CameraMovement   string   `json:"cameraMovement"`
	ElementIDs       []string `json:"elementIds"`
}

var elementLabels = map[string]string{"character": "角色", "scene": "场景", "prop": "道具"}

func buildElementPrompt(elements []WorkflowElement) string {
	if len(elements) == 0 {
		return ""
	}
	var out strings.Builder
	out.WriteString("\n\n创作元素（保持名称与设定一致）：\n")
	for _, element := range elements {
		out.WriteString("- " + elementLabels[element.Kind] + " [" + element.ID + "] " + element.Name + "：" + element.Description + "\n")
	}
	return out.String()
}

func BuildScriptPrompt(idea string, targetLength float64, elements []WorkflowElement) string {
	return "你是一位专业的短视频编剧。根据以下创意，创作一个时长 " + formatNumber(targetLength) + ` 秒的短片脚本。

创意：` + idea + `
` + buildElementPrompt(elements) + `

请输出以下内容的 JSON：
{
  "title": "短片标题",
  "logline": "一句话简介（30字以内）",
  "script": "详细脚本，包含故事发展和情节转折",
  "styleBible": {
    "appearance": "主要角色的外观特征（发型、五官、体型等）",
    "wardrobe": "服装风格（颜色、款式、配饰）",
    "artStyle": "美术风格（例如：赛博朋克、水彩、写实、动画等）",
    "palette": "主色调（例如：暖色调、冷色调、黑白、高饱和度等）"
  }
}

要求：
1. 脚本要适合 ` + formatNumber(targetLength) + ` 秒的短视频
2. 风格圣经要详细具体，便于后续图像生成保持一致性
3. 只返回 JSON，不要其他说明文字`
}

func BuildShotListPrompt(script string, style StyleBible, targetLength float64, elements []WorkflowElement) string {
	return `你是一位专业的短片导演。根据以下脚本和风格圣经，创作分镜头脚本。

脚本：
` + script + `
` + buildElementPrompt(elements) + `

风格圣经：
- 角色外观：` + style.Appearance + `
- 服装：` + style.Wardrobe + `
- 美术风格：` + style.ArtStyle + `
- 色调：` + style.Palette + `

目标总时长：` + formatNumber(targetLength) + ` 秒

请输出镜头列表的 JSON 数组，每个镜头包含：
[
  {
    "duration": 镜头时长（秒，3-8秒），
    "framing": "景别和机位（例如：特写、中景、远景、俯拍、仰拍等）",
    "cameraMovement": "镜头运动（例如：固定、推进、拉远、横移、跟随等）",
    "sceneDescription": "详细的场景描述，包含人物动作、环境细节、光线氛围等",
    "dialogue": "对白或旁白（如无则为空字符串）",
    "soundNotes": "音效备注（如无则为空字符串）",
    "elementIds": ["本镜头使用的创作元素 ID，仅选上面提供的 ID，无则为空数组"]
  }
]

要求：
1. 所有镜头总时长应接近 ` + formatNumber(targetLength) + ` 秒（允许±3秒误差）
2. 每个镜头时长在 3-8 秒之间
3. 场景描述要详细具体，包含风格圣经的视觉元素
4. 合理安排景别和镜头运动，形成节奏感
5. 只返回 JSON 数组，不要其他说明文字`
}

func BuildKeyframePrompt(shot Shot, style StyleBible, elements []WorkflowElement) string {
	styleDesc := "美术风格：" + style.ArtStyle + "。色调：" + style.Palette + "。角色外观：" + style.Appearance + "。服装：" + style.Wardrobe + "。"
	return shot.SceneDescription + "\n\n" + styleDesc + "\n\n景别：" + shot.Framing + "。画面构图专业，电影质感。" + buildElementPrompt(filterElements(elements, shot.ElementIDs))
}

func BuildVideoPrompt(shot Shot, style StyleBible, hasKeyframe bool, elements []WorkflowElement) string {
	styleDesc := "美术风格：" + style.ArtStyle + "。色调：" + style.Palette + "。"
	movementDesc := ""
	if shot.CameraMovement != "固定" {
		movementDesc = "镜头" + shot.CameraMovement + "。"
	}
	if hasKeyframe {
		return shot.SceneDescription + "\n\n" + movementDesc + styleDesc + "景别：" + shot.Framing + "。电影质感。" + buildElementPrompt(filterElements(elements, shot.ElementIDs))
	}
	out := BuildKeyframePrompt(shot, style, elements)
	if movementDesc != "" {
		out += "\n\n" + movementDesc
	}
	return out
}

func BuildMusicPrompt(script string, style StyleBible, duration float64) string {
	seconds := int(duration)
	if float64(seconds) < duration {
		seconds++
	}
	return `为以下短片创作背景音乐：

脚本：` + script + `

风格：` + style.ArtStyle + `
情绪：根据脚本内容选择合适的情绪和节奏

要求：
1. 音乐时长约 ` + itoa(seconds) + ` 秒
2. 纯音乐，无人声
3. 情绪与脚本内容匹配
4. 音量适中，适合作为背景音乐`
}

func filterElements(elements []WorkflowElement, ids []string) []WorkflowElement {
	if len(ids) == 0 {
		return nil
	}
	selected := map[string]bool{}
	for _, id := range ids {
		selected[id] = true
	}
	var out []WorkflowElement
	for _, element := range elements {
		if selected[element.ID] {
			out = append(out, element)
		}
	}
	return out
}

func formatNumber(value float64) string {
	if value == float64(int64(value)) {
		return itoa(int(value))
	}
	return strings.TrimRight(strings.TrimRight(jsonNumber(value), "0"), ".")
}

func jsonNumber(value float64) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
