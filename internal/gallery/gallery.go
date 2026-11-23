// Package gallery 公开已完成作品的只读视图。每个媒体引用都会重新校验
// 记录、字段白名单与发布者所有权。
package gallery

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"olai/internal/ai"
	"olai/internal/httpx"
	"olai/internal/media"
	"olai/internal/secure"
	"olai/internal/settings"
	"olai/internal/store"
)

const (
	maxRecordChars = 64 * 1024 * 1024
	inlineMaxBytes = 32 * 1024 * 1024
	batchSize      = 30
	// heatScanLimit bounds how many works the hot ranking reads in one request.
	// A self-hosted gallery is expected to stay far below this; the bound keeps
	// a pathological database from pinning a request indefinitely.
	heatScanLimit = 2000
	// maxListOffset bounds offset paging. Listing materializes candidates up to
	// offset+limit before slicing, so without a bound an anonymous request
	// could ask for an enormous offset and force a huge allocation. The public
	// feed never pages anywhere near this.
	maxListOffset = 10_000
)

// Heat weights engagement: a favorite is a stronger signal than a download,
// which in turn is stronger than a pass-through view.
const (
	heatViewWeight     = 1
	heatDownloadWeight = 2
	heatFavoriteWeight = 3
)

var (
	folderIDPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
	recordKeyRE     = regexp.MustCompile(`^[a-f0-9]{64}$`)
	uuidPattern     = `[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`
	handleRE        = regexp.MustCompile(`(?i)^/api/media/(` + uuidPattern + `)$`)
	publicRE        = regexp.MustCompile(`^([a-f0-9]{64})\.(url|coverUrl|lyricsUrl|lrcUrl)\.(` + uuidPattern + `|inline-[a-f0-9]{64})$`)
	dataHeaderRE    = regexp.MustCompile(`(?i)^data:([a-z0-9.+/-]+)(?:;charset=[a-z0-9_-]+)?;base64$`)
	base64RE        = regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)
	durationRE      = regexp.MustCompile(`^(?:auto|1:1|16:9|9:16|4:3|3:4|3:2|2:3|21:9)$`)
)

var fields = []string{"url", "coverUrl", "lyricsUrl", "lrcUrl"}

type Manager struct {
	DB       *store.DB
	Media    *media.Manager
	Settings *settings.Manager
	AI       *ai.Manager
}

type inlineMedia struct {
	mime    string
	payload string
}

type reference struct {
	field  string
	id     string
	inline *inlineMedia
}

func errorf(status int, code, message string) *media.Error {
	return &media.Error{Status: status, Code: code, Message: message}
}

func accepts(kind, field, mime string) bool {
	switch field {
	case "coverUrl":
		return regexp.MustCompile(`^image/(?:png|jpeg|webp|gif|avif|bmp)$`).MatchString(mime)
	case "lyricsUrl":
		return mime == "text/plain"
	case "lrcUrl":
		return mime == "text/plain" || mime == "text/lrc" || mime == "application/x-lrc"
	}
	switch kind {
	case "image":
		return accepts(kind, "coverUrl", mime)
	case "music":
		return regexp.MustCompile(`^audio/(?:mpeg|mp3|mp4|aac|wav|x-wav|ogg|webm|flac|x-flac)$`).MatchString(mime)
	default:
		return regexp.MustCompile(`^video/(?:mp4|webm|quicktime|ogg)$`).MatchString(mime)
	}
}

func completed(value map[string]any) bool {
	if value == nil {
		return false
	}
	status, _ := value["status"].(string)
	kind, _ := value["kind"].(string)
	_, promptOK := value["prompt"].(string)
	_, createdOK := value["createdAt"].(float64)
	return status == "completed" && (kind == "image" || kind == "music" || kind == "video") && promptOK && createdOK
}

func sourceOrigin(r *http.Request, s *settings.Manager) string {
	origin := s.SiteOrigin()
	if origin != "" {
		if parsed, err := url.Parse(origin); err == nil {
			return parsed.Scheme + "://" + parsed.Host
		}
	}
	return httpx.RequestOrigin(r, s)
}

func mediaID(value any, origin string) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	path := text
	if !strings.HasPrefix(path, "/") {
		parsed, err := url.Parse(text)
		if err != nil || parsed.Scheme+"://"+parsed.Host != origin || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return ""
		}
		path = parsed.Path
	}
	match := handleRE.FindStringSubmatch(path)
	if match == nil {
		return ""
	}
	return strings.ToLower(match[1])
}

func inlineMediaValue(value any, kind, field string) *inlineMedia {
	text, ok := value.(string)
	if !ok || len(text) > (inlineMaxBytes/3+1)*4+4096 {
		return nil
	}
	comma := strings.Index(text, ",")
	if comma < 0 || comma > 100 {
		return nil
	}
	header := dataHeaderRE.FindStringSubmatch(text[:comma])
	if header == nil {
		return nil
	}
	mime := strings.ToLower(header[1])
	if !accepts(kind, field, mime) {
		return nil
	}
	payload := strings.Join(strings.Fields(text[comma+1:]), "")
	if payload == "" || len(payload)%4 != 0 || !base64RE.MatchString(payload) {
		return nil
	}
	size := len(payload) / 4 * 3
	if strings.HasSuffix(payload, "==") {
		size -= 2
	} else if strings.HasSuffix(payload, "=") {
		size--
	}
	if size < 1 || size > inlineMaxBytes {
		return nil
	}
	return &inlineMedia{mime: mime, payload: payload}
}

