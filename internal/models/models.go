// Package models 维护可选模型目录。上游模型 ID 只保存在服务端，
// 客户端只拿到公开 ID、别名、类型与积分价格。
package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"olai/internal/pricing"
	"olai/internal/settings"
	"olai/internal/store"
)

type Kind string

const (
	KindChat  Kind = "chat"
	KindImage Kind = "image"
	KindVideo Kind = "video"
	KindMusic Kind = "music"
)

var Kinds = []Kind{KindChat, KindImage, KindVideo, KindMusic}

var kindLabels = map[Kind]string{KindChat: "对话", KindImage: "图像", KindVideo: "视频", KindMusic: "音乐"}

const maxPoints = 1_000_000
const maxDisplayName = 200

type MusicPrices struct {
	PerMinute int `json:"perMinute"`
}

type ChatPrices struct {
	// PerMessage supports two decimals. The store accumulates the fractional
	// part per user and charges whole points once it reaches one.
	PerMessage float64 `json:"perMessage"`
}

type Prices struct {
	Image map[string]int `json:"image,omitempty"`
	Video map[string]int `json:"video,omitempty"`
	Music *MusicPrices   `json:"music,omitempty"`
	Chat  *ChatPrices    `json:"chat,omitempty"`
}

type Choice struct {
	PublicID   string
	UpstreamID string
	Kind       Kind
	Prices     Prices
	// Tiers lists the option tiers this model supports; empty means all.
	Tiers []string
	// Alias is the public display name. It is safe to send to the browser;
	// UpstreamID must never leave the server.
	Alias string
}

// TiersForKind returns the option tiers that can be configured for a kind.
// Chat and music models have no tier selection and therefore no tiers.
func TiersForKind(kind Kind) []string {
	switch kind {
	case KindImage:
		return append([]string{}, pricing.ImageQualities...)
	case KindVideo:
		return append([]string{}, pricing.VideoResolutions...)
	default:
		return nil
	}
}

func containsTier(tiers []string, tier string) bool {
	for _, candidate := range tiers {
		if candidate == tier {
			return true
		}
	}
	return false
}

// NormalizeTiers validates an admin-supplied tier list and returns it in the
// canonical order of the kind. An omitted value means every tier is supported;
// an explicit list must contain at least one supported tier.
func NormalizeTiers(kind Kind, value any) ([]string, error) {
	allowed := TiersForKind(kind)
	if len(allowed) == 0 {
		return nil, nil
	}
	if value == nil {
		return allowed, nil
	}
	list, ok := value.([]any)
	if !ok {
		return nil, &Error{Message: "模型档位格式无效。"}
	}
	chosen := map[string]bool{}
	for _, item := range list {
		tier, ok := item.(string)
		if !ok || !containsTier(allowed, tier) {
			return nil, &Error{Message: "模型档位无效。"}
		}
		chosen[tier] = true
	}
	out := make([]string, 0, len(allowed))
	for _, tier := range allowed {
		if chosen[tier] {
			out = append(out, tier)
		}
	}
	if len(out) == 0 {
		return nil, &Error{Message: "请至少选择一个支持档位。"}
	}
	return out, nil
}

// ReadTiers decodes a stored tier list. Missing, malformed or empty values fall
// back to every tier of the kind so catalogs created before tiers existed keep
// working.
func ReadTiers(kind Kind, raw string) []string {
	allowed := TiersForKind(kind)
	if len(allowed) == 0 {
		return nil
	}
	if strings.TrimSpace(raw) == "" {
		return allowed
	}
	var stored []string
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return allowed
	}
	list := make([]any, len(stored))
	for index, tier := range stored {
		list[index] = tier
	}
	tiers, err := NormalizeTiers(kind, list)
	if err != nil {
		return allowed
	}
	return tiers
}

