package store

import (
	"context"
	"path/filepath"
	"testing"

	"olai/internal/config"
)

func testDB(t *testing.T) *DB {
	t.Helper()
	ctx := context.Background()
	db, err := Open(ctx, config.Config{DatabaseURL: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Fatalf("open temp store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func insertUser(t *testing.T, db *DB, id string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO users (id, email, password_hash, created_at, updated_at)
		VALUES (?, ?, ?, 0, 0)`, id, id+"@example.com", "hash")
	if err != nil {
		t.Fatalf("insert user %s: %v", id, err)
	}
}

func balance(t *testing.T, db *DB, userID string) int64 {
	t.Helper()
	var value int64
	if err := db.QueryRowContext(context.Background(), `SELECT balance FROM point_accounts WHERE user_id = ?`, userID).Scan(&value); err != nil {
		t.Fatalf("read balance: %v", err)
	}
	return value
}

func remainder(t *testing.T, db *DB, userID string) int64 {
	t.Helper()
	var value int64
	if err := db.QueryRowContext(context.Background(), `SELECT hundredths FROM chat_point_remainders WHERE user_id = ?`, userID).Scan(&value); err != nil {
		t.Fatalf("read remainder: %v", err)
	}
	return value
}

func TestChatRemainderMath(t *testing.T) {
	if charged, next := chatRemainderTotal(40, 60); charged != 1 || next != 0 {
		t.Fatalf("chatRemainderTotal(40,60) = %d,%d", charged, next)
	}
	if charged, next := chatRemainderTotal(0, 50); charged != 0 || next != 50 {
		t.Fatalf("chatRemainderTotal(0,50) = %d,%d", charged, next)
	}
	if credit, next := chatRefundCredit(0, 50); credit != 1 || next != 50 {
		t.Fatalf("chatRefundCredit(0,50) = %d,%d", credit, next)
	}
	if credit, next := chatRefundCredit(80, 30); credit != 0 || next != 50 {
		t.Fatalf("chatRefundCredit(80,30) = %d,%d", credit, next)
	}
}

func TestChargeChatPointsAccumulates(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	if _, err := db.EnsurePointAccount(ctx, "u1", 10); err != nil {
		t.Fatalf("ensure account: %v", err)
	}
	for _, ref := range []string{"r1", "r2", "r3"} {
		got, charged, err := db.ChargeChatPoints(ctx, "u1", 50, ref, 0)
		if err != nil {
			t.Fatalf("charge %s: %v", ref, err)
		}
		if got == nil {
			t.Fatalf("charge %s reported insufficient balance", ref)
		}
		want := int64(0)
		if ref == "r2" {
			want = 1
		}
		if charged != want {
			t.Fatalf("charge %s charged %d whole points, want %d", ref, charged, want)
		}
	}
	if got := balance(t, db, "u1"); got != 9 {
		t.Fatalf("balance after three 0.5 messages = %d, want 9", got)
	}
	if got := remainder(t, db, "u1"); got != 50 {
		t.Fatalf("remainder = %d, want 50", got)
	}
}

func TestRefundChatPointsRollsBackAccumulation(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	if _, err := db.EnsurePointAccount(ctx, "u1", 10); err != nil {
		t.Fatalf("ensure account: %v", err)
	}
	for _, ref := range []string{"r1", "r2"} {
		if _, _, err := db.ChargeChatPoints(ctx, "u1", 50, ref, 0); err != nil {
			t.Fatalf("charge %s: %v", ref, err)
		}
	}
	if got := balance(t, db, "u1"); got != 9 {
		t.Fatalf("balance before refund = %d, want 9", got)
	}
	if err := db.RefundChatPoints(ctx, "u1", "r2"); err != nil {
		t.Fatalf("refund r2: %v", err)
	}
	if got := balance(t, db, "u1"); got != 10 {
		t.Fatalf("balance after refund = %d, want 10", got)
	}
	if got := remainder(t, db, "u1"); got != 50 {
		t.Fatalf("remainder after refund = %d, want 50", got)
	}
	// A second refund of the same charge is a no-op.
	if err := db.RefundChatPoints(ctx, "u1", "r2"); err != nil {
		t.Fatalf("repeat refund: %v", err)
	}
	if got := balance(t, db, "u1"); got != 10 {
		t.Fatalf("balance after repeat refund = %d, want 10", got)
	}
}

func TestChargeChatPointsInsufficientWritesNothing(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	got, needed, err := db.ChargeChatPoints(ctx, "u1", 250, "r1", 0)
	if err != nil {
		t.Fatalf("charge: %v", err)
	}
	if got != nil {
		t.Fatalf("balance = %v, want nil for insufficient funds", *got)
	}
	if needed != 2 {
		t.Fatalf("needed = %d, want 2", needed)
	}
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_point_charges WHERE ref_id = 'r1'`).Scan(&count); err != nil {
		t.Fatalf("count charges: %v", err)
	}
	if count != 0 {
		t.Fatalf("charge row written on insufficient balance")
	}
	if err := db.RefundChatPoints(ctx, "u1", "r1"); err != nil {
		t.Fatalf("refund: %v", err)
	}
	if got := balance(t, db, "u1"); got != 0 {
		t.Fatalf("balance after refund of rejected charge = %d, want 0", got)
	}
}

func TestChargeChatPointsZeroPriceFree(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	got, charged, err := db.ChargeChatPoints(ctx, "u1", 0, "r1", 0)
	if err != nil || got == nil || charged != 0 {
		t.Fatalf("zero-price charge = %v,%d,%v", got, charged, err)
	}
}