func referenceList(value map[string]any, origin string) []reference {
	kind, _ := value["kind"].(string)
	var out []reference
	for _, field := range fields {
		if field == "coverUrl" {
			if status, ok := value["coverStatus"].(string); ok && status != "" && status != "completed" {
				continue
			}
		}
		var inline *inlineMedia
		if field == "url" {
			inline = inlineMediaValue(value["blobData"], kind, field)
		}
		if inline == nil {
			inline = inlineMediaValue(value[field], kind, field)
		}
		if inline != nil {
			sum := sha256.Sum256([]byte(inline.mime + ":" + inline.payload))
			out = append(out, reference{field: field, id: "inline-" + hex.EncodeToString(sum[:]), inline: inline})
			continue
		}
		if id := mediaID(value[field], origin); id != "" {
			out = append(out, reference{field: field, id: id})
		}
	}
	return out
}

func truncate(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	return string([]rune(value)[:max])
}

func numberField(value any) (float64, bool) {
	number, ok := value.(float64)
	if !ok {
		return 0, false
	}
	return number, true
}

func projection(record store.RecordWithBody, value map[string]any, secrets []string) map[string]any {
	text := func(input string, max int) string { return truncate(ai.RedactText(input, secrets), max) }
	kind, _ := value["kind"].(string)
	output := map[string]any{
		"id": "gallery_" + record.Key, "kind": kind, "status": "completed",
		"prompt":    text(stringValue(value["prompt"]), 16000),
		"createdAt": value["createdAt"], "options": map[string]any{},
	}
	options := map[string]any{}
	if raw, ok := value["options"].(map[string]any); ok {
		options = raw
	}
	outputOptions := output["options"].(map[string]any)
	if ratio, ok := options["aspect_ratio"].(string); ok && durationRE.MatchString(ratio) {
		outputOptions["aspect_ratio"] = ratio
	}
	if size, ok := options["image_size"].(string); ok && (size == "1K" || size == "2K" || size == "4K") {
		outputOptions["image_size"] = size
	}
	if resolution, ok := options["resolution"].(string); ok {
		resolution = strings.ToLower(resolution)
		switch resolution {
		case "360p", "720p", "1080p", "4k":
			outputOptions["resolution"] = resolution
		}
	}
	if effort, ok := options["reasoning_effort"].(string); ok && (effort == "minimal" || effort == "medium" || effort == "high") {
		outputOptions["reasoning_effort"] = effort
	}
	if mode, ok := options["music_mode"].(string); ok && (mode == "inspiration" || mode == "composer") {
		outputOptions["music_mode"] = mode
	}
	// Video requests carry the requested length as "seconds"; publish it under
	// the single "duration" name the portal reads.
	durationValue := options["duration"]
	if durationValue == nil {
		durationValue = options["seconds"]
	}
	if duration, ok := numberField(durationValue); ok && duration > 0 && duration <= 3600 {
		outputOptions["duration"] = duration
	}
	// The public model alias recorded at generation time. Aliases are public by
	// design (the catalog serves the same names), so only secrets are redacted
	// here; upstream model IDs never pass the secret list unredacted.
	if label, ok := value["modelLabel"].(string); ok {
		if label = strings.TrimSpace(label); label != "" {
			output["modelLabel"] = truncate(ai.RedactSecrets(label, secrets), 80)
		}
	}
	for _, field := range []string{"imageWidth", "imageHeight", "audioDuration"} {
		if number, ok := numberField(value[field]); ok && number > 0 && number <= 1_000_000 {
			output[field] = number
		}
	}
	for _, field := range []string{"lyrics", "lrc"} {
		if input, ok := value[field].(string); ok {
			output[field] = text(input, 64000)
		}
	}
	if source, ok := value["lrcSource"].(string); ok && (source == "estimated" || source == "audio" || source == "manual") {
		output["lrcSource"] = source
	}
	if song, ok := value["song"].(map[string]any); ok {
		title, _ := song["title"].(string)
		style, _ := song["style"].(string)
		output["song"] = map[string]any{
			"title": text(title, 200), "style": text(style, 2000),
			"instrumental": song["instrumental"] == true, "sections": []any{},
		}
	}
	return output
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func parameter(r *http.Request, name string, fallback, min, max int64) (int64, error) {
	values, exists := r.URL.Query()[name]
	if !exists || len(values) == 0 {
		return fallback, nil
	}
	if len(values) != 1 || !regexp.MustCompile(`^\d{1,16}$`).MatchString(values[0]) {
		return 0, errorf(400, "GALLERY_PAGE", "分页参数无效。")
	}
	value, err := strconv.ParseInt(values[0], 10, 64)
	if err != nil || value < min || value > max {
		return 0, errorf(400, "GALLERY_PAGE", "分页参数无效。")
	}
	return value, nil
}

type candidate struct {
	record store.RecordWithBody
	value  map[string]any
	refs   []reference
}

func unavailable() *media.Error {
	return &media.Error{Status: 503, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}
}

func notFound() *media.Error {
	return errorf(404, "MEDIA_NOT_FOUND", "作品不存在或已被隐藏。")
}

func galleryKey(id string) (string, bool) {
	if !strings.HasPrefix(id, "gallery_") {
		return "", false
	}
	key := strings.TrimPrefix(id, "gallery_")
	if !recordKeyRE.MatchString(key) {
		return "", false
	}
	return key, true
}

func heatScore(stats store.GalleryStats) int64 {
	return stats.Views*heatViewWeight + stats.Downloads*heatDownloadWeight + stats.Favorites*heatFavoriteWeight
}

func candidateKeys(items []candidate) []string {
	keys := make([]string, len(items))
	for index, item := range items {
		keys[index] = item.record.Key
	}
	return keys
}

func createdValue(value map[string]any) float64 {
	created, _ := value["createdAt"].(float64)
	return created
}

func dedupeKeys(keys []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	return out
}

// viewerFingerprint identifies one visitor without storing a raw IP address.
func (m *Manager) viewerFingerprint(r *http.Request, userID string) string {
	if userID != "" {
		return "user:" + userID
	}
	ip := r.RemoteAddr
	if value, err := httpx.ClientIP(r, m.Settings); err == nil {
		ip = value
	}
	return "anon:" + httpx.Hash(ip+"|"+r.UserAgent())
}

// originFingerprint is kept separate from the viewer identity so reports from
// signed-in users still carry a coarse origin signal for moderation.
func (m *Manager) originFingerprint(r *http.Request) string {
	ip := r.RemoteAddr
	if value, err := httpx.ClientIP(r, m.Settings); err == nil {
		ip = value
	}
	return httpx.Hash(ip + "|" + r.UserAgent())
}

// publicRecord resolves one gallery id and enforces every public-work rule.
func (m *Manager) publicRecord(ctx context.Context, key string) (*store.RecordWithBody, map[string]any, error) {
	record, err := m.DB.RecordByKey(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil, notFound()
	}
	if err != nil {
		return nil, nil, unavailable()
	}
	if record.Store != "assets" || record.Visibility == "private" || record.Body == "" || len(record.Body) > maxRecordChars {
		return nil, nil, notFound()
	}
	hidden, err := m.DB.IsGalleryHidden(ctx, key)
	if err != nil {
		return nil, nil, unavailable()
	}
	if hidden {
		return nil, nil, notFound()
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil || !completed(value) {
		return nil, nil, notFound()
	}
	return record, value, nil
}

// scanCandidates walks completed, visible records until target candidates have
// been collected. The scan is keyset-based, so it never uses OFFSET.
func (m *Manager) scanCandidates(ctx context.Context, target int, origin string, hidden map[string]bool) ([]candidate, error) {
	if target < 1 {
		target = 1
	}
	// Grow with the rows actually read rather than trusting the requested
	// target for the initial allocation.
	capacity := target
	if capacity > 256 {
		capacity = 256
	}
	out := make([]candidate, 0, capacity)
	cursor := ""
	for len(out) < target {
		page, err := m.DB.GalleryBatch(ctx, cursor, batchSize)
		if err != nil {
			return nil, unavailable()
		}
		for _, record := range page {
			if !recordKeyRE.MatchString(record.Key) || record.Body == "" || len(record.Body) > maxRecordChars || hidden[record.Key] {
				continue
			}
			var value map[string]any
			if err := json.Unmarshal([]byte(record.Body), &value); err != nil || !completed(value) {
				continue
			}
			out = append(out, candidate{record: record, value: value, refs: referenceList(value, origin)})
			if len(out) >= target {
				break
			}
		}
		if len(page) < batchSize {
			break
		}
		cursor = page[len(page)-1].Key
	}
	return out, nil
}

// scanNewCandidates walks the gallery newest-first by the stored creation
// time, skipping hidden and incomplete records until target candidates have
// been collected. The cursor is (created_at, key), so works published while a
// visitor pages never shift the rows they have already seen.
func (m *Manager) scanNewCandidates(ctx context.Context, target int, origin string, hidden map[string]bool) ([]candidate, error) {
	if target < 1 {
		target = 1
	}
	capacity := target
	if capacity > 256 {
		capacity = 256
	}
	out := make([]candidate, 0, capacity)
	cursorCreatedAt := int64(math.MaxInt64)
	cursorKey := "~"
	for len(out) < target {
		page, err := m.DB.GalleryNewBatch(ctx, cursorCreatedAt, cursorKey, batchSize)
		if err != nil {
			return nil, unavailable()
		}
		for _, record := range page {
			if !recordKeyRE.MatchString(record.Key) || record.Body == "" || len(record.Body) > maxRecordChars || hidden[record.Key] {
				continue
			}
			var value map[string]any
			if err := json.Unmarshal([]byte(record.Body), &value); err != nil || !completed(value) {
				continue
			}
			out = append(out, candidate{record: record, value: value, refs: referenceList(value, origin)})
			if len(out) >= target {
				break
			}
		}
		if len(page) < batchSize {
			break
		}
		last := page[len(page)-1]
		cursorCreatedAt, cursorKey = last.CreatedAt, last.Key
	}
	return out, nil
}

// projectCandidates performs the page-local media lookups and returns the
// public shape without any private provider metadata.
func (m *Manager) projectCandidates(ctx context.Context, items []candidate, viewer string, stats map[string]store.GalleryStats, favorites map[string]bool, secrets []string) ([]any, error) {
	userIDs := make([]string, 0, len(items))
	for _, item := range items {
		userIDs = append(userIDs, item.record.UserID)
	}
	authors, err := m.DB.GalleryAuthors(ctx, userIDs)
	if err != nil {
		return nil, unavailable()
	}
	idSet := map[string]bool{}
	for _, item := range items {
		for _, ref := range item.refs {
			if ref.inline == nil {
				idSet[ref.id] = true
			}
		}
	}
	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	mediaRows, err := m.DB.MediaByIDs(ctx, ids)
	if err != nil {
		return nil, unavailable()
	}
	assets := make([]any, 0, len(items))
	for _, item := range items {
		kind, _ := item.value["kind"].(string)
		asset := projection(item.record, item.value, secrets)
		for _, ref := range item.refs {
			if ref.inline != nil {
				asset[ref.field] = fmt.Sprintf("/api/gallery/media/%s.%s.%s", item.record.Key, ref.field, ref.id)
				if ref.field == "coverUrl" {
					asset["coverStatus"] = "completed"
				}
				continue
			}
			row := mediaRows[ref.id]
			if row == nil || row.Owner != "user:"+item.record.UserID || !accepts(kind, ref.field, row.Mime) {
				continue
			}
			asset[ref.field] = fmt.Sprintf("/api/gallery/media/%s.%s.%s", item.record.Key, ref.field, ref.id)
			if strings.HasPrefix(row.Mime, "image/") && (ref.field == "url" || ref.field == "coverUrl") {
				thumbnailField := "thumbnail"
				if ref.field == "coverUrl" {
					thumbnailField = "coverThumbnail"
				}
				asset[thumbnailField] = fmt.Sprintf("%s?w=%d", asset[ref.field], media.ThumbnailWidth)
			}
			if ref.field == "coverUrl" {
				asset["coverStatus"] = "completed"
			}
		}
		author := authors[item.record.UserID]
		handle, err := m.authorHandle(ctx, item.record.UserID, author.Handle)
		if err != nil {
			return nil, unavailable()
		}
		asset["author"] = publicAuthor(item.record.UserID, author.Name, author.Avatar, handle)
		metric := stats[item.record.Key]
		asset["views"] = metric.Views
		asset["downloads"] = metric.Downloads
		asset["favoriteCount"] = metric.Favorites
		asset["heat"] = heatScore(metric)
		if viewer != "" {
			asset["favorite"] = favorites[item.record.Key]
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

// List returns completed public assets. `viewer` is the signed-in portal user
// (empty for guests) and only affects favorite flags and the favorites view.
func (m *Manager) List(ctx context.Context, r *http.Request, viewer string) (map[string]any, error) {
	if err := m.Media.AssertMediaOrigin(r, false); err != nil {
		return nil, err
	}
	offset, err := parameter(r, "offset", 0, 0, maxListOffset)
	if err != nil {
		return nil, err
	}
	limit, err := parameter(r, "limit", batchSize, 1, 100)
	if err != nil {
		return nil, err
	}
	sortMode := r.URL.Query().Get("sort")
	if sortMode != "" && sortMode != "new" && sortMode != "hot" {
		return nil, errorf(400, "GALLERY_SORT", "作品排序参数无效。")
	}
	favoritesOnly := r.URL.Query().Get("favorites") == "1"
	if favoritesOnly && viewer == "" {
		return nil, errorf(401, "GALLERY_LOGIN", "登录后可以查看收藏的作品。")
	}
	hidden, err := m.DB.GalleryHiddenKeys(ctx)
	if err != nil {
		return nil, unavailable()
	}
	origin := sourceOrigin(r, m.Settings)
	secrets := m.AI.PrivateValues(nil)
	if favoritesOnly {
		return m.listFavorites(ctx, viewer, viewer, r.URL.Query().Get("folder"), offset, limit, origin, secrets, hidden, true)
	}

	target := int(offset + limit + 1)
	var items []candidate
	if sortMode == "hot" {
		target = heatScanLimit
		items, err = m.scanCandidates(ctx, target, origin, hidden)
	} else {
		items, err = m.scanNewCandidates(ctx, target, origin, hidden)
	}
	if err != nil {
		return nil, err
	}
	var stats map[string]store.GalleryStats
	if sortMode == "hot" {
		stats, err = m.DB.GalleryStatsFor(ctx, candidateKeys(items))
		if err != nil {
			return nil, unavailable()
		}
		sort.SliceStable(items, func(i, j int) bool {
			left, right := heatScore(stats[items[i].record.Key]), heatScore(stats[items[j].record.Key])
			if left != right {
				return left > right
			}
			createdLeft, createdRight := createdValue(items[i].value), createdValue(items[j].value)
			if createdLeft != createdRight {
				return createdLeft > createdRight
			}
			return items[i].record.Key < items[j].record.Key
		})
	}
	start := int(offset)
	if start > len(items) {
		start = len(items)
	}
	end := start + int(limit)
	if end > len(items) {
		end = len(items)
	}
	page := items[start:end]
	if stats == nil {
		stats, err = m.DB.GalleryStatsFor(ctx, candidateKeys(page))
		if err != nil {
			return nil, unavailable()
		}
	}
	favorites, err := m.DB.GalleryFavoriteSet(ctx, viewer, candidateKeys(page))
	if err != nil {
		return nil, unavailable()
	}
	assets, err := m.projectCandidates(ctx, page, viewer, stats, favorites, secrets)
	if err != nil {
		return nil, err
	}
	var nextOffset any
	// When the hot scan hit its safety limit the result is a snapshot, not a
	// promise that more works exist, so stop pagination instead of looping.
	if len(items) > end {
		nextOffset = offset + limit
	}
	var favoriteTotal int64
	if viewer != "" {
		favoriteTotal, err = m.DB.GalleryFavoriteTotal(ctx, viewer)
		if err != nil {
			return nil, unavailable()
		}
	}
	return map[string]any{"records": assets, "nextOffset": nextOffset, "favoriteTotal": favoriteTotal}, nil
}

// listFavorites serves the account-backed favorites view in favorite order.
// owner selects whose favorites are listed; viewer decides the favorite flags.
// Private works stay visible only in the owner's own library view.
func (m *Manager) listFavorites(ctx context.Context, owner, viewer, folder string, offset, limit int64, origin string, secrets []string, hidden map[string]bool, includePrivate bool) (map[string]any, error) {
	if folder != "" && !folderIDPattern.MatchString(folder) {
		return nil, errorf(400, "GALLERY_FOLDER", "收藏分类无效。")
	}
	var keys []string
	var total int64
	var err error
	if includePrivate {
		keys, total, err = m.DB.GalleryFavoriteKeysIn(ctx, owner, folder, int(limit), int(offset))
	} else {
		keys, total, err = m.DB.GalleryFavoriteKeysPublicIn(ctx, owner, folder, int(limit), int(offset))
	}
	if err != nil {
		return nil, unavailable()
	}
	records, err := m.DB.RecordsByKeys(ctx, keys)
	if err != nil {
		return nil, unavailable()
	}
	items := make([]candidate, 0, len(keys))
	for _, key := range keys {
		record, ok := records[key]
		if !ok || hidden[key] || (!includePrivate && record.Visibility == "private") || !recordKeyRE.MatchString(record.Key) || record.Body == "" || len(record.Body) > maxRecordChars {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(record.Body), &value); err != nil || !completed(value) {
			continue
		}
		items = append(items, candidate{record: record, value: value, refs: referenceList(value, origin)})
	}
	stats, err := m.DB.GalleryStatsFor(ctx, candidateKeys(items))
	if err != nil {
		return nil, unavailable()
	}
	favorites := map[string]bool{}
	if viewer == owner {
		for _, item := range items {
			favorites[item.record.Key] = true
		}
	} else if viewer != "" {
		favorites, err = m.DB.GalleryFavoriteSet(ctx, viewer, candidateKeys(items))
		if err != nil {
			return nil, unavailable()
		}
	}
	assets, err := m.projectCandidates(ctx, items, viewer, stats, favorites, secrets)
	if err != nil {
		return nil, err
	}
	var nextOffset any
	if offset+limit < total {
		nextOffset = offset + limit
	}
	return map[string]any{"records": assets, "nextOffset": nextOffset, "favoriteTotal": total}, nil
}

// ListByOwner returns one page of an account's public, completed works. The
// caller has already decided the visitor may see them.
func (m *Manager) ListByOwner(ctx context.Context, r *http.Request, owner, viewer string) (map[string]any, error) {
	if err := m.Media.AssertMediaOrigin(r, false); err != nil {
		return nil, err
	}
	offset, err := parameter(r, "offset", 0, 0, maxListOffset)
	if err != nil {
		return nil, err
	}
	limit, err := parameter(r, "limit", batchSize, 1, 100)
	if err != nil {
		return nil, err
	}
	keys, err := m.DB.PublicAssetKeys(ctx, owner, int(limit)+1, int(offset))
	if err != nil {
		return nil, unavailable()
	}
	hidden, err := m.DB.GalleryHiddenKeys(ctx)
	if err != nil {
		return nil, unavailable()
	}
	records, err := m.DB.RecordsByKeys(ctx, keys)
	if err != nil {
		return nil, unavailable()
	}
	origin := sourceOrigin(r, m.Settings)
	items := make([]candidate, 0, len(keys))
	for _, key := range keys {
		record, ok := records[key]
		if !ok || hidden[key] || record.Visibility == "private" || !recordKeyRE.MatchString(record.Key) || record.Body == "" || len(record.Body) > maxRecordChars {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(record.Body), &value); err != nil || !completed(value) {
			continue
		}
		items = append(items, candidate{record: record, value: value, refs: referenceList(value, origin)})
	}
	return m.pageOf(ctx, r, items, viewer, offset, limit, int64(len(keys)) > limit)
}

// ListFavoritesOf returns one account's favorites for a visitor who is allowed
// to see them. Favorites of works that are no longer public are left out.
func (m *Manager) ListFavoritesOf(ctx context.Context, r *http.Request, owner, viewer string) (map[string]any, error) {
	if err := m.Media.AssertMediaOrigin(r, false); err != nil {
		return nil, err
	}
	offset, err := parameter(r, "offset", 0, 0, maxListOffset)
	if err != nil {
		return nil, err
	}
	limit, err := parameter(r, "limit", batchSize, 1, 100)
	if err != nil {
		return nil, err
	}
	hidden, err := m.DB.GalleryHiddenKeys(ctx)
	if err != nil {
		return nil, unavailable()
	}
	origin := sourceOrigin(r, m.Settings)
	secrets := m.AI.PrivateValues(nil)
	return m.listFavorites(ctx, owner, viewer, "", offset, limit, origin, secrets, hidden, false)
}

func (m *Manager) pageOf(ctx context.Context, r *http.Request, items []candidate, viewer string, offset, limit int64, more bool) (map[string]any, error) {
	stats, err := m.DB.GalleryStatsFor(ctx, candidateKeys(items))
	if err != nil {
		return nil, unavailable()
	}
	favorites, err := m.DB.GalleryFavoriteSet(ctx, viewer, candidateKeys(items))
	if err != nil {
		return nil, unavailable()
	}
	assets, err := m.projectCandidates(ctx, items, viewer, stats, favorites, m.AI.PrivateValues(nil))
	if err != nil {
		return nil, err
	}
	var nextOffset any
	if more {
		nextOffset = offset + limit
	}
	return map[string]any{"records": assets, "nextOffset": nextOffset}, nil
}

// SetFavorite adds or removes one account-backed favorite. Public visibility
// is re-checked before every write.
func (m *Manager) SetFavorite(ctx context.Context, viewer, id string, add bool) (map[string]any, error) {
	if viewer == "" {
		return nil, errorf(401, "GALLERY_LOGIN", "请先登录后再收藏作品。")
	}
	key, ok := galleryKey(id)
	if !ok {
		return nil, notFound()
	}
	// Adding requires the work to be public right now. Removal does not: a work
	// hidden or deleted after it was favorited must still be un-favoritable, or
	// the stale row would pin the 收藏 badge forever.
	if add {
		if _, _, err := m.publicRecord(ctx, key); err != nil {
			return nil, err
		}
	}
	var err error
	if add {
		_, err = m.DB.AddGalleryFavorite(ctx, viewer, key)
	} else {
		_, err = m.DB.RemoveGalleryFavorite(ctx, viewer, key)
	}
	if err != nil {
		return nil, unavailable()
	}
	stats, err := m.DB.GalleryStatsFor(ctx, []string{key})
	if err != nil {
		return nil, unavailable()
	}
	total, err := m.DB.GalleryFavoriteTotal(ctx, viewer)
	if err != nil {
		return nil, unavailable()
	}
	metric := stats[key]
	// Keep the response the same metrics snapshot the view/download endpoints
	// return; the portal validates all four counters before applying it.
	return map[string]any{
		"favorite": add,
		"views":    metric.Views, "downloads": metric.Downloads,
		"favoriteCount": metric.Favorites, "favoriteTotal": total,
		"heat": heatScore(metric),
	}, nil
}

// recordMetric counts a view or download at most a few times per visitor so a
// refresh loop cannot inflate heat.
func (m *Manager) recordMetric(ctx context.Context, r *http.Request, id, viewer, action string) (map[string]any, error) {
	key, ok := galleryKey(id)
	if !ok {
		return nil, notFound()
	}
	if _, _, err := m.publicRecord(ctx, key); err != nil {
		return nil, err
	}
	now := time.Now()
	fingerprint := m.viewerFingerprint(r, viewer)
	var allowed bool
	var err error
	if action == "download" {
		bucket := now.UnixMilli() / (24 * 3600 * 1000)
		allowed, err = m.DB.Reserve(ctx,
			fmt.Sprintf("gd:%s:%d", httpx.Hash(key+":"+fingerprint), bucket), 3, now.Add(24*time.Hour).UnixMilli())
	} else {
		bucket := now.UnixMilli() / (6 * 3600 * 1000)
		allowed, err = m.DB.Reserve(ctx,
			fmt.Sprintf("gv:%s:%d", httpx.Hash(key+":"+fingerprint), bucket), 1, now.Add(6*time.Hour).UnixMilli())
	}
	if err != nil {
		return nil, unavailable()
	}
	if allowed {
		if action == "download" {
			err = m.DB.IncrementGalleryDownload(ctx, key)
		} else {
			err = m.DB.IncrementGalleryView(ctx, key)
		}
		if err != nil {
			return nil, unavailable()
		}
	}
	stats, err := m.DB.GalleryStatsFor(ctx, []string{key})
	if err != nil {
		return nil, unavailable()
	}
	metric := stats[key]
	return map[string]any{
		"views": metric.Views, "downloads": metric.Downloads,
		"favoriteCount": metric.Favorites, "heat": heatScore(metric),
	}, nil
}

func (m *Manager) RecordView(ctx context.Context, r *http.Request, id, viewer string) (map[string]any, error) {
	return m.recordMetric(ctx, r, id, viewer, "view")
}

func (m *Manager) RecordDownload(ctx context.Context, r *http.Request, id, viewer string) (map[string]any, error) {
	return m.recordMetric(ctx, r, id, viewer, "download")
}

var reportReasons = map[string]bool{
	"inappropriate": true, "copyright": true, "spam": true, "other": true,
}

// Report stores one moderation report. Signed-in users are attributed by
// account; guests are deduplicated and rate-limited by a hashed fingerprint.
func (m *Manager) Report(ctx context.Context, r *http.Request, user *store.SessionUser, id, reason, detail string) error {
	key, ok := galleryKey(id)
	if !ok {
		return notFound()
	}
	record, _, err := m.publicRecord(ctx, key)
	if err != nil {
		return err
	}
	reason = strings.TrimSpace(reason)
	if !reportReasons[reason] {
		return errorf(400, "GALLERY_REPORT_REASON", "请选择举报原因。")
	}
	detail = truncate(strings.TrimSpace(detail), 500)
	if reason == "other" && detail == "" {
		return errorf(400, "GALLERY_REPORT_REASON", "请补充说明具体问题。")
	}
	reporterID := ""
	if user != nil {
		if record.UserID == user.ID {
			return errorf(400, "GALLERY_SELF_REPORT", "不能举报自己的作品。")
		}
		reporterID = user.ID
	}
	fingerprint := m.originFingerprint(r)
	now := time.Now()
	identity := reporterID
	if identity == "" {
		identity = fingerprint
	}
	limit := 3
	if user != nil {
		limit = 10
	}
	allowed, err := m.DB.Reserve(ctx,
		fmt.Sprintf("gr:%s:%d", httpx.Hash(identity), now.UnixMilli()/(24*3600*1000)),
		limit, now.Add(24*time.Hour).UnixMilli())
	if err != nil {
		return unavailable()
	}
	if !allowed {
		return errorf(429, "GALLERY_REPORT_LIMIT", "举报过于频繁，请明天再试。")
	}
	exists, err := m.DB.GalleryOpenReportExists(ctx, key, reporterID, fingerprint, now.Add(-24*time.Hour).UnixMilli())
	if err != nil {
		return unavailable()
	}
	if exists {
		return nil
	}
	return m.DB.InsertGalleryReport(ctx, store.GalleryReportRow{
		ID: secure.ID(), RecordKey: key, ReporterID: reporterID,
		ReporterFingerprint: fingerprint, Reason: reason, Detail: detail,
		Status: "open", CreatedAt: now.UnixMilli(),
	})
}

// ---- public authors and comments ----

// publicAvatarThemes mirrors the preset avatars in lib/profile.ts.
var publicAvatarThemes = map[string]bool{
	"ocean": true, "sunset": true, "mint": true,
	"violet": true, "amber": true, "slate": true,
}

// avatarIDPattern is the uuid stored after "upload:" for a cropped avatar.
var avatarIDPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

// publicAvatar keeps a preset theme as-is. An uploaded portrait is rewritten
// to the public gallery media route, because /api/media only serves the owner.
func publicAvatar(userID, avatar string) string {
	if publicAvatarThemes[avatar] {
		return avatar
	}
	const prefix = "upload:"
	if !strings.HasPrefix(avatar, prefix) {
		return ""
	}
	id := strings.ToLower(strings.TrimPrefix(avatar, prefix))
	if !avatarIDPattern.MatchString(id) {
		return ""
	}
	return "upload:gallery." + userID + "." + id
}

// PublicAuthorName is the name shown on a work, a comment and a profile.
// An account that set neither a nickname nor a usable mailbox reads as a
// generic member rather than a blank.
func PublicAuthorName(name string) string {
	clean := strings.Map(func(value rune) rune {
		if unicode.IsControl(value) {
			return -1
		}
		return value
	}, strings.TrimSpace(name))
	if clean == "" {
		clean = "Olai 用户"
	}
	return truncate(clean, 40)
}

// PublicAvatar is the avatar value the portal can render for any visitor.
func PublicAvatar(userID, avatar string) string {
	return publicAvatar(userID, avatar)
}

func publicAuthor(userID, name, avatar, handle string) map[string]any {
	out := map[string]any{"name": PublicAuthorName(name), "avatar": publicAvatar(userID, avatar)}
	if handle != "" {
		out["id"] = handle
	}
	return out
}

// authorHandle returns the saved profile handle, creating the default profile
// when the account has never opened its privacy settings. Without that row the
// avatar and name have nowhere to link.
func (m *Manager) authorHandle(ctx context.Context, userID, known string) (string, error) {
	if known != "" || userID == "" {
		return known, nil
	}
	clean := strings.Map(func(value rune) rune {
		if value >= '0' && value <= '9' || value >= 'a' && value <= 'z' {
			return value
		}
		return -1
	}, strings.ToLower(userID))
	if len(clean) > 12 {
		clean = clean[:12]
	}
	if clean == "" {
		clean = "user"
	}
	return m.DB.EnsureProfile(ctx, userID, "u-"+clean)
}

func commentPayload(comment store.GalleryComment) map[string]any {
	return map[string]any{
		"id": comment.ID, "body": comment.Body, "createdAt": comment.CreatedAt,
		"author": publicAuthor(comment.UserID, comment.AuthorName, comment.AuthorAvatar, comment.AuthorHandle),
	}
}

// ListComments returns a newest-first page of comments for one public work.
func (m *Manager) ListComments(ctx context.Context, r *http.Request, id string) (map[string]any, error) {
	key, ok := galleryKey(id)
	if !ok {
		return nil, notFound()
	}
	if _, _, err := m.publicRecord(ctx, key); err != nil {
		return nil, err
	}
	offset, err := parameter(r, "offset", 0, 0, 1<<20)
	if err != nil {
		return nil, err
	}
	limit, err := parameter(r, "limit", 20, 1, 50)
	if err != nil {
		return nil, err
	}
	comments, total, err := m.DB.GalleryComments(ctx, key, int(limit), int(offset))
	if err != nil {
		return nil, unavailable()
	}
	payload := make([]any, 0, len(comments))
	for i := range comments {
		if comments[i].AuthorHandle != "" || comments[i].UserID == "" {
			continue
		}
		handle, err := m.authorHandle(ctx, comments[i].UserID, "")
		if err != nil {
			return nil, unavailable()
		}
		comments[i].AuthorHandle = handle
	}
	for _, comment := range comments {
		payload = append(payload, commentPayload(comment))
	}
	var nextOffset any
	if offset+int64(len(comments)) < total {
		nextOffset = offset + int64(len(comments))
	}
	return map[string]any{"comments": payload, "total": total, "nextOffset": nextOffset}, nil
}

// AddComment stores one signed-in account's comment. The work must still be
// public, and each account is rate limited per hour.
func (m *Manager) AddComment(ctx context.Context, r *http.Request, user *store.SessionUser, id, body string) (map[string]any, error) {
	if user == nil {
		return nil, errorf(401, "GALLERY_LOGIN", "请先登录后再评论。")
	}
	key, ok := galleryKey(id)
	if !ok {
		return nil, notFound()
	}
	if _, _, err := m.publicRecord(ctx, key); err != nil {
		return nil, err
	}
	body = strings.TrimSpace(strings.Map(func(value rune) rune {
		if value == '\n' || value == '\t' {
			return value
		}
		if unicode.IsControl(value) {
			return -1
		}
		return value
	}, body))
	if body == "" {
		return nil, errorf(400, "GALLERY_COMMENT_EMPTY", "评论内容不能为空。")
	}
	if utf8.RuneCountInString(body) > 500 {
		return nil, errorf(400, "GALLERY_COMMENT_LONG", "评论最多 500 个字符。")
	}
	now := time.Now()
	allowed, err := m.DB.Reserve(ctx,
		fmt.Sprintf("gcm:%s:%d", httpx.Hash(user.ID), now.UnixMilli()/(60*60*1000)),
		30, now.Add(time.Hour).UnixMilli())
	if err != nil {
		return nil, unavailable()
	}
	if !allowed {
		return nil, errorf(429, "GALLERY_COMMENT_LIMIT", "评论过于频繁，请稍后再试。")
	}
	commentID := secure.ID()
	if err := m.DB.AddGalleryComment(ctx, commentID, key, user.ID, body, now.UnixMilli()); err != nil {
		return nil, unavailable()
	}
	total, err := m.DB.GalleryCommentTotal(ctx, key)
	if err != nil {
		return nil, unavailable()
	}
	name, avatar := "", ""
	if user.Name != nil {
		name = *user.Name
	}
	name = store.DisplayName(name, user.Email)
	if user.Avatar != nil {
		avatar = *user.Avatar
	}
	handle, err := m.authorHandle(ctx, user.ID, "")
	if err != nil {
		return nil, unavailable()
	}
	return map[string]any{
		"comment": map[string]any{
			"id": commentID, "body": body, "createdAt": now.UnixMilli(),
			"author": publicAuthor(user.ID, name, avatar, handle),
		},
		"total": total,
	}, nil
}

// ImportFavorites adopts the browser-local bookmarks that predate account
// favorites. Only currently public works are accepted.
func (m *Manager) ImportFavorites(ctx context.Context, viewer string, ids []string) (int, error) {
	if viewer == "" {
		return 0, errorf(401, "GALLERY_LOGIN", "请先登录后再同步收藏。")
	}
	if len(ids) == 0 {
		return 0, nil
	}
	if len(ids) > 500 {
		ids = ids[:500]
	}
	keys := make([]string, 0, len(ids))
	for _, id := range ids {
		if key, ok := galleryKey(id); ok {
			keys = append(keys, key)
		}
	}
	keys = dedupeKeys(keys)
	if len(keys) == 0 {
		return 0, nil
	}
	records, err := m.DB.RecordsByKeys(ctx, keys)
	if err != nil {
		return 0, unavailable()
	}
	hidden, err := m.DB.GalleryHiddenKeys(ctx)
	if err != nil {
		return 0, unavailable()
	}
	imported := 0
	for _, key := range keys {
		record, ok := records[key]
		if !ok || hidden[key] || record.Store != "assets" || record.Visibility == "private" || record.Body == "" || len(record.Body) > maxRecordChars {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(record.Body), &value); err != nil || !completed(value) {
			continue
		}
		added, err := m.DB.AddGalleryFavorite(ctx, viewer, key)
		if err != nil {
			return imported, unavailable()
		}
		if added {
			imported++
		}
	}
	return imported, nil
}

// publishedAvatarID splits "<user id>.<media uuid>" from the public avatar route.
var publishedAvatarID = regexp.MustCompile(`^([A-Za-z0-9_-]{1,100})\.([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$`)

// ServeAvatar streams the portrait an account chose, so visitors see the same
// picture the owner sees. It only serves a media row the account currently
// points at, and only one that was stored as an avatar image.
func (m *Manager) ServeAvatar(ctx context.Context, w http.ResponseWriter, r *http.Request, identity media.Identity) error {
	if err := m.Media.AssertOrigin(r, identity.Origin, false); err != nil {
		return err
	}
	if !m.Media.Enabled() {
		return &media.Error{Status: 503, Code: "MEDIA_UNAVAILABLE", Message: "私有媒体服务暂不可用。"}
	}
	raw := r.PathValue("id")
	dot := strings.LastIndex(raw, ".")
	if dot > 0 {
		raw = raw[:dot] + strings.ToLower(raw[dot:])
	}
	match := publishedAvatarID.FindStringSubmatch(raw)
	if match == nil {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	userID, mediaID := match[1], match[2]
	owner, err := m.DB.UserByID(ctx, userID)
	if errors.Is(err, store.ErrNotFound) {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	if err != nil {
		return &media.Error{Status: 503, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}
	}
	if owner.Avatar == nil || *owner.Avatar != "upload:"+mediaID {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	row, err := m.DB.MediaByID(ctx, mediaID)
	if errors.Is(err, store.ErrNotFound) {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	if err != nil {
		return &media.Error{Status: 503, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}
	}
	if row.Owner != "user:"+userID || row.AttachmentID != "avatar" || row.Size > 2*1024*1024 || !strings.HasPrefix(row.Mime, "image/") {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	return m.Media.ServeMedia(ctx, w, r, identity, row)
}

// ServePublished streams one exact whitelisted field of a completed record.
func (m *Manager) ServePublished(ctx context.Context, w http.ResponseWriter, r *http.Request, identity media.Identity) error {
	if err := m.Media.AssertOrigin(r, identity.Origin, false); err != nil {
		return err
	}
	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(r.URL.Path, "/api/gallery/media/")
	}
	match := publicRE.FindStringSubmatch(id)
	if match == nil {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	key, field, refID := match[1], match[2], match[3]
	record, err := m.DB.RecordByKey(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	if err != nil {
		return &media.Error{Status: 503, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}
	}
	if record.Store != "assets" || record.Visibility == "private" || record.Body == "" || len(record.Body) > maxRecordChars {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	hidden, err := m.DB.IsGalleryHidden(ctx, key)
	if err != nil {
		return &media.Error{Status: 503, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}
	}
	if hidden {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(record.Body), &value); err != nil || !completed(value) {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	kind, _ := value["kind"].(string)
	var chosen *reference
	for _, ref := range referenceList(value, sourceOrigin(r, m.Settings)) {
		if ref.field == field && ref.id == refID {
			copied := ref
			chosen = &copied
			break
		}
	}
	if chosen == nil {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	if chosen.inline != nil {
		data, err := base64.StdEncoding.DecodeString(chosen.inline.payload)
		if err != nil || len(data) == 0 {
			return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
		}
		return m.Media.ServeInline(ctx, w, r, identity, chosen.id[len("inline-"):], chosen.inline.mime, data)
	}
	if !m.Media.Enabled() {
		return &media.Error{Status: 503, Code: "MEDIA_UNAVAILABLE", Message: "私有媒体服务暂不可用。"}
	}
	row, err := m.DB.MediaByID(ctx, chosen.id)
	if errors.Is(err, store.ErrNotFound) {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	if err != nil {
		return &media.Error{Status: 503, Code: "GALLERY_UNAVAILABLE", Message: "公开作品暂不可用。"}
	}
	if row.Owner != "user:"+record.UserID || !accepts(kind, field, row.Mime) {
		return errorf(404, "MEDIA_NOT_FOUND", "媒体不存在或无权访问。")
	}
	return m.Media.ServeMedia(ctx, w, r, identity, row)
}