func EncodeTiers(tiers []string) string {
	if len(tiers) == 0 {
		return ""
	}
	encoded, err := json.Marshal(tiers)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// SupportsTier reports whether the model accepts the given option tier.
func (c Choice) SupportsTier(tier string) bool {
	if len(c.Tiers) == 0 {
		return true
	}
	for _, candidate := range c.Tiers {
		if strings.EqualFold(candidate, tier) {
			return true
		}
	}
	return false
}

type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }

func AsKind(value string) (Kind, bool) {
	for _, kind := range Kinds {
		if string(kind) == value {
			return kind, true
		}
	}
	return "", false
}

func PublicIDFor(upstreamID string) string {
	sum := sha256.Sum256([]byte(upstreamID))
	return "mdl_" + hex.EncodeToString(sum[:])[:24]
}

var (
	imageKindRE = regexp.MustCompile(`(?i)(?:^|[-_/])(?:imagen|image|dall-?e|flux|stable-diffusion|sd[0-9x]|seedream|midjourney|kolors|cogview|nano-banana|gpt-image|qwen-image)(?:[-_./]|$)`)
	videoKindRE = regexp.MustCompile(`(?i)(?:^|[-_/])(?:veo|sora|kling|runway|hailuo|seedance|pika|luma|video|omni)(?:[-_./]|$)`)
	musicKindRE = regexp.MustCompile(`(?i)(?:^|[-_/])(?:lyria|music|suno|udio|audio|speech|tts|elevenlabs|voice)(?:[-_./]|$)`)
)

func GuessKind(id string) Kind {
	switch {
	case imageKindRE.MatchString(id):
		return KindImage
	case videoKindRE.MatchString(id):
		return KindVideo
	case musicKindRE.MatchString(id):
		return KindMusic
	default:
		return KindChat
	}
}

type UpstreamEntry struct {
	ID          string  `json:"id"`
	DisplayName *string `json:"displayName"`
}

func UpstreamEntries(value any) []UpstreamEntry {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	entries := map[string]*string{}
	order := []string{}
	for _, raw := range list {
		source, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id := ""
		if value, ok := source["id"].(string); ok {
			id = strings.TrimSpace(value)
		} else if value, ok := source["name"].(string); ok {
			id = strings.TrimSpace(value)
		}
		if id == "" || len(id) > 200 {
			continue
		}
		var displayName *string
		rawName := ""
		if value, ok := source["display_name"].(string); ok {
			rawName = value
		} else if value, ok := source["displayName"].(string); ok {
			rawName = value
		}
		trimmed := strings.Join(strings.Fields(rawName), " ")
		if len(trimmed) > maxDisplayName {
			trimmed = trimmed[:maxDisplayName]
		}
		if trimmed != "" {
			displayName = &trimmed
		}
		if existing, exists := entries[id]; !exists || (existing == nil && displayName != nil) {
			if !exists {
				order = append(order, id)
			}
			entries[id] = displayName
		}
	}
	out := make([]UpstreamEntry, 0, len(order))
	for _, id := range order {
		out = append(out, UpstreamEntry{ID: id, DisplayName: entries[id]})
	}
	return out
}

type Manager struct {
	DB       *store.DB
	Settings *settings.Manager
	Pricing  *pricing.Manager
	Client   *http.Client

	syncMu sync.Mutex
}

func (m *Manager) client() *http.Client {
	if m.Client != nil {
		return m.Client
	}
	return &http.Client{Timeout: 20 * time.Second}
}

func (m *Manager) DefaultPrices(kind Kind) Prices {
	switch kind {
	case KindImage:
		image := map[string]int{}
		for _, tier := range pricing.ImageQualities {
			image[tier] = m.Pricing.ImageCost(tier)
		}
		return Prices{Image: image}
	case KindVideo:
		video := map[string]int{}
		for _, tier := range pricing.VideoResolutions {
			video[tier] = m.Pricing.VideoCostPerSecond(tier)
		}
		return Prices{Video: video}
	case KindMusic:
		return Prices{Music: &MusicPrices{PerMinute: m.Pricing.MusicCost(60)}}
	default:
		return Prices{Chat: &ChatPrices{PerMessage: float64(m.Pricing.ChatCost())}}
	}
}

