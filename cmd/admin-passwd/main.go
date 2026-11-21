// Command admin-passwd creates or resets an independent admin console account.
// It is an operator tool: the console never shares portal credentials, so this
// is the recovery path when a console password is lost or an account was
// originally created through GitHub login.
//
//	go run ./cmd/admin-passwd -email admin@example.com
//
// With no -password, a random password is generated and printed once.
package main

import (
	"context"
	"crypto/rand"
	"flag"
	"fmt"
	"math/big"
	"net/mail"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"olai/internal/auth"
	"olai/internal/config"
	"olai/internal/store"
)

const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

func main() {
	email := flag.String("email", "", "后台管理员邮箱")
	password := flag.String("password", "", "新密码（8–128 位；留空自动生成并打印）")
	name := flag.String("name", "", "管理员昵称（可选）")
	flag.Parse()

	address := strings.ToLower(strings.TrimSpace(*email))
	if !validEmail(address) {
		fmt.Fprintln(os.Stderr, "请使用 -email 指定有效的管理员邮箱。")
		os.Exit(2)
	}
	generated := ""
	value := *password
	if value == "" {
		var err error
		generated, err = randomPassword(20)
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成密码失败：%v\n", err)
			os.Exit(1)
		}
		value = generated
	}
	if length := utf8.RuneCountInString(value); length < 8 || length > 128 {
		fmt.Fprintln(os.Stderr, "密码长度需为 8–128 位。")
		os.Exit(2)
	}

	hash, err := auth.PasswordHash(value, "")
	if err != nil {
		fmt.Fprintf(os.Stderr, "生成密码散列失败：%v\n", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := store.Open(ctx, config.Load())
	if err != nil {
		fmt.Fprintf(os.Stderr, "数据库初始化失败：%v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	var displayName *string
	if trimmed := strings.TrimSpace(*name); trimmed != "" {
		displayName = &trimmed
	}
	created, account, err := db.UpsertAdminAccount(ctx, address, hash, displayName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "保存管理员账号失败：%v\n", err)
		os.Exit(1)
	}
	if created {
		fmt.Printf("已创建后台管理员账号：%s\n", account.Email)
	} else {
		fmt.Printf("已重置后台管理员账号密码：%s（其他后台会话已失效）\n", account.Email)
	}
	if generated != "" {
		fmt.Printf("初始密码：%s\n请登录后台后立即修改，并妥善保存该密码。\n", generated)
	}
	fmt.Println("后台入口可在“系统设置 → 站点 → 后台入口路径”中查看。")
}

func validEmail(value string) bool {
	if value == "" || len(value) > 254 || !strings.Contains(value, "@") {
		return false
	}
	parsed, err := mail.ParseAddress(value)
	return err == nil && parsed.Address == value
}

func randomPassword(length int) (string, error) {
	out := make([]byte, length)
	for index := range out {
		number, err := rand.Int(rand.Reader, big.NewInt(int64(len(passwordAlphabet))))
		if err != nil {
			return "", err
		}
		out[index] = passwordAlphabet[number.Int64()]
	}
	return string(out), nil
}
