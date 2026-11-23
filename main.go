// Command olai runs the Olai server: Go HTTP API plus the Vue SPA compiled by
// webfront. No Node.js runtime or build is used by the binary. The embed
// directives must live in this package because //go:embed cannot traverse up.
package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"olai/internal/config"
	"olai/internal/server"
	"olai/internal/settings"
	"olai/internal/store"
	appversion "olai/internal/version"
	webui "olai/web"
)

//go:embed all:public
var publicAssets embed.FS

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	db, err := store.Open(ctx, cfg)
	cancel()
	if err != nil {
		log.Fatalf("数据库初始化失败：%v", err)
	}
	defer db.Close()

	// 生产构建读嵌入 dist；-tags dev 返回 nil，页面由 DevServer 现场编译。
	frontends, err := loadFrontends()
	if err != nil {
		log.Fatalf("前端运行时初始化失败：%v", err)
	}
	if frontends != nil {
		defer frontends.Close()
	}

	public, err := fs.Sub(publicAssets, "public")
	if err != nil {
		log.Fatalf("静态资源不可用：%v", err)
	}

	settingsManager := settings.New(db)
	bootstrapCtx, bootstrapCancel := context.WithTimeout(context.Background(), 20*time.Second)
	if err := settingsManager.SeedEnv(bootstrapCtx); err != nil {
		log.Printf("导入 .env 配置到 SQLite 失败（继续使用环境变量）：%v", err)
	}
	if err := db.EnsureSetupComplete(bootstrapCtx); err != nil {
		log.Printf("检查安装状态失败：%v", err)
	}
	bootstrapCancel()
	settingsManager.Refresh(context.Background(), true)

	// The admin console keeps its own accounts. Existing installations get one
	// console account per legacy ADMIN_EMAILS entry on first start after the
	// split; the copied password hash is a one-time bootstrap only.
	migrateCtx, migrateCancel := context.WithTimeout(context.Background(), 20*time.Second)
	created, skipped, migrateErr := db.SeedLegacyAdmins(migrateCtx, settingsManager.LegacyAdminEmails(migrateCtx))
	migrateCancel()
	if migrateErr != nil {
		log.Printf("迁移存量管理员账号失败：%v", migrateErr)
	} else {
		if len(created) > 0 {
			log.Printf("已创建独立后台管理员账号：%s（初始密码沿用原门户密码，请登录后立即修改）", strings.Join(created, ", "))
		}
		if len(skipped) > 0 {
			log.Printf("以下管理员没有可用的门户密码，请运行 go run ./cmd/admin-passwd -email <邮箱> 设置后台密码：%s", strings.Join(skipped, ", "))
		}
	}

	app := server.New(cfg, db, frontends, public)
	// -tags dev：在 settings.Refresh 之后启动 portal/admin 开发服务器；
	// 正式构建里 AttachDev 是空操作。
	if err := app.AttachDev("web/portal", "web/admin"); err != nil {
		log.Fatalf("开发前端启动失败：%v", err)
	}
	defer app.CloseDev()

	httpServer := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           app.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer shutdownCancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	log.Printf("Olai %s 已启动：http://%s（数据库：%s）", appversion.Current().Version, cfg.Addr(), db.Driver())
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("服务启动失败：%v", err)
	}
	fmt.Println("Olai 已停止。")
}

// loadFrontends 读取嵌入的 dist 产物并启动生产 SSR 池。开发构建不读 dist，
// 页面与 SSR 都由 DevServer 现场编译，因此可以在没有 dist 的源码树上启动。
func loadFrontends() (*server.Frontends, error) {
	if server.DevBuild() {
		return nil, nil
	}
	portalDist, err := fs.Sub(webui.PortalFS, "portal/dist")
	if err != nil {
		return nil, fmt.Errorf("portal 产物不可用：%w", err)
	}
	adminDist, err := fs.Sub(webui.AdminFS, "admin/dist")
	if err != nil {
		return nil, fmt.Errorf("admin 产物不可用：%w", err)
	}
	return server.LoadFrontends(portalDist, adminDist)
}