func validPoints(value any) (int, bool) {
	number, ok := value.(float64)
	if !ok || number != float64(int(number)) || int(number) < 0 || int(number) > maxPoints {
		return 0, false
	}
	return int(number), true
}

// validChatPrice accepts a non-negative price with at most two decimals.
func validChatPrice(value any) (float64, bool) {
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > maxPoints {
		return 0, false
	}
	hundredths := math.Round(number * 100)
	if math.Abs(number*100-hundredths) > 1e-6 {
		return 0, false
	}
	return hundredths / 100, true
}

func (m *Manager) NormalizePrices(kind Kind, value any) (Prices, error) {
	raw, ok := value.(map[string]any)
	if !ok {
		return Prices{}, &Error{Message: "模型价格格式无效。"}
	}
	if kind == KindImage || kind == KindVideo {
		tiers := pricing.ImageQualities
		if kind == KindVideo {
			tiers = pricing.VideoResolutions
		}
		bucket, ok := raw[string(kind)].(map[string]any)
		if !ok {
			return Prices{}, &Error{Message: "模型价格格式无效。"}
		}
		prices := map[string]int{}
		for _, tier := range tiers {
			price, ok := validPoints(bucket[tier])
			if !ok {
				return Prices{}, &Error{Message: fmt.Sprintf("请填写有效的 %s 价格。", tier)}
			}
			prices[tier] = price
		}
		if kind == KindImage {
			return Prices{Image: prices}, nil
		}
		return Prices{Video: prices}, nil
	}
	bucket, _ := raw[string(kind)].(map[string]any)
	if kind == KindMusic {
		price, ok := validPoints(bucket["perMinute"])
		if !ok {
			return Prices{}, &Error{Message: "请填写有效的每分钟价格。"}
		}
		return Prices{Music: &MusicPrices{PerMinute: price}}, nil
	}
	price, ok := validChatPrice(bucket["perMessage"])
	if !ok {
		return Prices{}, &Error{Message: "请填写有效的每条消息价格（最多两位小数）。"}
	}
	return Prices{Chat: &ChatPrices{PerMessage: price}}, nil
}

func (m *Manager) ReadPrices(kind Kind, text string) Prices {
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return m.DefaultPrices(kind)
	}
	prices, err := m.NormalizePrices(kind, value)
	if err != nil {
		return m.DefaultPrices(kind)
	}
	return prices
}

type PointOptions struct {
	Quality    string
	Resolution string
	Seconds    float64
}

func (m *Manager) ModelPoints(choice Choice, options PointOptions) int {
	return Points(choice, options, m.Pricing)
}

// ChatHundredths returns one chat message's price in hundredths of a point.
func ChatHundredths(choice Choice, price *pricing.Manager) int {
	if choice.Prices.Chat != nil {
		return int(math.Round(choice.Prices.Chat.PerMessage * 100))
	}
	return price.ChatCost() * 100
}

// Points computes the actual charge for one generation, falling back to the
// global price table for missing tiers.
func Points(choice Choice, options PointOptions, price *pricing.Manager) int {
	switch choice.Kind {
	case KindImage:
		tier := options.Quality
		if tier == "" {
			tier = "1K"
		}
		if value, ok := choice.Prices.Image[tier]; ok {
			return value
		}
		return price.ImageCost(tier)
	case KindVideo:
		tier := options.Resolution
		if tier == "" {
			tier = "720p"
		}
		seconds := options.Seconds
		if seconds < 1 {
			seconds = 4
		}
		units := int(seconds)
		if float64(units) < seconds {
			units++
		}
		if units < 1 {
			units = 1
		}
		perSecond, ok := choice.Prices.Video[tier]
		if !ok {
			perSecond = price.VideoCostPerSecond(tier)
		}
		return units * perSecond
	case KindMusic:
		seconds := options.Seconds
		if seconds < 1 {
			seconds = 120
		}
		minutes := int(seconds / 60)
		if float64(minutes)*60 < seconds {
			minutes++
		}
		if minutes < 1 {
			minutes = 1
		}
		perMinute := price.MusicCost(60)
		if choice.Prices.Music != nil {
			perMinute = choice.Prices.Music.PerMinute
		}
		return minutes * perMinute
	default:
		return ChatHundredths(choice, price) / 100
	}
}

