package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestOAuthLinkAndPasswordMarker(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	insertUser(t, db, "user-1")
	insertUser(t, db, "user-2")

	if err := db.LinkOAuth(ctx, "google", "sub-1", "user-1"); err != nil {
		t.Fatalf("link oauth: %v", err)
	}
	user, err := db.OAuthUser(ctx, "google", "sub-1")
	if err != nil {
		t.Fatalf("read oauth user: %v", err)
	}
	if user.ID != "user-1" {
		t.Fatalf("oauth user = %s, want user-1", user.ID)
	}
	if err := db.LinkOAuth(ctx, "google", "sub-1", "user-1"); err != nil {
		t.Fatalf("idempotent link: %v", err)
	}
	if err := db.LinkOAuth(ctx, "google", "sub-1", "user-2"); !errors.Is(err, ErrOAuthAlreadyLinked) {
		t.Fatalf("conflicting link error = %v, want ErrOAuthAlreadyLinked", err)
	}
	if marker := OAuthPasswordMarker("google", "sub-1"); marker != "oauth:google:sub-1" {
		t.Fatalf("marker = %q", marker)
	}
	if !IsOAuthPasswordHash("oauth:google:sub-1") {
		t.Fatal("oauth marker should be recognized")
	}
	if IsOAuthPasswordHash("scrypt:salt:hash") {
		t.Fatal("scrypt hash must not be treated as an oauth marker")
	}
}

func TestTakeOverOAuthUserRevokesSessions(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	insertUser(t, db, "user-1")
	const tokenHash = "session-hash"
	if err := db.CreateSession(ctx, tokenHash, "user-1", time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatalf("create session: %v", err)
	}
	marker := OAuthPasswordMarker("google", "sub-1")
	if err := db.TakeOverOAuthUser(ctx, "user-1", marker); err != nil {
		t.Fatalf("take over: %v", err)
	}
	user, err := db.UserByID(ctx, "user-1")
	if err != nil {
		t.Fatalf("reload user: %v", err)
	}
	if user.PasswordHash != marker || user.EmailVerifiedAt == nil {
		t.Fatalf("user was not converted to an oauth-only account: %#v", user)
	}
	if _, err := db.SessionUser(ctx, tokenHash); !errors.Is(err, ErrNotFound) {
		t.Fatalf("session still valid after takeover: %v", err)
	}
}

func TestDeleteUserRemovesOAuthAccounts(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	insertUser(t, db, "user-1")
	if err := db.LinkOAuth(ctx, "google", "sub-1", "user-1"); err != nil {
		t.Fatalf("link oauth: %v", err)
	}
	if err := db.DeleteUser(ctx, "user-1"); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	if _, err := db.OAuthUser(ctx, "google", "sub-1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("oauth row survived account deletion: %v", err)
	}
}
