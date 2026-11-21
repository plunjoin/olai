package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"time"
)

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

type PointLedgerEntry struct {
	Delta     int64  `json:"delta"`
	Reason    string `json:"reason"`
	RefID     string `json:"refId"`
	Note      string `json:"note"`
	CreatedAt int64  `json:"createdAt"`
}

type Invite struct {
	ID         string `json:"id"`
	InviterID  string `json:"inviterId"`
	InviteeID  string `json:"inviteeId"`
	Code       string `json:"code"`
	CreatedAt  int64  `json:"createdAt"`
	RewardedAt *int64 `json:"rewardedAt"`
}

// EnsurePointAccount creates the account and its signup ledger entry once.
func (d *DB) EnsurePointAccount(ctx context.Context, userID string, signupBonus int64) (int64, error) {
	now := time.Now().UnixMilli()
	var balance int64
	err := d.InTx(ctx, func(tx *Tx) error {
		result, err := tx.ExecContext(ctx, `INSERT INTO point_accounts (user_id, balance, updated_at)
			VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING`, userID, signupBonus, now)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows > 0 && signupBonus > 0 {
			_, err = tx.ExecContext(ctx, `INSERT INTO point_ledger (id, user_id, delta, reason, ref_id, created_at)
				VALUES (?, ?, ?, 'signup', ?, ?) ON CONFLICT (reason, ref_id) DO NOTHING`,
				newID(), userID, signupBonus, userID, now)
			if err != nil {
				return err
			}
		}
		return tx.QueryRowContext(ctx, `SELECT balance FROM point_accounts WHERE user_id = ?`, userID).Scan(&balance)
	})
	return balance, err
}

func (d *DB) BalanceOf(ctx context.Context, userID string, signupBonus int64) (int64, error) {
	var balance int64
	err := d.QueryRowContext(ctx, `SELECT balance FROM point_accounts WHERE user_id = ?`, userID).Scan(&balance)
	if errors.Is(err, sql.ErrNoRows) {
		return d.EnsurePointAccount(ctx, userID, signupBonus)
	}
	return balance, err
}

