// Package settings 提供运行期配置：主数据库中的 app_settings 是主存储
// （默认部署即 SQLite，PostgreSQL 部署时随主数据库保存在 PostgreSQL）。
// 首次启动会把 .env 中的配置一次性导入数据库；之后数据库优先，.env 只作为
// 尚未导入的键与“恢复默认”的回退值。监听地址、端口和数据库连接串属于启动
// 参数，仍在打开数据库之前从环境变量读取。
package settings

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"olai/internal/store"
	appversion "olai/internal/version"
)

type Type string

const (
	TypeInt     Type = "int"
	TypeBool    Type = "bool"
	TypeText    Type = "text"
	TypeCSV     Type = "csv"
	TypeURL     Type = "url"
	TypeEnum    Type = "enum"
	TypeSecret  Type = "secret"
	TypeLink    Type = "link"
	TypeVersion Type = "version"
)

type Def struct {
	Key       string   `json:"key"`
	Group     string   `json:"group"`
	Label     string   `json:"label"`
	Help      string   `json:"help,omitempty"`
	Type      Type     `json:"type"`
	Default   string   `json:"default"`
	Min       *int     `json:"min,omitempty"`
	Max       *int     `json:"max,omitempty"`
	Choices   []string `json:"choices,omitempty"`
	Secret    bool     `json:"secret,omitempty"`
	Restart   bool     `json:"restart,omitempty"`
	Multiline bool     `json:"multiline,omitempty"`
}

const (
	AI_MODEL_HELP = "留空使用内置默认模型。"
	BYTES_HELP    = "字节数，例如 268435456 表示 256 MiB。"
)

const (
	DefaultAdminPath = "/admin"
	AdminPathMax     = 100
)

func intp(v int) *int { return &v }

