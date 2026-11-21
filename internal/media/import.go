package media

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

var publicV6 = netip.MustParsePrefix("2000::/3")

func PublicMediaIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() {
		return false
	}
	for _, prefix := range blockedPrefixes {
		if prefix.Contains(ip) {
			return false
		}
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	if ip.Is6() {
		return publicV6.Contains(ip)
	}
	return true
}

var ErrImport = errors.New("媒体来源暂时无法读取。")

func (m *Manager) allowedImportURL(source string) (*url.URL, error) {
	parsed, err := url.Parse(source)
	if err != nil {
		return nil, errors.New("此媒体来源尚未被服务端允许，请联系管理员配置媒体来源。")
	}
	hosts := []string{}
	for _, item := range strings.Split(m.Settings.Get("OSS_IMPORT_HOSTS"), ",") {
		if host := strings.ToLower(strings.TrimSpace(item)); host != "" {
			hosts = append(hosts, host)
		}
	}
	if base, err := url.Parse(m.Settings.Get("AI_API_BASE_URL")); err == nil && base.Hostname() != "" {
		hosts = append(hosts, strings.ToLower(base.Hostname()))
	}
	hostname := strings.ToLower(parsed.Hostname())
	allowed := false
	for _, host := range hosts {
		if host == hostname {
			allowed = true
			break
		}
	}
	if parsed.Scheme != "https" || (parsed.Port() != "" && parsed.Port() != "443") || parsed.User != nil ||
		parsed.Fragment != "" || !allowed || net.ParseIP(strings.Trim(hostname, "[]")) != nil {
		return nil, errors.New("此媒体来源尚未被服务端允许，请联系管理员配置媒体来源。")
	}
	return parsed, nil
}

type downloadedMedia struct {
	Bytes []byte
	Mime  string
}

// ImportRemoteMedia fetches an allowlisted HTTPS URL, pins a validated public
// DNS answer to the connection, revalidates every redirect and never forwards
// cookies or provider credentials.
func (m *Manager) ImportRemoteMedia(ctx context.Context, source string) (*downloadedMedia, error) {
	_, maxBytes, err := m.OSS.SettingsForMedia()
	if err != nil {
		return nil, unavailable()
	}
	current := source
	for redirects := 0; redirects <= 3; redirects++ {
		parsed, err := m.allowedImportURL(current)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupIPAddr(ctx, parsed.Hostname())
		if err != nil || len(addresses) == 0 {
			return nil, ErrImport
		}
		var chosen netip.Addr
		for _, address := range addresses {
			ip, ok := netip.AddrFromSlice(address.IP)
			if !ok || !PublicMediaIP(ip) {
				return nil, errors.New("媒体来源地址不允许访问。")
			}
			if !chosen.IsValid() {
				chosen = ip.Unmap()
			}
		}
		transport := &http.Transport{
			TLSClientConfig:   &tls.Config{ServerName: parsed.Hostname(), MinVersion: tls.VersionTLS12},
			DisableKeepAlives: true,
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				dialer := &net.Dialer{Timeout: 20 * time.Second}
				return dialer.DialContext(ctx, network, net.JoinHostPort(chosen.String(), "443"))
			},
		}
		client := &http.Client{
			Transport: transport,
			Timeout:   90 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
		if err != nil {
			return nil, ErrImport
		}
		request.Header.Set("Accept", "image/*,audio/*,video/*")
		request.Header.Set("Accept-Encoding", "identity")
		response, err := client.Do(request)
		if err != nil {
			return nil, ErrImport
		}
		if response.StatusCode >= 300 && response.StatusCode <= 399 && response.Header.Get("Location") != "" {
			location := response.Header.Get("Location")
			response.Body.Close()
			next, err := url.Parse(location)
			if err != nil {
				return nil, ErrImport
			}
			current = parsed.ResolveReference(next).String()
			continue
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			return nil, errors.New("媒体来源无法读取或文件过大。")
		}
		if encoding := response.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
			response.Body.Close()
			return nil, errors.New("媒体来源无法读取或文件过大。")
		}
		if response.ContentLength > maxBytes {
			response.Body.Close()
			return nil, errors.New("媒体文件超过上传大小限制。")
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
		response.Body.Close()
		if err != nil {
			return nil, ErrImport
		}
		if int64(len(data)) > maxBytes {
			return nil, errors.New("媒体文件超过上传大小限制。")
		}
		if len(data) == 0 {
			return nil, errors.New("媒体内容为空。")
		}
		mime := strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0])
		if mime == "" {
			mime = "application/octet-stream"
		}
		return &downloadedMedia{Bytes: data, Mime: mime}, nil
	}
	return nil, errors.New("媒体来源重定向次数过多。")
}