// ChargePoints deducts only when the balance is sufficient. Returns nil
// balance when the user cannot pay; the account is left untouched.
func (d *DB) ChargePoints(ctx context.Context, userID string, cost int64, refID string, signupBonus int64) (*int64, error) {
	if cost < 0 {
		return nil, errors.New("积分价格无效")
	}
	if _, err := d.EnsurePointAccount(ctx, userID, signupBonus); err != nil {
		return nil, err
	}
	if cost == 0 {
		balance, err := d.BalanceOf(ctx, userID, signupBonus)
		return &balance, err
	}
	now := time.Now().UnixMilli()
	var balance int64
	insufficient := false
	err := d.InTx(ctx, func(tx *Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE point_accounts SET balance = balance - ?, updated_at = ?
			WHERE user_id = ? AND balance >= ?`, cost, now, userID, cost)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			insufficient = true
			return nil
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO point_ledger (id, user_id, delta, reason, ref_id, created_at)
			VALUES (?, ?, ?, 'spend', ?, ?)`, newID(), userID, -cost, refID, now); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT balance FROM point_accounts WHERE user_id = ?`, userID).Scan(&balance)
	})
	if err != nil {
		return nil, err
	}
	if insufficient {
		return nil, nil
	}
	return &balance, nil
}

// ---- fractional chat points ----
//
// Chat prices may carry two decimals. The fractional part is accumulated per
// user in hundredths of a point and only whole points are charged when the
// running total crosses a point (0.5 per message → one point every two
// messages). Every charge keeps a row so a failed request can be refunded
// exactly once and the accumulation rolled back.

func chatRemainderTotal(remainder, hundredths int64) (charged, next int64) {
	total := remainder + hundredths
	return total / 100, total % 100
}

func chatRefundCredit(remainder, hundredths int64) (credit, next int64) {
	next = remainder - hundredths
	if next < 0 {
		credit = (-next + 99) / 100
		next = (next%100 + 100) % 100
	}
	return credit, next
}

// ChargeChatPoints applies a chat price given in hundredths of a point. It
// returns a nil balance and the whole points the message would need when the
// account cannot pay; nothing is written in that case.
func (d *DB) ChargeChatPoints(ctx context.Context, userID string, hundredths int64, refID string, signupBonus int64) (*int64, int64, error) {
	if hundredths < 0 {
		return nil, 0, errors.New("积分价格无效")
	}
	if _, err := d.EnsurePointAccount(ctx, userID, signupBonus); err != nil {
		return nil, 0, err
	}
	if hundredths == 0 {
		balance, err := d.BalanceOf(ctx, userID, signupBonus)
		return &balance, 0, err
	}
	now := time.Now().UnixMilli()
	if _, err := d.ExecContext(ctx, `INSERT INTO chat_point_remainders (user_id, hundredths, updated_at)
		VALUES (?, 0, ?) ON CONFLICT (user_id) DO NOTHING`, userID, now); err != nil {
		return nil, 0, err
	}
	lock := ""
	if d.Postgres() {
		lock = " FOR UPDATE"
	}
	var balance int64
	var charged int64
	insufficient := false
	err := d.InTx(ctx, func(tx *Tx) error {
		var remainder int64
		err := tx.QueryRowContext(ctx, `SELECT hundredths FROM chat_point_remainders WHERE user_id = ?`+lock, userID).Scan(&remainder)
		if err != nil {
			return err
		}
		charged, remainder = chatRemainderTotal(remainder, hundredths)
		if charged > 0 {
			result, err := tx.ExecContext(ctx, `UPDATE point_accounts SET balance = balance - ?, updated_at = ?
				WHERE user_id = ? AND balance >= ?`, charged, now, userID, charged)
			if err != nil {
				return err
			}
			rows, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if rows == 0 {
				insufficient = true
				return nil
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO point_ledger (id, user_id, delta, reason, ref_id, created_at)
				VALUES (?, ?, ?, 'spend', ?, ?)`, newID(), userID, -charged, refID, now); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO chat_point_charges (ref_id, user_id, hundredths, whole, created_at)
			VALUES (?, ?, ?, ?, ?)`, refID, userID, hundredths, charged, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE chat_point_remainders SET hundredths = ?, updated_at = ? WHERE user_id = ?`,
			remainder, now, userID); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT balance FROM point_accounts WHERE user_id = ?`, userID).Scan(&balance)
	})
	if err != nil {
		return nil, 0, err
	}
	if insufficient {
		return nil, charged, nil
	}
	return &balance, charged, nil
}

// RefundChatPoints reverses one chat charge and any whole points the
// accumulation had triggered. Repeated calls are no-ops.
func (d *DB) RefundChatPoints(ctx context.Context, userID, refID string) error {
	now := time.Now().UnixMilli()
	return d.InTx(ctx, func(tx *Tx) error {
		var hundredths int64
		err := tx.QueryRowContext(ctx, `SELECT hundredths FROM chat_point_charges
			WHERE ref_id = ? AND user_id = ? AND refunded_at IS NULL`, refID, userID).Scan(&hundredths)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE chat_point_charges SET refunded_at = ?
			WHERE ref_id = ? AND refunded_at IS NULL`, now, refID)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return nil
		}
		var remainder int64
		if err := tx.QueryRowContext(ctx, `SELECT hundredths FROM chat_point_remainders WHERE user_id = ?`, userID).Scan(&remainder); err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			remainder = 0
		}
		credit, next := chatRefundCredit(remainder, hundredths)
		if credit > 0 {
			if _, err := tx.ExecContext(ctx, `INSERT INTO point_ledger (id, user_id, delta, reason, ref_id, created_at)
				VALUES (?, ?, ?, 'refund', ?, ?)`, newID(), userID, credit, refID, now); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE point_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
				credit, now, userID); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE chat_point_remainders SET hundredths = ?, updated_at = ? WHERE user_id = ?`,
			next, now, userID)
		return err
	})
}

var ErrAlreadyCredited = errors.New("already credited")

// CreditPoints appends a ledger entry and adds to the balance. The unique
// (reason, ref_id) index makes repeated refunds and invite rewards idempotent.
func (d *DB) CreditPoints(ctx context.Context, userID string, amount int64, reason, refID, note string, signupBonus int64) error {
	if amount <= 0 {
		return nil
	}
	if _, err := d.EnsurePointAccount(ctx, userID, signupBonus); err != nil {
		return err
	}
	err := d.InTx(ctx, func(tx *Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO point_ledger (id, user_id, delta, reason, ref_id, note, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, newID(), userID, amount, reason, refID, note, time.Now().UnixMilli())
		if IsUniqueViolation(err) {
			return ErrAlreadyCredited
		}
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE point_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
			amount, time.Now().UnixMilli(), userID)
		return err
	})
	if errors.Is(err, ErrAlreadyCredited) {
		return nil
	}
	return err
}

// AdjustPoints applies an administrator delta with a ledger note. A negative
// delta fails without changing anything when the balance would go below zero.
func (d *DB) AdjustPoints(ctx context.Context, userID string, delta int64, ref, note string, signupBonus int64) (*int64, error) {
	if _, err := d.EnsurePointAccount(ctx, userID, signupBonus); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	var balance int64
	insufficient := false
	err := d.InTx(ctx, func(tx *Tx) error {
		if delta < 0 {
			result, err := tx.ExecContext(ctx, `UPDATE point_accounts SET balance = balance + ?, updated_at = ?
				WHERE user_id = ? AND balance >= ?`, delta, now, userID, -delta)
			if err != nil {
				return err
			}
			rows, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if rows == 0 {
				insufficient = true
				return nil
			}
		} else {
			if _, err := tx.ExecContext(ctx, `UPDATE point_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
				delta, now, userID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO point_ledger (id, user_id, delta, reason, ref_id, note, created_at)
			VALUES (?, ?, ?, 'admin-adjust', ?, ?, ?)`, newID(), userID, delta, ref, note, now); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT balance FROM point_accounts WHERE user_id = ?`, userID).Scan(&balance)
	})
	if err != nil {
		return nil, err
	}
	if insufficient {
		return nil, nil
	}
	return &balance, nil
}