var Defs = []Def{
	// 站点与安全
	{Key: "SITE_ORIGIN", Group: "站点", Label: "公开站点地址", Type: TypeURL, Default: "", Help: "反向代理部署时填写，例如 https://olai.example.com。留空使用请求地址。"},
	{Key: "TRUST_PROXY", Group: "站点", Label: "信任反向代理", Type: TypeBool, Default: "false", Help: "仅在可信代理会覆盖 X-Forwarded-For 且服务不能被直接访问时开启。"},
	{Key: "ADMIN_PATH", Group: "站点", Label: "后台入口路径", Type: TypeText, Default: DefaultAdminPath, Max: intp(AdminPathMax), Help: "默认 /admin，可改为不易猜测的路径，例如 /console-x7k2。修改后原入口立即失效，请保存好新地址。"},

	// AI 服务
	{Key: "AI_API_BASE_URL", Group: "AI 服务", Label: "网关地址", Type: TypeURL, Default: "", Help: "OpenAI 兼容接口地址，例如 https://example.com/v1。仅服务端使用。"},
	{Key: "AI_API_KEY", Group: "AI 服务", Label: "网关密钥", Type: TypeSecret, Default: "", Secret: true},
	{Key: "AI_SYSTEM_PROMPT", Group: "AI 服务", Label: "对话系统提示词", Type: TypeText, Default: "", Max: intp(8000), Multiline: true, Help: "留空使用内置的小o默认人格。"},
	{Key: "AI_CHAT_MODEL", Group: "AI 服务", Label: "对话模型", Type: TypeText, Default: "", Max: intp(200), Help: AI_MODEL_HELP},
	{Key: "AI_IMAGE_MODEL", Group: "AI 服务", Label: "图片模型", Type: TypeText, Default: "", Max: intp(200), Help: AI_MODEL_HELP},
	{Key: "AI_VIDEO_MODEL", Group: "AI 服务", Label: "视频模型", Type: TypeText, Default: "", Max: intp(200), Help: AI_MODEL_HELP},
	{Key: "AI_MUSIC_MODEL", Group: "AI 服务", Label: "音乐模型", Type: TypeText, Default: "", Max: intp(200), Help: AI_MODEL_HELP},
	{Key: "AI_IMAGE_API_MODE", Group: "AI 服务", Label: "图片接口模式", Type: TypeEnum, Default: "auto", Choices: []string{"auto", "native", "upstream", "interactions"}},
	{Key: "AI_AUDIO_API_MODE", Group: "AI 服务", Label: "音乐接口模式", Type: TypeEnum, Default: "auto", Choices: []string{"auto", "upstream"}},
	{Key: "AI_SHORT_FILM", Group: "AI 服务", Label: "开放短片工坊", Type: TypeBool, Default: "false"},
	{Key: "AI_VIDEO_OMNI_ASYNC", Group: "AI 服务", Label: "Omni 异步视频", Type: TypeBool, Default: "false", Restart: true, Help: "前端在构建时读取，修改后需要重新构建前端。"},

	// 每日额度与限流
	{Key: "GUEST_DAILY_GENERATION_LIMIT", Group: "额度与限流", Label: "游客每日生成次数", Type: TypeInt, Default: "1", Min: intp(0), Max: intp(100000)},
	{Key: "USER_DAILY_GENERATION_LIMIT", Group: "额度与限流", Label: "登录用户每日生成次数", Type: TypeInt, Default: "15", Min: intp(0), Max: intp(100000)},
	{Key: "GUEST_DAILY_CHAT_LIMIT", Group: "额度与限流", Label: "游客每日对话条数", Type: TypeInt, Default: "100", Min: intp(0), Max: intp(1000000)},
	{Key: "USER_DAILY_CHAT_LIMIT", Group: "额度与限流", Label: "登录用户每日对话条数", Type: TypeInt, Default: "100", Min: intp(0), Max: intp(1000000)},
	{Key: "CHAT_RATE_LIMIT", Group: "额度与限流", Label: "每 IP 每分钟对话数", Type: TypeInt, Default: "30", Min: intp(0), Max: intp(100000), Help: "0 表示不限速。"},
	{Key: "CHAT_CONCURRENT_LIMIT", Group: "额度与限流", Label: "每 IP 并发对话数", Type: TypeInt, Default: "20", Min: intp(0), Max: intp(10000), Help: "0 表示不限制。"},

	// 积分与邀请
	{Key: "POINT_SIGNUP_BONUS", Group: "积分与邀请", Label: "注册赠送积分", Type: TypeInt, Default: "100", Min: intp(0), Max: intp(10000000)},
	{Key: "POINT_IMAGE_1K", Group: "积分与邀请", Label: "图片 1K 单价", Type: TypeInt, Default: "1", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_IMAGE_2K", Group: "积分与邀请", Label: "图片 2K 单价", Type: TypeInt, Default: "2", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_IMAGE_4K", Group: "积分与邀请", Label: "图片 4K 单价", Type: TypeInt, Default: "4", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_VIDEO_360P", Group: "积分与邀请", Label: "视频 360p 每秒", Type: TypeInt, Default: "1", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_VIDEO_720P", Group: "积分与邀请", Label: "视频 720p 每秒", Type: TypeInt, Default: "2", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_VIDEO_1080P", Group: "积分与邀请", Label: "视频 1080p 每秒", Type: TypeInt, Default: "4", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_VIDEO_4K", Group: "积分与邀请", Label: "视频 4K 每秒", Type: TypeInt, Default: "8", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_MUSIC_PER_MINUTE", Group: "积分与邀请", Label: "音乐每分钟", Type: TypeInt, Default: "2", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_CHAT", Group: "积分与邀请", Label: "每条对话积分", Type: TypeInt, Default: "0", Min: intp(0), Max: intp(1000000), Help: "0 表示对话不扣积分。"},
	{Key: "POINT_INVITE_REWARD", Group: "积分与邀请", Label: "邀请人奖励", Type: TypeInt, Default: "30", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_INVITE_BONUS", Group: "积分与邀请", Label: "被邀请人奖励", Type: TypeInt, Default: "20", Min: intp(0), Max: intp(1000000)},
	{Key: "POINT_INVITE_DAILY_LIMIT", Group: "积分与邀请", Label: "邀请奖励每日上限", Type: TypeInt, Default: "5", Min: intp(0), Max: intp(10000), Help: "每个邀请人每天最多发放几次；0 表示暂停。"},

	// GitHub 登录
	{Key: "GITHUB_CLIENT_ID", Group: "GitHub 登录", Label: "Client ID", Type: TypeText, Default: "", Max: intp(200)},
	{Key: "GITHUB_CLIENT_SECRET", Group: "GitHub 登录", Label: "Client Secret", Type: TypeSecret, Default: "", Secret: true},
	{Key: "GITHUB_PROXY", Group: "GitHub 登录", Label: "GitHub 请求代理", Type: TypeText, Default: "", Max: intp(500), Help: "例如 http://127.0.0.1:7890。留空时读取 HTTPS_PROXY。"},
	{Key: "GITHUB_RESOLVE_IP", Group: "GitHub 登录", Label: "GitHub 固定 IP", Type: TypeText, Default: "", Max: intp(100), Help: "没有代理时的备选方案；网络恢复后请留空。"},

	// Google 登录
	{Key: "GOOGLE_CLIENT_ID", Group: "Google 登录", Label: "Client ID", Type: TypeText, Default: "", Max: intp(200)},
	{Key: "GOOGLE_CLIENT_SECRET", Group: "Google 登录", Label: "Client Secret", Type: TypeSecret, Default: "", Secret: true},
	{Key: "GOOGLE_PROXY", Group: "Google 登录", Label: "Google 请求代理", Type: TypeSecret, Default: "", Secret: true, Help: "例如 http://127.0.0.1:7890。留空时读取 HTTPS_PROXY。"},

	// 出站邮件
	{Key: "MAIL_HOST", Group: "出站邮件", Label: "SMTP 主机", Type: TypeText, Default: "", Max: intp(253), Help: "例如 mail.bllii.com。留空时回退到 .env。"},
	{Key: "MAIL_PORT", Group: "出站邮件", Label: "SMTP 端口", Type: TypeInt, Default: "465", Min: intp(1), Max: intp(65535), Help: "常用 465（隐式 TLS）或 587（STARTTLS）。"},
	{Key: "MAIL_SECURE", Group: "出站邮件", Label: "隐式 TLS", Type: TypeBool, Default: "true", Help: "端口 465 请开启；端口 587 请关闭，改用 STARTTLS。"},
	{Key: "MAIL_USER", Group: "出站邮件", Label: "SMTP 用户名", Type: TypeText, Default: "", Max: intp(200), Help: "SMTP 登录账号，例如 admin@bllii.com。留空时回退到 .env。"},
	{Key: "MAIL_PASS", Group: "出站邮件", Label: "SMTP 密码", Type: TypeSecret, Default: "", Secret: true},
	{Key: "MAIL_FROM", Group: "出站邮件", Label: "发件人地址", Type: TypeText, Default: "noreply@olai.cc", Max: intp(254), Help: "对外显示的发件人，例如 noreply@olai.cc。"},

	// 私有 OSS
	{Key: "OSS_ENABLED", Group: "私有 OSS", Label: "启用私有 OSS", Type: TypeBool, Default: "false"},
	{Key: "OSS_BUCKET", Group: "私有 OSS", Label: "Bucket", Type: TypeText, Default: "magicfang-linux-dev", Max: intp(63)},
	{Key: "OSS_REGION", Group: "私有 OSS", Label: "Region", Type: TypeText, Default: "", Max: intp(100), Help: "例如 oss-cn-hangzhou，必须与桶的实际地域一致。"},
	{Key: "OSS_ACCESS_KEY_ID", Group: "私有 OSS", Label: "AccessKey ID", Type: TypeText, Default: "", Max: intp(200)},
	{Key: "OSS_ACCESS_KEY_SECRET", Group: "私有 OSS", Label: "AccessKey Secret", Type: TypeSecret, Default: "", Secret: true},
	{Key: "OSS_PREFIX", Group: "私有 OSS", Label: "对象前缀", Type: TypeText, Default: "opt/olai", Max: intp(200)},
	{Key: "OSS_MAX_FILE_BYTES", Group: "私有 OSS", Label: "单文件大小上限", Type: TypeInt, Default: "268435456", Min: intp(1), Max: intp(1073741824), Help: BYTES_HELP},
	{Key: "OSS_IMPORT_HOSTS", Group: "私有 OSS", Label: "允许导入的主机", Type: TypeCSV, Default: "", Help: "逗号分隔的精确主机名；留空只允许网关主机。"},
	{Key: "OSS_MEDIA_RATE_LIMIT", Group: "私有 OSS", Label: "上传每分钟次数", Type: TypeInt, Default: "60", Min: intp(0), Max: intp(1000000)},
	{Key: "OSS_MEDIA_DAILY_BYTES", Group: "私有 OSS", Label: "每日上传字节", Type: TypeInt, Default: "1073741824", Min: intp(1), Max: intp(107374182400), Help: BYTES_HELP},
	{Key: "OSS_MEDIA_READ_RATE_LIMIT", Group: "私有 OSS", Label: "浏览每分钟次数", Type: TypeInt, Default: "60", Min: intp(0), Max: intp(1000000)},
	{Key: "OSS_MEDIA_READ_DAILY_BYTES", Group: "私有 OSS", Label: "浏览每日字节", Type: TypeInt, Default: "1073741824", Min: intp(1), Max: intp(107374182400), Help: BYTES_HELP},

	// 客户端版本与更新
	{Key: "APP_UPDATE_ENABLED", Group: "版本与更新", Label: "启用客户端更新检查", Type: TypeBool, Default: "false", Help: "开启后，客户端可通过 GET /api/app/update 获取更新策略；关闭后接口仍可读取，但不会要求更新。"},
	{Key: "APP_UPDATE_FORCE", Group: "版本与更新", Label: "强制旧版本更新", Type: TypeBool, Default: "false", Help: "仅对低于最新版本的客户端生效；低于最低支持版本时始终强制更新。"},
	{Key: "APP_UPDATE_NOTES", Group: "版本与更新", Label: "更新说明", Type: TypeText, Default: "", Max: intp(2000), Multiline: true, Help: "显示在下载页和客户端更新提示中，支持多行。"},
	{Key: "APP_IOS_LATEST_VERSION", Group: "版本与更新", Label: "iOS 最新版本", Type: TypeVersion, Default: "", Max: intp(40), Help: "语义化版本，例如 1.4.0；留空表示不检查 iOS 更新。"},
	{Key: "APP_IOS_MIN_VERSION", Group: "版本与更新", Label: "iOS 最低支持版本", Type: TypeVersion, Default: "", Max: intp(40), Help: "低于此版本的 iOS 客户端必须更新；留空表示不强制。"},
	{Key: "APP_IOS_DOWNLOAD_URL", Group: "版本与更新", Label: "iOS 下载地址", Type: TypeLink, Default: "", Max: intp(500), Help: "App Store 应用地址；留空时下载页显示即将上架。"},
	{Key: "APP_ANDROID_LATEST_VERSION", Group: "版本与更新", Label: "Android 最新版本", Type: TypeVersion, Default: "", Max: intp(40), Help: "语义化版本，例如 1.4.0；留空表示不检查 Android 更新。"},
	{Key: "APP_ANDROID_MIN_VERSION", Group: "版本与更新", Label: "Android 最低支持版本", Type: TypeVersion, Default: "", Max: intp(40), Help: "低于此版本的 Android 客户端必须更新；留空表示不强制。"},
	{Key: "APP_ANDROID_DOWNLOAD_URL", Group: "版本与更新", Label: "Android 下载地址", Type: TypeLink, Default: "", Max: intp(500), Help: "Google Play 或 APK 下载地址；留空时下载页显示即将上架。"},
}

var Groups = []string{"站点", "AI 服务", "额度与限流", "积分与邀请", "GitHub 登录", "Google 登录", "出站邮件", "私有 OSS", "版本与更新"}

var defsByKey = func() map[string]Def {
	out := make(map[string]Def, len(Defs))
	for _, def := range Defs {
		out[def.Key] = def
	}
	return out
}()

// ---- admin path ----

var reservedSegments = map[string]bool{
	"api": true, "_": true, "admin": true, "assets": true, "login": true, "account": true,
	"home": true, "download": true, "setup": true, "chat": true, "image": true,
	"video": true, "music": true, "gallery": true, "library": true, "workflow": true,
}

var adminPathPattern = regexp.MustCompile(`^/[A-Za-z0-9][A-Za-z0-9_-]*(?:/[A-Za-z0-9][A-Za-z0-9_-]*)*$`)

func NormalizeAdminPath(raw string) (string, bool) {
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if len(value) < 4 || len(value) > AdminPathMax {
		return "", false
	}
	if !strings.HasPrefix(value, "/") || !adminPathPattern.MatchString(value) {
		return "", false
	}
	first := strings.ToLower(strings.SplitN(value[1:], "/", 2)[0])
	if reservedSegments[first] && strings.ToLower(value) != DefaultAdminPath {
		return "", false
	}
	return value, true
}

func AdminPathFromSetting(raw string) string {
	if normalized, ok := NormalizeAdminPath(raw); ok {
		return normalized
	}
	return DefaultAdminPath
}

func NormalizeRequestPath(pathname string) string {
	if pathname == "" || pathname == "/" {
		return "/"
	}
	trimmed := strings.TrimRight(pathname, "/")
	if trimmed == "" {
		return "/"
	}
	if decoded, err := url.PathUnescape(trimmed); err == nil {
		return decoded
	}
	return trimmed
}

func MatchesAdminPath(pathname, entry string) bool {
	return strings.EqualFold(NormalizeRequestPath(pathname), AdminPathFromSetting(entry))
}

// AdminLoginPath is the console's own login page, nested under the configured
// entry so a custom entry moves it too.
func AdminLoginPath(entry string) string {
	return AdminPathFromSetting(entry) + "/login"
}

func MatchesAdminLoginPath(pathname, entry string) bool {
	return strings.EqualFold(NormalizeRequestPath(pathname), AdminLoginPath(entry))
}

func IsOldAdminPath(pathname, entry string) bool {
	normalizedEntry := strings.ToLower(AdminPathFromSetting(entry))
	if normalizedEntry == DefaultAdminPath {
		return false
	}
	path := strings.ToLower(NormalizeRequestPath(pathname))
	return path == DefaultAdminPath || strings.HasPrefix(path, DefaultAdminPath+"/")
}

// ---- manager ----

const refreshInterval = 10 * time.Second

type Manager struct {
	db   *store.DB
	mu   sync.RWMutex
	data map[string]string

	attempted time.Time
	loading   sync.Mutex
}

func New(db *store.DB) *Manager {
	return &Manager{db: db, data: map[string]string{}}
}

// Refresh re-reads overrides at most once per ten seconds unless forced.
func (m *Manager) Refresh(ctx context.Context, force bool) {
	m.mu.RLock()
	attempted := m.attempted
	m.mu.RUnlock()
	if !force && time.Since(attempted) < refreshInterval {
		return
	}
	m.loading.Lock()
	defer m.loading.Unlock()
	m.mu.RLock()
	attempted = m.attempted
	m.mu.RUnlock()
	if !force && time.Since(attempted) < refreshInterval {
		return
	}
	now := time.Now()
	rows, err := m.db.Settings(ctx)
	data := make(map[string]string, len(rows))
	if err == nil {
		for _, row := range rows {
			if _, ok := defsByKey[row.Key]; ok {
				data[row.Key] = row.Value
			}
		}
	}
	m.mu.Lock()
	if err == nil {
		m.data = data
	}
	m.attempted = now
	m.mu.Unlock()
}

// SeedEnv imports every non-empty .env value into app_settings exactly once.
// A marker row makes this idempotent across restarts: deleting an override in
// the admin UI will not silently re-import the old .env value.
func (m *Manager) SeedEnv(ctx context.Context) error {
	_, seeded, err := m.db.SettingValue(ctx, "SETTINGS_SEEDED")
	if err != nil {
		return err
	}
	if seeded {
		return nil
	}
	values := make(map[string]string)
	for _, def := range Defs {
		if raw := strings.TrimSpace(os.Getenv(def.Key)); raw != "" {
			values[def.Key] = raw
		}
	}
	if err := m.db.SeedSettings(ctx, values); err != nil {
		return err
	}
	m.Refresh(ctx, true)
	return nil
}

// ValidateValue exposes the same validation the admin settings save path uses,
// so the setup wizard cannot write values that the settings page would reject.
func ValidateValue(key, raw string) (string, error) {
	def, ok := defsByKey[key]
	if !ok {
		return "", invalid("未知配置项。")
	}
	return validate(def, raw)
}

func (m *Manager) Get(key string) string {
	m.mu.RLock()
	value, overridden := m.data[key]
	m.mu.RUnlock()
	if overridden {
		return value
	}
	if env := os.Getenv(key); env != "" {
		return env
	}
	if def, ok := defsByKey[key]; ok {
		return def.Default
	}
	return ""
}

func (m *Manager) Int(key string, fallback int) int {
	raw := m.Get(key)
	if !regexp.MustCompile(`^\d+$`).MatchString(raw) {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func (m *Manager) IntStrict(key string, fallback int) (int, error) {
	raw := strings.TrimSpace(m.Get(key))
	if raw == "" {
		raw = strconv.Itoa(fallback)
	}
	if !regexp.MustCompile(`^\d+$`).MatchString(raw) {
		return 0, errors.New("配置必须是非负整数。")
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, errors.New("配置必须是非负整数。")
	}
	return value, nil
}

func (m *Manager) Bool(key string) bool {
	return m.Get(key) == "true"
}

// LegacyAdminEmails returns the pre-split ADMIN_EMAILS allowlist. It is read
// only during startup to seed independent console accounts on existing
// installations; it is no longer shown in settings and never authorizes a
// login. The raw app_settings row is consulted because the key is no longer
// part of Defs, so Refresh() drops it from the in-memory overrides.
func (m *Manager) LegacyAdminEmails(ctx context.Context) []string {
	raw := strings.TrimSpace(m.Get("ADMIN_EMAILS"))
	if raw == "" {
		if value, ok, err := m.db.SettingValue(ctx, "ADMIN_EMAILS"); err == nil && ok {
			raw = strings.TrimSpace(value)
		}
	}
	var out []string
	for _, item := range strings.Split(raw, ",") {
		item = strings.ToLower(strings.TrimSpace(item))
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func (m *Manager) SiteOrigin() string {
	return strings.TrimRight(strings.TrimSpace(m.Get("SITE_ORIGIN")), "/")
}

func (m *Manager) AdminEntryPath() string {
	return AdminPathFromSetting(m.Get("ADMIN_PATH"))
}

func (m *Manager) AdminEntryIsDefault() bool {
	return strings.EqualFold(m.AdminEntryPath(), DefaultAdminPath)
}

// Option is one choice in a list-backed setting. Model default settings use it
// to expose the model catalog while keeping the stored value an upstream ID.
type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type PublicSetting struct {
	Def
	Value      string   `json:"value,omitempty"`
	Configured bool     `json:"configured"`
	Source     string   `json:"source"`
	Options    []Option `json:"options,omitempty"`
}

type PublicSettings struct {
	Groups   []string        `json:"groups"`
	Settings []PublicSetting `json:"settings"`
}

func (m *Manager) ForClient() PublicSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := PublicSettings{Groups: append([]string{}, Groups...), Settings: make([]PublicSetting, 0, len(Defs))}
	for _, def := range Defs {
		override, hasOverride := m.data[def.Key]
		raw := override
		source := "database"
		if !hasOverride {
			raw = os.Getenv(def.Key)
			source = "env"
			if raw == "" {
				raw = def.Default
				source = "default"
			}
		}
		item := PublicSetting{Def: def, Configured: strings.TrimSpace(raw) != "", Source: source}
		if !def.Secret {
			item.Value = raw
		}
		out.Settings = append(out.Settings, item)
	}
	return out
}

func (m *Manager) SettingKeys() []string {
	out := make([]string, 0, len(Defs))
	for _, def := range Defs {
		out = append(out, def.Key)
	}
	return out
}

type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }

func invalid(format string, args ...any) error {
	return &Error{Message: fmt.Sprintf(format, args...)}
}

var (
	emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	spacePattern = regexp.MustCompile(`\s`)
)

func validate(def Def, raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if def.Secret {
		if len(value) > 1000 || strings.ContainsAny(value, "\r\n\x00") {
			return "", invalid("%s格式无效。", def.Label)
		}
		return value, nil
	}
	if value == "" {
		if def.Type == TypeEnum || def.Type == TypeBool {
			return "", invalid("%s不能为空。", def.Label)
		}
		return "", nil
	}
	switch def.Type {
	case TypeInt:
		if !regexp.MustCompile(`^\d+$`).MatchString(value) {
			return "", invalid("%s必须是非负整数。", def.Label)
		}
		number, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return "", invalid("%s必须是非负整数。", def.Label)
		}
		if def.Min != nil && int(number) < *def.Min {
			return "", invalid("%s不能小于 %d。", def.Label, *def.Min)
		}
		if def.Max != nil && int(number) > *def.Max {
			return "", invalid("%s不能大于 %d。", def.Label, *def.Max)
		}
		return strconv.FormatInt(number, 10), nil
	case TypeBool:
		if value != "true" && value != "false" {
			return "", invalid("%s只能是 true 或 false。", def.Label)
		}
		return value, nil
	case TypeVersion:
		maxLen := 40
		if def.Max != nil {
			maxLen = *def.Max
		}
		if len(value) > maxLen {
			return "", invalid("%s内容过长。", def.Label)
		}
		normalized, ok := appversion.Normalize(value)
		if !ok {
			return "", invalid("%s必须是版本号，例如 1.4.0。", def.Label)
		}
		return normalized, nil
	case TypeLink:
		maxLen := 500
		if def.Max != nil {
			maxLen = *def.Max
		}
		if len(value) > maxLen {
			return "", invalid("%s内容过长。", def.Label)
		}
		parsed, err := url.Parse(value)
		if err != nil {
			return "", invalid("%s必须是完整的 http(s) 地址。", def.Label)
		}
		scheme := strings.ToLower(parsed.Scheme)
		if !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil ||
			(scheme != "http" && scheme != "https") {
			return "", invalid("%s必须是完整的 http(s) 地址。", def.Label)
		}
		return value, nil
	case TypeEnum:
		for _, choice := range def.Choices {
			if choice == value {
				return value, nil
			}
		}
		return "", invalid("%s取值无效。", def.Label)
	case TypeURL:
		parsed, err := url.Parse(value)
		if err != nil || !parsed.IsAbs() {
			return "", invalid("%s必须是完整地址，例如 https://example.com。", def.Label)
		}
		if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return "", invalid("%s必须是不含账号、查询和锚点的 http(s) 地址。", def.Label)
		}
		if def.Key == "SITE_ORIGIN" && parsed.Path != "" && parsed.Path != "/" {
			return "", invalid("公开站点地址只能是 origin，不能包含路径。")
		}
		return strings.TrimRight(value, "/"), nil
	case TypeCSV:
		if len(value) > 2000 {
			return "", invalid("%s内容过长。", def.Label)
		}
		var items []string
		for _, item := range strings.Split(value, ",") {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if len(item) > 254 || spacePattern.MatchString(item) {
				return "", invalid("%s格式无效。", def.Label)
			}
			items = append(items, item)
		}
		return strings.Join(items, ","), nil
	default:
		maxLen := 4000
		if def.Max != nil {
			maxLen = *def.Max
		}
		if len(value) > maxLen {
			return "", invalid("%s内容过长。", def.Label)
		}
		if def.Key == "ADMIN_PATH" {
			normalized, ok := NormalizeAdminPath(value)
			if !ok {
				return "", invalid("后台安全入口必须以 / 开头，长度为 4–100，只能包含字母、数字、-、_ 和 /，且不能与现有页面冲突。")
			}
			return normalized, nil
		}
		if def.Key == "MAIL_FROM" && !emailPattern.MatchString(value) {
			return "", invalid("发件人地址格式无效。")
		}
		if def.Key == "MAIL_HOST" && (strings.ContainsAny(value, "/:") || spacePattern.MatchString(value) ||
			strings.HasPrefix(value, ".") || strings.HasSuffix(value, ".")) {
			return "", invalid("SMTP 主机格式无效。")
		}
		return value, nil
	}
}

// Save validates and persists overrides. Empty string clears an override to the
// literal empty value; use reset to fall back to .env / defaults.
func (m *Manager) Save(ctx context.Context, values map[string]any, reset []any, adminID string) ([]string, error) {
	writes := make(map[string]string)
	var removals []string
	for key, raw := range values {
		def, ok := defsByKey[key]
		if !ok {
			return nil, invalid("包含未知配置项。")
		}
		text, ok := raw.(string)
		if !ok {
			return nil, invalid("%s格式无效。", def.Label)
		}
		value, err := validate(def, text)
		if err != nil {
			return nil, err
		}
		writes[key] = value
	}
	for _, raw := range reset {
		key, ok := raw.(string)
		if !ok {
			return nil, invalid("包含未知配置项。")
		}
		if _, exists := defsByKey[key]; !exists {
			return nil, invalid("包含未知配置项。")
		}
		removals = append(removals, key)
	}
	if err := m.validateReleasePairs(writes, removals); err != nil {
		return nil, err
	}
	if len(writes) == 0 && len(removals) == 0 {
		return []string{}, nil
	}
	if err := m.db.SaveSettings(ctx, writes, removals, adminID); err != nil {
		return nil, err
	}
	m.mu.Lock()
	for key, value := range writes {
		m.data[key] = value
	}
	for _, key := range removals {
		delete(m.data, key)
	}
	m.attempted = time.Now()
	m.mu.Unlock()
	changed := make([]string, 0, len(writes)+len(removals))
	for key := range writes {
		changed = append(changed, key)
	}
	changed = append(changed, removals...)
	return changed, nil
}

// validateReleasePairs rejects a minimum version above the matching latest
// version. It evaluates the values that would be effective after this save,
// including resets back to .env or built-in defaults.
func (m *Manager) validateReleasePairs(writes map[string]string, removals []string) error {
	removed := make(map[string]bool, len(removals))
	for _, key := range removals {
		removed[key] = true
	}
	effective := func(key string) string {
		if value, ok := writes[key]; ok {
			return value
		}
		if removed[key] {
			if env := os.Getenv(key); env != "" {
				return env
			}
			if def, ok := defsByKey[key]; ok {
				return def.Default
			}
			return ""
		}
		return m.Get(key)
	}
	pairs := [][2]string{
		{"APP_IOS_MIN_VERSION", "APP_IOS_LATEST_VERSION"},
		{"APP_ANDROID_MIN_VERSION", "APP_ANDROID_LATEST_VERSION"},
	}
	for _, pair := range pairs {
		minimum, latest := effective(pair[0]), effective(pair[1])
		if minimum == "" || latest == "" {
			continue
		}
		cmp, ok := appversion.Compare(minimum, latest)
		if !ok || cmp <= 0 {
			continue
		}
		return invalid("%s不能高于%s。", defsByKey[pair[0]].Label, defsByKey[pair[1]].Label)
	}
	return nil
}
