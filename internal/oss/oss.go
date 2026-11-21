// Package oss 封装阿里云私有 OSS。SDK 错误、对象路径和 Endpoint
// 永远不会返回给浏览器。
package oss

import (
	"bytes"
	"errors"
	"io"
	"regexp"
	"strings"
	"sync"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"

	"olai/internal/settings"
)

type UnavailableError struct{}

func (e *UnavailableError) Error() string { return "私有媒体服务暂不可用。" }

var ErrUnavailable = &UnavailableError{}

type Manager struct {
	Settings *settings.Manager

	mu     sync.Mutex
	client *oss.Client
	key    string
}

var (
	regionRE = regexp.MustCompile(`^oss-[a-z0-9-]+$`)
	bucketRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`)
	prefixRE = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

type Config struct {
	Region          string
	Bucket          string
	Prefix          string
	AccessKeyID     string
	AccessKeySecret string
	MaxFileBytes    int64
}

func (m *Manager) config() (Config, error) {
	region := strings.TrimSpace(m.Settings.Get("OSS_REGION"))
	bucket := strings.TrimSpace(m.Settings.Get("OSS_BUCKET"))
	if bucket == "" {
		bucket = "magicfang-linux-dev"
	}
	prefix := strings.Trim(strings.TrimSpace(m.Settings.Get("OSS_PREFIX")), "/")
	accessKeyID := strings.TrimSpace(m.Settings.Get("OSS_ACCESS_KEY_ID"))
	accessKeySecret := strings.TrimSpace(m.Settings.Get("OSS_ACCESS_KEY_SECRET"))
	validPrefix := prefix != "" && len(prefix) <= 200
	for _, part := range strings.Split(prefix, "/") {
		if !prefixRE.MatchString(part) {
			validPrefix = false
		}
	}
	if !regionRE.MatchString(region) || !bucketRE.MatchString(bucket) || !validPrefix || accessKeyID == "" || accessKeySecret == "" {
		return Config{}, ErrUnavailable
	}
	maxFileBytes := int64(m.Settings.Int("OSS_MAX_FILE_BYTES", 256*1024*1024))
	if maxFileBytes < 1 || maxFileBytes > 1024*1024*1024 {
		return Config{}, ErrUnavailable
	}
	return Config{Region: region, Bucket: bucket, Prefix: prefix, AccessKeyID: accessKeyID, AccessKeySecret: accessKeySecret, MaxFileBytes: maxFileBytes}, nil
}

func (m *Manager) Enabled() bool {
	if m.Settings.Get("OSS_ENABLED") != "true" {
		return false
	}
	_, err := m.config()
	return err == nil
}

func (m *Manager) SettingsForMedia() (prefix string, maxBytes int64, err error) {
	if !m.Enabled() {
		return "", 0, ErrUnavailable
	}
	cfg, err := m.config()
	if err != nil {
		return "", 0, err
	}
	return cfg.Prefix, cfg.MaxFileBytes, nil
}

func (m *Manager) Integer(name string, fallback int) (int, error) {
	return m.Settings.IntStrict(name, fallback)
}

func (m *Manager) bucket() (*oss.Bucket, error) {
	if !m.Enabled() {
		return nil, ErrUnavailable
	}
	cfg, err := m.config()
	if err != nil {
		return nil, err
	}
	cacheKey := cfg.Region + "|" + cfg.Bucket + "|" + cfg.AccessKeyID
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client == nil || m.key != cacheKey {
		client, err := oss.New("https://"+cfg.Region+".aliyuncs.com", cfg.AccessKeyID, cfg.AccessKeySecret, oss.Timeout(60, 120))
		if err != nil {
			return nil, ErrUnavailable
		}
		m.client = client
		m.key = cacheKey
	}
	bucket, err := m.client.Bucket(cfg.Bucket)
	if err != nil {
		return nil, ErrUnavailable
	}
	return bucket, nil
}

func (m *Manager) Put(key string, bytes []byte, mime string) error {
	bucket, err := m.bucket()
	if err != nil {
		return err
	}
	if err := bucket.PutObject(key, bytes2reader(bytes), oss.ContentType(mime), oss.ObjectACL(oss.ACLPrivate)); err != nil {
		return ErrUnavailable
	}
	return nil
}

func bytes2reader(value []byte) io.Reader { return bytes.NewReader(value) }

func (m *Manager) Delete(key string) error {
	bucket, err := m.bucket()
	if err != nil {
		return err
	}
	for attempt := 0; attempt < 3; attempt++ {
		if err := bucket.DeleteObject(key); err == nil {
			return nil
		}
	}
	return ErrUnavailable
}

// Read streams an object. rangeHeader accepts the raw `bytes=start-end` form
// used by the media handler. process asks OSS to transform the object, e.g.
// image/resize,w_800.
func (m *Manager) Read(key, rangeHeader, process string) (io.ReadCloser, error) {
	bucket, err := m.bucket()
	if err != nil {
		return nil, err
	}
	var options []oss.Option
	if rangeHeader != "" {
		value := strings.TrimPrefix(rangeHeader, "bytes=")
		parts := strings.SplitN(value, "-", 2)
		if len(parts) == 2 {
			start := parseInt64(parts[0])
			end := parseInt64(parts[1])
			if start >= 0 && end >= start {
				options = append(options, oss.Range(start, end))
			}
		}
	}
	if process != "" {
		options = append(options, oss.Process(process))
	}
	body, err := bucket.GetObject(key, options...)
	if err != nil {
		return nil, ErrUnavailable
	}
	return body, nil
}

func parseInt64(value string) int64 {
	var out int64
	for _, c := range value {
		if c < '0' || c > '9' {
			return -1
		}
		out = out*10 + int64(c-'0')
	}
	return out
}

var _ = errors.Is