// ---- invite codes and relationships ----

func randomInviteCode() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	out := make([]byte, 8)
	for i, b := range buf {
		out[i] = inviteAlphabet[int(b)%len(inviteAlphabet)]
	}
	return string(out)
}

func (d *DB) EnsureInviteCode(ctx context.Context, userID string) (string, error) {
	var code string
	err := d.QueryRowContext(ctx, `SELECT code FROM invite_codes WHERE user_id = ?`, userID).Scan(&code)
	if err == nil {
		return code, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	for attempt := 0; attempt < 5; attempt++ {
		candidate := randomInviteCode()
		_, err := d.ExecContext(ctx, `INSERT INTO invite_codes (code, user_id, created_at) VALUES (?, ?, ?)
			ON CONFLICT (code) DO NOTHING`, candidate, userID, time.Now().UnixMilli())
		if err != nil {
			return "", err
		}
		var existing string
		if err := d.QueryRowContext(ctx, `SELECT code FROM invite_codes WHERE user_id = ?`, userID).Scan(&existing); err == nil {
			return existing, nil
		}
	}
	return "", errors.New("邀请码生成失败，请重试")
}

func (d *DB) InviterByCode(ctx context.Context, code string) (string, error) {
	var userID string
	err := d.QueryRowContext(ctx, `SELECT user_id FROM invite_codes WHERE code = ?`, code).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return userID, err
}

func (d *DB) AcceptInvite(ctx context.Context, inviterID, inviteeID, code string) error {
	if inviterID == "" || inviterID == inviteeID {
		return nil
	}
	_, err := d.ExecContext(ctx, `INSERT INTO invites (id, inviter_id, invitee_id, code, created_at)
		VALUES (?, ?, ?, ?, ?) ON CONFLICT (invitee_id) DO NOTHING`,
		newID(), inviterID, inviteeID, code, time.Now().UnixMilli())
	return err
}

type inviteRow struct {
	ID, InviterID, InviteeID, Code string
	CreatedAt                      int64
	RewardedAt                     *int64
}

// MaybeRewardInvite grants both sides once, after the invitee's first
// successful generation, honoring the inviter's daily reward cap.
func (d *DB) MaybeRewardInvite(ctx context.Context, inviteeID string, reward, bonus, dailyLimit int64, dayStart int64, signupBonus int64) error {
	var inviterID string
	if err := d.QueryRowContext(ctx, `SELECT inviter_id FROM invites WHERE invitee_id = ? AND rewarded_at IS NULL`, inviteeID).Scan(&inviterID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	var today int64
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM invites WHERE inviter_id = ? AND rewarded_at >= ?`,
		inviterID, dayStart).Scan(&today); err != nil {
		return err
	}
	if today >= dailyLimit {
		return nil
	}
	err := d.InTx(ctx, func(tx *Tx) error {
		now := time.Now().UnixMilli()
		credit := func(userID string, amount int64, reason, ref string) error {
			if amount <= 0 {
				return nil
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO point_ledger (id, user_id, delta, reason, ref_id, created_at)
				VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (reason, ref_id) DO NOTHING`,
				newID(), userID, amount, reason, ref, now)
			if err != nil {
				return err
			}
			_, err = tx.ExecContext(ctx, `UPDATE point_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
				amount, now, userID)
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO point_accounts (user_id, balance, updated_at)
			VALUES (?, 0, ?) ON CONFLICT (user_id) DO NOTHING`, inviterID, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO point_accounts (user_id, balance, updated_at)
			VALUES (?, 0, ?) ON CONFLICT (user_id) DO NOTHING`, inviteeID, now); err != nil {
			return err
		}
		if err := credit(inviterID, reward, "invite", "invite:"+inviteeID); err != nil {
			return err
		}
		if err := credit(inviteeID, bonus, "invite-bonus", "invite-bonus:"+inviteeID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE invites SET rewarded_at = ? WHERE invitee_id = ? AND rewarded_at IS NULL`,
			now, inviteeID)
		return err
	})
	return err
}

