// Package httpx 提供客户端 IP、同源校验与请求工具。
package httpx

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"olai/internal/settings"
)

type ClientIPError struct{ Message string }

func (e *ClientIPError) Error() string { return e.Message }

func Hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func DayKey(now time.Time) string {
	return now.UTC().Add(8 * time.Hour).Format("2006-01-02")
}

func DayStart(now time.Time) int64 {
	day := DayKey(now)
	parsed, err := time.ParseInLocation("2006-01-02T15:04:05", day+"T00:00:00", time.FixedZone("CST", 8*3600))
	if err != nil {
		return now.UnixMilli()
	}
	return parsed.UnixMilli()
}

// ClientIP rejects X-Forwarded-For unless TRUST_PROXY is explicitly enabled, so
// a header cannot reset guest quota identities in a direct deployment.
func ClientIP(r *http.Request, s *settings.Manager) (string, error) {
	trustProxy := s.Get("TRUST_PROXY") == "true"
	if !trustProxy && r.Header.Get("X-Forwarded-For") != "" {
		return "", &ClientIPError{Message: "请配置可信代理后再使用转发 IP 标头。"}
	}
	ip := ""
	if trustProxy {
		ip = strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])
	}
	if ip == "" {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		ip = host
	}
	if net.ParseIP(ip) == nil {
		return "", &ClientIPError{Message: "无法确定客户端 IP，请检查代理配置。"}
	}
	if strings.HasPrefix(ip, "::ffff:") && net.ParseIP(ip[7:]) != nil && strings.Contains(ip[7:], ".") {
		ip = ip[7:]
	}
	return strings.ToLower(ip), nil
}

func SameOrigin(r *http.Request, s *settings.Manager) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || origin == "null" {
		return false
	}
	source, err := url.Parse(origin)
	if err != nil || (source.Scheme != "http" && source.Scheme != "https") || origin != source.Scheme+"://"+source.Host {
		return false
	}
	if configured := strings.TrimSpace(s.SiteOrigin()); configured != "" {
		if parsed, err := url.Parse(configured); err == nil && source.Scheme+"://"+source.Host == parsed.Scheme+"://"+parsed.Host {
			return true
		}
	}
	host := r.Header.Get("Host")
	if host == "" {
		host = r.Host
	}
	if host == "" {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	destination, err := url.Parse(scheme + "://" + host)
	if err != nil || destination.Host != host || destination.User != nil {
		return false
	}
	return source.Scheme+"://"+source.Host == destination.Scheme+"://"+destination.Host
}

func RequestOrigin(r *http.Request, s *settings.Manager) string {
	if configured := s.SiteOrigin(); configured != "" {
		if parsed, err := url.Parse(configured); err == nil {
			return parsed.Scheme + "://" + parsed.Host
		}
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := r.Header.Get("Host")
	if host == "" {
		host = r.Host
	}
	return scheme + "://" + host
}

var ErrNotFound = errors.New("not found")

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	writeJSONBody(w, value)
}

func writeJSONBody(w http.ResponseWriter, value any) {
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
}
