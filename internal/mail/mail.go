// Package mail 发送注册验证与密码重置邮件。仅使用标准库 SMTP。
package mail

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"html"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"

	"olai/internal/settings"
)

type ConfigError struct{ Message string }

func (e *ConfigError) Error() string { return e.Message }

const defaultConfigMessage = "邮件服务尚未配置，暂时无法发送邮件。请联系管理员。"

type Manager struct{ Settings *settings.Manager }

func (m *Manager) Configured() bool {
	s := m.Settings
	return strings.TrimSpace(s.Get("MAIL_HOST")) != "" && strings.TrimSpace(s.Get("MAIL_USER")) != "" &&
		s.Get("MAIL_PASS") != "" && strings.TrimSpace(s.Get("MAIL_FROM")) != ""
}

func (m *Manager) From() string {
	value := strings.TrimSpace(m.Settings.Get("MAIL_FROM"))
	if value == "" {
		return "noreply@olai.cc"
	}
	return value
}

func (m *Manager) SiteOrigin(requestOrigin string) string {
	if configured := m.Settings.SiteOrigin(); configured != "" {
		return configured
	}
	return strings.TrimRight(requestOrigin, "/")
}

type message struct {
	to      string
	subject string
	text    string
	html    string
}

func encodeHeader(value string) string {
	return mime.QEncoding.Encode("utf-8", value)
}

func wrapBase64(value string) string {
	encoded := base64.StdEncoding.EncodeToString([]byte(value))
	var out strings.Builder
	for len(encoded) > 76 {
		out.WriteString(encoded[:76])
		out.WriteString("\r\n")
		encoded = encoded[76:]
	}
	out.WriteString(encoded)
	return out.String()
}

func (m *Manager) build(msg message) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	boundary := fmt.Sprintf("olai-%x", buf)
	from := m.From()
	var out strings.Builder
	out.WriteString("From: Olai <" + from + ">\r\n")
	out.WriteString("Reply-To: " + from + "\r\n")
	out.WriteString("To: " + msg.to + "\r\n")
	out.WriteString("Subject: " + encodeHeader(msg.subject) + "\r\n")
	out.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	out.WriteString("MIME-Version: 1.0\r\n")
	out.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n")
	out.WriteString("\r\n")
	out.WriteString("--" + boundary + "\r\n")
	out.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	out.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	out.WriteString(wrapBase64(msg.text))
	out.WriteString("\r\n--" + boundary + "\r\n")
	out.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	out.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	out.WriteString(wrapBase64(msg.html))
	out.WriteString("\r\n--" + boundary + "--\r\n")
	return out.String(), nil
}

func (m *Manager) send(msg message) error {
	if !m.Configured() {
		return &ConfigError{Message: defaultConfigMessage}
	}
	host := strings.TrimSpace(m.Settings.Get("MAIL_HOST"))
	port := m.Settings.Int("MAIL_PORT", 465)
	if port < 1 || port > 65535 {
		port = 465
	}
	secure := m.Settings.Get("MAIL_SECURE") != "false"
	user := strings.TrimSpace(m.Settings.Get("MAIL_USER"))
	pass := m.Settings.Get("MAIL_PASS")
	body, err := m.build(msg)
	if err != nil {
		return err
	}
	address := net.JoinHostPort(host, fmt.Sprint(port))
	var client *smtp.Client
	if secure {
		conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 20 * time.Second}, "tcp", address, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
		if err != nil {
			return &ConfigError{Message: "邮件服务连接失败，请稍后重试。"}
		}
		client, err = smtp.NewClient(conn, host)
		if err != nil {
			conn.Close()
			return &ConfigError{Message: "邮件服务连接失败，请稍后重试。"}
		}
	} else {
		conn, err := net.DialTimeout("tcp", address, 20*time.Second)
		if err != nil {
			return &ConfigError{Message: "邮件服务连接失败，请稍后重试。"}
		}
		client, err = smtp.NewClient(conn, host)
		if err != nil {
			conn.Close()
			return &ConfigError{Message: "邮件服务连接失败，请稍后重试。"}
		}
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
				client.Close()
				return &ConfigError{Message: "邮件服务加密连接失败，请检查端口与 TLS 配置。"}
			}
		}
	}
	defer client.Close()
	if ok, _ := client.Extension("AUTH"); ok {
		if err := client.Auth(smtp.PlainAuth("", user, pass, host)); err != nil {
			return &ConfigError{Message: "邮件服务认证失败，请联系管理员检查 SMTP 配置。"}
		}
	}
	if err := client.Mail(m.From()); err != nil {
		return &ConfigError{Message: "邮件发送失败，请稍后重试。"}
	}
	if err := client.Rcpt(msg.to); err != nil {
		return &ConfigError{Message: "邮件发送失败，请稍后重试。"}
	}
	writer, err := client.Data()
	if err != nil {
		return &ConfigError{Message: "邮件发送失败，请稍后重试。"}
	}
	if _, err := writer.Write([]byte(body)); err != nil {
		writer.Close()
		return &ConfigError{Message: "邮件发送失败，请稍后重试。"}
	}
	if err := writer.Close(); err != nil {
		return &ConfigError{Message: "邮件发送失败，请稍后重试。"}
	}
	_ = client.Quit()
	return nil
}

func (m *Manager) SendVerification(to, link string) error {
	link = strings.TrimSpace(link)
	safe := html.EscapeString(link)
	return m.send(message{
		to:      to,
		subject: "验证你的 Olai 邮箱",
		text:    "欢迎使用 Olai。请打开下面的链接验证邮箱（30 分钟内有效）：\r\n" + link + "\r\n\r\n如果这不是你本人的操作，请忽略这封邮件。",
		html:    `<p>欢迎使用 Olai。</p><p>请在 30 分钟内打开这个链接验证邮箱：</p><p><a href="` + safe + `">` + safe + `</a></p><p>如果这不是你本人的操作，请忽略这封邮件。</p>`,
	})
}

func (m *Manager) SendReset(to, link string) error {
	link = strings.TrimSpace(link)
	safe := html.EscapeString(link)
	return m.send(message{
		to:      to,
		subject: "重置你的 Olai 密码",
		text:    "我们收到了重置 Olai 密码的请求。请打开下面的链接设置新密码（30 分钟内有效）：\r\n" + link + "\r\n\r\n如果这不是你本人的操作，请忽略这封邮件，密码不会被更改。",
		html:    `<p>我们收到了重置 Olai 密码的请求。</p><p>请在 30 分钟内打开下面的链接设置新密码：</p><p><a href="` + safe + `">` + safe + `</a></p><p>如果这不是你本人的操作，请忽略这封邮件，密码不会被更改。</p>`,
	})
}