var publicIDRE = regexp.MustCompile(`^mdl_[a-f0-9]{24}$`)

func (m *Manager) Resolve(ctx context.Context, publicID string, kind Kind) (*Choice, error) {
	if !publicIDRE.MatchString(publicID) {
		return nil, nil
	}
	row, err := m.DB.ModelByPublicID(ctx, publicID)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rowKind, ok := AsKind(row.Kind)
	if !ok || !row.Enabled || rowKind != kind {
		return nil, nil
	}
	return &Choice{
		PublicID: row.PublicID, UpstreamID: row.UpstreamID, Kind: rowKind,
		Prices: m.ReadPrices(rowKind, row.Prices), Tiers: ReadTiers(rowKind, row.Tiers),
		Alias: row.Alias,
	}, nil
}

// AliasForUpstream returns the public alias of the enabled catalog entry that
// backs a server-default upstream model, or "" when the catalog has no entry.
// Only the alias is returned: the upstream ID is already known to the caller
// and never leaves the server.
func (m *Manager) AliasForUpstream(ctx context.Context, kind Kind, upstreamID string) string {
	if upstreamID == "" {
		return ""
	}
	rows, err := m.DB.Models(ctx, true)
	if err != nil {
		return ""
	}
	for _, row := range rows {
		if row.UpstreamID == upstreamID && row.Kind == string(kind) && strings.TrimSpace(row.Alias) != "" {
			return row.Alias
		}
	}
	return ""
}

type PublicModel struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Kind   Kind   `json:"kind"`
	Prices Prices `json:"prices"`
	// Tiers is the subset of option tiers the model supports. Only image and
	// video models carry it.
	Tiers []string `json:"tiers,omitempty"`
}

type PublicCatalog struct {
	Models []PublicModel `json:"models"`
}

func (m *Manager) PublicCatalog(ctx context.Context) (PublicCatalog, error) {
	rows, err := m.DB.Models(ctx, true)
	if err != nil {
		return PublicCatalog{}, err
	}
	out := PublicCatalog{Models: []PublicModel{}}
	for _, row := range rows {
		kind, ok := AsKind(row.Kind)
		if !ok {
			continue
		}
		out.Models = append(out.Models, PublicModel{
			ID: row.PublicID, Name: row.Alias, Kind: kind,
			Prices: m.ReadPrices(kind, row.Prices), Tiers: ReadTiers(kind, row.Tiers),
		})
	}
	return out, nil
}

type AdminModel struct {
	PublicID    string   `json:"publicId"`
	UpstreamID  string   `json:"upstreamId"`
	DisplayName *string  `json:"displayName"`
	Alias       string   `json:"alias"`
	Kind        Kind     `json:"kind"`
	Enabled     bool     `json:"enabled"`
	Prices      Prices   `json:"prices"`
	Tiers       []string `json:"tiers,omitempty"`
	UpdatedAt   int64    `json:"updatedAt"`
}

type AdminCatalog struct {
	Kinds    []Kind            `json:"kinds"`
	Defaults map[string]Prices `json:"defaults"`
	Models   []AdminModel      `json:"models"`
}