func (d *DB) InviteStats(ctx context.Context, userID string) (invited, rewarded int64, err error) {
	err = d.QueryRowContext(ctx, `SELECT COUNT(*), CAST(COALESCE(SUM(CASE WHEN rewarded_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS BIGINT)
		FROM invites WHERE inviter_id = ?`, userID).Scan(&invited, &rewarded)
	return
}

func (d *DB) RecentPoints(ctx context.Context, userID string, limit int) ([]PointLedgerEntry, error) {
	rows, err := d.QueryContext(ctx, `SELECT delta, reason, ref_id, note, created_at FROM point_ledger
		WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]PointLedgerEntry, 0, limit)
	for rows.Next() {
		var entry PointLedgerEntry
		if err := rows.Scan(&entry.Delta, &entry.Reason, &entry.RefID, &entry.Note, &entry.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

func (d *DB) ListInvites(ctx context.Context, limit, offset int) ([]Invite, error) {
	rows, err := d.QueryContext(ctx, `SELECT id, inviter_id, invitee_id, code, created_at, rewarded_at
		FROM invites ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invite
	for rows.Next() {
		var item Invite
		var rewarded sql.NullInt64
		if err := rows.Scan(&item.ID, &item.InviterID, &item.InviteeID, &item.Code, &item.CreatedAt, &rewarded); err != nil {
			return nil, err
		}
		item.RewardedAt = nullableInt(rewarded)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (d *DB) CountInvites(ctx context.Context) (int64, error) {
	var count int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM invites`).Scan(&count)
	return count, err
}
