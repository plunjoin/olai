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

	portalDist, err := fs.Sub(webui.PortalFS, "portal/dist")
	if err != nil {
		log.Fatalf("portal 产物不可用：%v", err)
	}
	adminDist, err := fs.Sub(webui.AdminFS, "admin/dist")
	if err != nil {
		log.Fatalf("admin 产物不可用：%v", err)
	}
	frontends, err := server.LoadFrontends(portalDist, adminDist)
	if err != nil {
		log.Fatalf("前端运行时初始化失败：%v", err)
	}
	defer frontends.Close()

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

	log.Printf("Olai 已启动：http://%s（数据库：%s）", cfg.Addr(), db.Driver())
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("服务启动失败：%v", err)
	}
	fmt.Println("Olai 已停止。")
}
