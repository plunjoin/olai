package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAdminSessionDoesNotAuthorizePortal(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	admin, err := db.CreateAdminAccount(ctx, "a1", "admin@example.com", "scrypt:salt:key", nil)
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	expires := time.Now().Add(time.Hour).UnixMilli()
	if err := db.CreateAdminSession(ctx, "admin-token", admin.ID, expires); err != nil {
		t.Fatalf("create admin session: %v", err)
	}
	if err := db.CreateSession(ctx, "portal-token", "u1", expires); err != nil {
		t.Fatalf("create portal session: %v", err)
	}

	if _, err := db.SessionUser(ctx, "admin-token"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("admin token must not resolve as a portal session, got %v", err)
	}
	if _, err := db.AdminSessionAccount(ctx, "portal-token"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("portal token must not resolve as an admin session, got %v", err)
	}
	if account, err := db.AdminSessionAccount(ctx, "admin-token"); err != nil || account.ID != admin.ID {
		t.Fatalf("admin token did not resolve to its account: %v", err)
	}
	if user, err := db.SessionUser(ctx, "portal-token"); err != nil || user.ID != "u1" {
		t.Fatalf("portal token did not resolve to its user: %v", err)
	}
}

func TestSeedLegacyAdminsCopiesOnlyScryptHashes(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	now := time.Now().UnixMilli()
	rows := []struct{ id, email, hash string }{
		{"u1", "admin@example.com", "scrypt:salt:key"},
		{"u2", "github@example.com", "oauth:github:42"},
	}
	for _, row := range rows {
		if _, err := db.ExecContext(ctx, `INSERT INTO users (id, email, password_hash, email_verified_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)`, row.id, row.email, row.hash, now, now, now); err != nil {
			t.Fatalf("insert user %s: %v", row.id, err)
		}
	}
	created, skipped, err := db.SeedLegacyAdmins(ctx, []string{"admin@example.com", "github@example.com", "missing@example.com"})
	if err != nil {
		t.Fatalf("seed legacy admins: %v", err)
	}
	if len(created) != 1 || created[0] != "admin@example.com" {
		t.Fatalf("created = %v, want [admin@example.com]", created)
	}
	if len(skipped) != 1 || skipped[0] != "github@example.com" {
		t.Fatalf("skipped = %v, want [github@example.com]", skipped)
	}
	account, err := db.AdminByEmail(ctx, "admin@example.com")
	if err != nil {
		t.Fatalf("read seeded admin: %v", err)
	}
	if account.PasswordHash != "scrypt:salt:key" {
		t.Fatalf("seeded hash = %q, want the portal hash copied once", account.PasswordHash)
	}
	againCreated, _, err := db.SeedLegacyAdmins(ctx, []string{"admin@example.com"})
	if err != nil {
		t.Fatalf("second seed: %v", err)
	}
	if len(againCreated) != 0 {
		t.Fatalf("seed must be a one-time bootstrap, created %v on second call", againCreated)
	}
}