func (m *Manager) CatalogForAdmin(ctx context.Context) (AdminCatalog, error) {
	rows, err := m.DB.Models(ctx, false)
	if err != nil {
		return AdminCatalog{}, err
	}
	out := AdminCatalog{Kinds: Kinds, Defaults: map[string]Prices{}, Models: []AdminModel{}}
	for _, kind := range Kinds {
		out.Defaults[string(kind)] = m.DefaultPrices(kind)
	}
	for _, row := range rows {
		kind, ok := AsKind(row.Kind)
		if !ok {
			kind = KindChat
		}
		out.Models = append(out.Models, AdminModel{
			PublicID: row.PublicID, UpstreamID: row.UpstreamID, DisplayName: row.DisplayName,
			Alias: row.Alias, Kind: kind, Enabled: row.Enabled,
			Prices: m.ReadPrices(kind, row.Prices), Tiers: ReadTiers(kind, row.Tiers),
			UpdatedAt: row.UpdatedAt,
		})
	}
	sort.SliceStable(out.Models, func(i, j int) bool {
		if out.Models[i].Kind != out.Models[j].Kind {
			return out.Models[i].Kind < out.Models[j].Kind
		}
		return out.Models[i].UpstreamID < out.Models[j].UpstreamID
	})
	return out, nil
}

type SyncResult struct {
	Added    int `json:"added"`
	Removed  int `json:"removed"`
	Updated  int `json:"updated"`
	Upstream int `json:"upstream"`
}

type catalogRow struct {
	PublicID, UpstreamID string
	DisplayName          *string
}

type diffResult struct {
	Added   []UpstreamEntry
	Removed []store.ModelRow
	Renamed []catalogRow
}

func diffCatalog(existing []store.ModelRow, entries []UpstreamEntry) diffResult {
	byUpstream := map[string]store.ModelRow{}
	for _, row := range existing {
		byUpstream[row.UpstreamID] = row
	}
	upstreamIDs := map[string]bool{}
	var result diffResult
	for _, entry := range entries {
		upstreamIDs[entry.ID] = true
		row, exists := byUpstream[entry.ID]
		if !exists {
			result.Added = append(result.Added, entry)
			continue
		}
		if entry.DisplayName != nil && (row.DisplayName == nil || *row.DisplayName != *entry.DisplayName) {
			result.Renamed = append(result.Renamed, catalogRow{PublicID: row.PublicID, UpstreamID: row.UpstreamID, DisplayName: entry.DisplayName})
		}
	}
	for _, row := range existing {
		if !upstreamIDs[row.UpstreamID] {
			result.Removed = append(result.Removed, row)
		}
	}
	return result
}

