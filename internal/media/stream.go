package media

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"olai/internal/httpx"
	"olai/internal/oss"
	"olai/internal/store"
)

const ThumbnailWidth = 800

type cacheEntry struct {
	data    []byte
	expires time.Time
}

type byteCache struct {
	mu      sync.Mutex
	entries map[string]*cacheEntry
	order   []string
	total   int
}

var cache = &byteCache{entries: map[string]*cacheEntry{}}

const (
	cacheMaxBytes   = 256 * 1024 * 1024
	cacheMaxCapture = 64 * 1024 * 1024
	cacheTTL        = 15 * time.Minute
)

func (c *byteCache) get(key string) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return nil
	}
	if time.Now().After(entry.expires) {
		c.removeLocked(key)
		return nil
	}
	c.touchLocked(key)
	return entry.data
}

func (c *byteCache) put(key string, data []byte) {
	if len(data) == 0 || len(data) > cacheMaxCapture {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.removeLocked(key)
	for c.total+len(data) > cacheMaxBytes && len(c.order) > 0 {
		c.removeLocked(c.order[0])
	}
	c.entries[key] = &cacheEntry{data: data, expires: time.Now().Add(cacheTTL)}
	c.order = append(c.order, key)
	c.total += len(data)
}

func (c *byteCache) removeLocked(key string) {
	entry, ok := c.entries[key]
	if !ok {
		return
	}
	delete(c.entries, key)
	c.total -= len(entry.data)
	for i, item := range c.order {
		if item == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
}

func (c *byteCache) touchLocked(key string) {
	for i, item := range c.order {
		if item == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			c.order = append(c.order, key)
			return
		}
	}
}

func MediaHeaders() http.Header {
	headers := http.Header{}
	headers.Set("Cache-Control", "private, no-store")
	headers.Set("Cross-Origin-Resource-Policy", "same-origin")
	headers.Set("X-Content-Type-Options", "nosniff")
	headers.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	headers.Set("Referrer-Policy", "no-referrer")
	headers.Set("X-Frame-Options", "DENY")
	headers.Set("Vary", "Cookie, Origin, Sec-Fetch-Site")
	return headers
}

func copyHeaders(w http.ResponseWriter, headers http.Header) {
	for key, values := range headers {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
}

func WriteFailure(w http.ResponseWriter, err error, head bool) {
	safe, ok := err.(*Error)
	if !ok {
		safe = unavailable()
	}
	copyHeaders(w, MediaHeaders())
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if safe.Status == 429 {
		w.Header().Set("Retry-After", strconv.Itoa(safe.RetryAfter))
	}
	w.WriteHeader(safe.Status)
	if !head {
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": safe.Code, "message": safe.Message}})
	}
}

type byteRange struct{ start, end int64 }

func parseRange(value string, size int64) (*byteRange, error) {
	if value == "" {
		return nil, nil
	}
	match := regexp.MustCompile(`^bytes=(\d*)-(\d*)$`).FindStringSubmatch(value)
	invalid := &Error{Status: 416, Code: "MEDIA_RANGE", Message: "媒体范围无效。"}
	if match == nil || (match[1] == "" && match[2] == "") {
		return nil, invalid
	}
	var start, end int64
	if match[1] == "" {
		suffix, err := strconv.ParseInt(match[2], 10, 64)
		if err != nil || suffix < 1 || suffix > size {
			return nil, invalid
		}
		start = size - suffix
		end = size - 1
	} else {
		parsed, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil {
			return nil, invalid
		}
		start = parsed
		if match[2] != "" {
			parsed, err = strconv.ParseInt(match[2], 10, 64)
			if err != nil {
				return nil, invalid
			}
			end = parsed
		} else {
			end = size - 1
		}
		if end < start {
			return nil, invalid
		}
		if end >= size {
			end = size - 1
		}
	}
	if start < 0 || start >= size || end < 0 {
		return nil, invalid
	}
	return &byteRange{start: start, end: end}, nil
}

func thumbnailWidth(r *http.Request) int {
	raw := r.URL.Query().Get("w")
	if !regexp.MustCompile(`^\d{1,4}$`).MatchString(raw) {
		return 0
	}
	width, err := strconv.Atoi(raw)
	if err != nil || width < 64 || width > 1600 {
		return 0
	}
	return width
}

// ServeMedia streams a private object with ETag revalidation, ranges and a
// bounded process-local byte cache. Authorization has already been checked.
func (m *Manager) ServeMedia(ctx context.Context, w http.ResponseWriter, r *http.Request, identity Identity, row *store.MediaObject) error {
	if !m.Enabled() {
		return unavailable()
	}
	return m.serve(ctx, w, r, identity, row.ID, row.Mime, row.Size, row.ObjectKey, nil, thumbnailWidth(r))
}

func (m *Manager) ServeInline(ctx context.Context, w http.ResponseWriter, r *http.Request, identity Identity, id, mime string, data []byte) error {
	if err := m.AssertOrigin(r, identity.Origin, false); err != nil {
		return err
	}
	return m.serve(ctx, w, r, identity, id, mime, int64(len(data)), "", data, 0)
}

func (m *Manager) serve(ctx context.Context, w http.ResponseWriter, r *http.Request, identity Identity, id, mime string, size int64, objectKey string, inline []byte, thumbnail int) error {
	normalized, err := NormalizeMime(mime)
	if err != nil {
		return err
	}
	mime = normalized
	resized := 0
	if thumbnail > 0 && objectKey != "" && strings.HasPrefix(mime, "image/") {
		resized = thumbnail
	}
	head := r.Method == http.MethodHead
	cacheKey := strings.Join([]string{id, mime, strconv.FormatInt(size, 10), objectKey, strconv.Itoa(resized)}, "|")
	etag := `"` + httpx.Hash(cacheKey) + `"`
	headers := MediaHeaders()
	headers.Set("Cache-Control", "private, no-cache")
	headers.Set("ETag", etag)
	if validators := r.Header.Get("If-None-Match"); validators != "" {
		for _, value := range strings.Split(validators, ",") {
			value = strings.TrimPrefix(strings.TrimSpace(value), "W/")
			if value == etag || value == "*" {
				headers.Set("X-Olai-Media-Cache", "REVALIDATED")
				copyHeaders(w, headers)
				w.WriteHeader(http.StatusNotModified)
				return nil
			}
		}
	}
	var requested *byteRange
	if resized == 0 {
		rangeHeader := r.Header.Get("Range")
		if ifRange := r.Header.Get("If-Range"); ifRange != "" && ifRange != etag {
			rangeHeader = ""
		}
		if head {
			rangeHeader = ""
		}
		if rangeHeader != "" {
			parsed, err := parseRange(rangeHeader, size)
			if err != nil {
				copyHeaders(w, headers)
				w.Header().Set("Content-Range", "bytes */"+strconv.FormatInt(size, 10))
				WriteFailure(w, err, head)
				return nil
			}
			requested = parsed
		}
	}
	info := MimeTypes[mime]
	disposition := "inline"
	if info.Download {
		disposition = "attachment"
	}
	base := headers.Clone()
	base.Set("Content-Type", mime)
	base.Set("Content-Disposition", disposition+`; filename="`+id+"."+info.Extension+`"`)
	if resized == 0 {
		base.Set("Accept-Ranges", "bytes")
	}
	var cached []byte
	if resized > 0 {
		cached = cache.get(cacheKey)
		if cached != nil {
			base.Set("X-Olai-Media-Cache", "HIT")
			base.Set("Content-Length", strconv.Itoa(len(cached)))
			copyHeaders(w, base)
			w.WriteHeader(http.StatusOK)
			if !head {
				_, _ = w.Write(cached)
			}
			return nil
		}
	} else if requested != nil {
		if full := cache.get(cacheKey); full != nil && int64(len(full)) == size {
			cached = full[requested.start : requested.end+1]
			base.Set("X-Olai-Media-Cache", "HIT")
			base.Set("Content-Length", strconv.FormatInt(int64(len(cached)), 10))
			base.Set("Content-Range", "bytes "+strconv.FormatInt(requested.start, 10)+"-"+strconv.FormatInt(requested.end, 10)+"/"+strconv.FormatInt(size, 10))
			copyHeaders(w, base)
			w.WriteHeader(http.StatusPartialContent)
			if !head {
				_, _ = w.Write(cached)
			}
			return nil
		}
	} else if full := cache.get(cacheKey); full != nil && int64(len(full)) == size {
		base.Set("X-Olai-Media-Cache", "HIT")
		base.Set("Content-Length", strconv.FormatInt(size, 10))
		copyHeaders(w, base)
		w.WriteHeader(http.StatusOK)
		if !head {
			_, _ = w.Write(full)
		}
		return nil
	}
	bodyLength := size
	if requested != nil {
		bodyLength = requested.end - requested.start + 1
	}
	status := http.StatusOK
	base.Set("X-Olai-Media-Cache", "MISS")
	if resized > 0 {
		base.Del("Content-Length")
	} else {
		base.Set("Content-Length", strconv.FormatInt(bodyLength, 10))
		if requested != nil {
			status = http.StatusPartialContent
			base.Set("Content-Range", "bytes "+strconv.FormatInt(requested.start, 10)+"-"+strconv.FormatInt(requested.end, 10)+"/"+strconv.FormatInt(size, 10))
		}
	}
	if err := m.budget(ctx, identity, nil, true); err != nil {
		return err
	}
	if head {
		copyHeaders(w, base)
		w.WriteHeader(http.StatusOK)
		return nil
	}
	if err := m.budget(ctx, identity, int64Ptr(0), true); err != nil {
		return err
	}
	var reader io.ReadCloser
	if inline != nil {
		slice := inline
		if requested != nil {
			slice = inline[requested.start : requested.end+1]
		}
		reader = io.NopCloser(bytes.NewReader(slice))
	} else if resized > 0 {
		reader, err = m.OSS.Read(objectKey, "", "image/resize,w_"+strconv.Itoa(resized)+"/quality,q_80")
		if err != nil {
			return unavailable()
		}
	} else if requested != nil {
		reader, err = m.OSS.Read(objectKey, "bytes="+strconv.FormatInt(requested.start, 10)+"-"+strconv.FormatInt(requested.end, 10), "")
		if err != nil {
			return unavailable()
		}
	} else {
		reader, err = m.OSS.Read(objectKey, "", "")
		if err != nil {
			return unavailable()
		}
	}
	defer reader.Close()
	copyHeaders(w, base)
	w.WriteHeader(status)
	remaining := int64(-1)
	if resized == 0 {
		remaining = bodyLength
	}
	var capture []byte
	if resized == 0 && !head && size <= cacheMaxCapture {
		capture = make([]byte, 0, minInt64(size, 8*1024*1024))
	}
	flusher, _ := w.(http.Flusher)
	buffer := make([]byte, 64*1024)
	for {
		read, readErr := reader.Read(buffer)
		if read > 0 {
			if remaining >= 0 && int64(read) > remaining {
				return unavailable()
			}
			if err := m.budget(ctx, identity, int64Ptr(int64(read)), true); err != nil {
				return err
			}
			if _, err := w.Write(buffer[:read]); err != nil {
				return nil
			}
			if flusher != nil {
				flusher.Flush()
			}
			if remaining >= 0 {
				remaining -= int64(read)
			}
			if capture != nil && len(capture)+read <= cacheMaxCapture {
				capture = append(capture, buffer[:read]...)
			} else {
				capture = nil
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil
		}
	}
	if resized == 0 && remaining > 0 {
		return nil
	}
	if capture != nil && int64(len(capture)) == size {
		cache.put(cacheKey, capture)
	}
	return nil
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

var _ = oss.ErrUnavailable
