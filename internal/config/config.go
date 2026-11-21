// Package config loads startup configuration from the environment.
//
// Runtime-tunable values (AI endpoints, quotas, points, mail, OSS, GitHub) are
// read through internal/settings, which layers database overrides on top of the
// same environment. Only bootstrap values live here: listen address, database
// connection and the optional setup token.
package config

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Host              string
	Port              int
	DatabaseURL       string
	DatabaseAuthToken string
	Env               string
	// SetupToken optionally protects the first-run wizard. It is bootstrap-only
	// because the wizard itself creates the first console administrator.
	SetupToken string
}

func (c Config) Addr() string { return fmt.Sprintf("%s:%d", c.Host, c.Port) }

// Load reads .env.production then .env without overwriting variables that are
// already present in the process environment (deployment platforms win).
func Load() Config {
	loadEnvFile(".env.production")
	loadEnvFile(".env")
	port, err := strconv.Atoi(env("PORT", "4321"))
	if err != nil || port <= 0 || port > 65535 {
		port = 4321
	}
	return Config{
		Host:              env("HOST", "0.0.0.0"),
		Port:              port,
		DatabaseURL:       strings.TrimSpace(firstNonEmpty(os.Getenv("DATABASE_URL"), os.Getenv("ASTRO_DB_REMOTE_URL"))),
		DatabaseAuthToken: strings.TrimSpace(firstNonEmpty(os.Getenv("DATABASE_AUTH_TOKEN"), os.Getenv("ASTRO_DB_APP_TOKEN"))),
		Env:               env("APP_ENV", env("NODE_ENV", "production")),
		SetupToken:        strings.TrimSpace(os.Getenv("SETUP_TOKEN")),
	}
}

func env(name, fallback string) string {
	if value, ok := os.LookupEnv(name); ok && value != "" {
		return value
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func loadEnvFile(name string) {
	file, err := os.Open(name)
	if err != nil {
		return
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
}

// IsPostgres reports whether the configured database URL points at PostgreSQL.
func IsPostgres(databaseURL string) bool {
	return strings.HasPrefix(databaseURL, "postgres://") || strings.HasPrefix(databaseURL, "postgresql://")
}

// NormalizeDatabaseURL turns the accepted forms into a DSN understood by the
// selected driver. Empty means the local SQLite default.
func NormalizeDatabaseURL(databaseURL string) (driverName, dsn string, err error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if IsPostgres(databaseURL) {
		return "pgx", databaseURL, nil
	}
	path := databaseURL
	if path == "" {
		path = filepath.Join("data", "olai.db")
	} else if strings.HasPrefix(path, "file:") {
		parsed, parseErr := url.Parse(path)
		if parseErr != nil {
			return "", "", fmt.Errorf("数据库地址无效：%w", parseErr)
		}
		path = parsed.Path
		if parsed.Opaque != "" {
			path = parsed.Opaque
		}
		if path == "" {
			return "", "", fmt.Errorf("数据库文件路径为空")
		}
	} else if scheme, _, ok := strings.Cut(path, ":"); ok && len(scheme) > 1 && !strings.ContainsAny(scheme, `/\`) {
		return "", "", fmt.Errorf("不支持的数据库协议 %q，请使用 SQLite 文件路径或 postgres:// 地址", scheme)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", "", fmt.Errorf("无法创建数据库目录：%w", err)
	}
	// modernc.org/sqlite applies pragmas per connection when they are part of
	// the DSN, so pooled connections inherit WAL and the busy timeout too.
	dsn = "file:" + filepath.ToSlash(abs) +
		"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)"
	return "sqlite", dsn, nil
}