func (m *Manager) Sync(ctx context.Context) (SyncResult, error) {
	m.syncMu.Lock()
	defer m.syncMu.Unlock()
	base := strings.TrimRight(m.Settings.Get("AI_API_BASE_URL"), "/")
	key := m.Settings.Get("AI_API_KEY")
	if base == "" || key == "" {
		return SyncResult{}, &Error{Message: "请先配置 AI 服务地址与密钥。"}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/models", nil)
	if err != nil {
		return SyncResult{}, &Error{Message: "无法连接模型网关，请检查 AI 服务地址与网络。"}
	}
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Accept", "application/json")
	response, err := m.client().Do(request)
	if err != nil {
		return SyncResult{}, &Error{Message: "无法连接模型网关，请检查 AI 服务地址与网络。"}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return SyncResult{}, &Error{Message: fmt.Sprintf("模型网关返回 %d，请检查密钥或稍后重试。", response.StatusCode)}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024))
	if err != nil {
		return SyncResult{}, &Error{Message: "模型网关返回了无法解析的数据。"}
	}
	var jsonBody any
	if err := json.Unmarshal(body, &jsonBody); err != nil {
		return SyncResult{}, &Error{Message: "模型网关返回了无法解析的数据。"}
	}
	var list any
	if source, ok := jsonBody.(map[string]any); ok {
		if data, ok := source["data"].([]any); ok {
			list = data
		} else if models, ok := source["models"].([]any); ok {
			list = models
		}
	}
	entries := UpstreamEntries(list)
	if len(entries) == 0 {
		return SyncResult{}, &Error{Message: "模型网关没有返回任何模型。"}
	}
	existing, err := m.DB.Models(ctx, false)
	if err != nil {
		return SyncResult{}, err
	}
	diff := diffCatalog(existing, entries)
	counts := map[string]int{}
	maxSort := 0
	existingIDs := map[string]bool{}
	for _, row := range existing {
		if row.Sort > maxSort {
			maxSort = row.Sort
		}
		counts[row.Kind]++
		existingIDs[row.PublicID] = true
	}
	now := time.Now().UnixMilli()
	for _, row := range diff.Removed {
		if err := m.DB.DeleteModel(ctx, row.PublicID); err != nil {
			return SyncResult{}, err
		}
	}
	for _, entry := range diff.Added {
		publicID := PublicIDFor(entry.ID)
		if existingIDs[publicID] {
			continue
		}
		kind := GuessKind(entry.ID)
		counts[string(kind)]++
		maxSort++
		label := fmt.Sprintf("%s模型 %d", kindLabels[kind], counts[string(kind)])
		prices, _ := json.Marshal(m.DefaultPrices(kind))
		if err := m.DB.UpsertModel(ctx, store.ModelRow{
			PublicID: publicID, UpstreamID: entry.ID, DisplayName: entry.DisplayName,
			Alias: label, Kind: string(kind), Enabled: true, Prices: string(prices),
			Tiers: EncodeTiers(TiersForKind(kind)),
			Sort:  maxSort, CreatedAt: now, UpdatedAt: now,
		}); err != nil {
			return SyncResult{}, err
		}
	}
	for _, entry := range diff.Renamed {
		if entry.DisplayName != nil {
			if err := m.DB.UpdateModelDisplayName(ctx, entry.PublicID, *entry.DisplayName); err != nil {
				return SyncResult{}, err
			}
		}
	}
	return SyncResult{Added: len(diff.Added), Removed: len(diff.Removed), Updated: len(diff.Renamed), Upstream: len(entries)}, nil
}

var upstreamIDRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:\/-]*$`)

func (m *Manager) Save(ctx context.Context, items []any) (int, error) {
	if len(items) == 0 || len(items) > 500 {
		return 0, &Error{Message: "没有需要保存的模型。"}
	}
	now := time.Now().UnixMilli()
	unique := map[string]store.ModelRow{}
	for _, raw := range items {
		source, ok := raw.(map[string]any)
		if !ok {
			return 0, &Error{Message: "模型数据格式无效。"}
		}
		upstreamID := ""
		if value, ok := source["upstreamId"].(string); ok {
			upstreamID = strings.TrimSpace(value)
		}
		if upstreamID == "" || len(upstreamID) > 200 || !upstreamIDRE.MatchString(upstreamID) {
			return 0, &Error{Message: "上游模型 ID 无效。"}
		}
		alias := ""
		if value, ok := source["alias"].(string); ok {
			alias = strings.TrimSpace(value)
		}
		if alias == "" || len(alias) > 60 {
			return 0, &Error{Message: "模型别名需要 1–60 个字符。"}
		}
		kindText, _ := source["kind"].(string)
		kind, ok := AsKind(kindText)
		if !ok {
			return 0, &Error{Message: "模型类型无效。"}
		}
		enabled := true
		if value, ok := source["enabled"].(bool); ok {
			enabled = value
		}
		prices, err := m.NormalizePrices(kind, source["prices"])
		if err != nil {
			return 0, err
		}
		tiers, err := NormalizeTiers(kind, source["tiers"])
		if err != nil {
			return 0, err
		}
		encoded, _ := json.Marshal(prices)
		publicID := PublicIDFor(upstreamID)
		unique[publicID] = store.ModelRow{
			PublicID: publicID, UpstreamID: upstreamID, Alias: alias, Kind: string(kind),
			Enabled: enabled, Prices: string(encoded), Tiers: EncodeTiers(tiers),
			CreatedAt: now, UpdatedAt: now,
		}
	}
	for _, row := range unique {
		if err := m.DB.UpsertModel(ctx, row); err != nil {
			return 0, err
		}
	}
	return len(unique), nil
}
