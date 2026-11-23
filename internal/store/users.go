package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type User struct {
	ID              string
	Email           string
	PasswordHash    string
	EmailVerifiedAt *int64
	Name            *string
	Avatar          *string
	CreatedAt       int64
	UpdatedAt       int64
}

type SessionUser struct {
	ID     string  `json:"id"`
	Email  string  `json:"email"`
	Name   *string `json:"name,omitempty"`
	Avatar *string `json:"avatar,omitempty"`
}

var (
	ErrNotFound           = errors.New("not found")
	ErrOAuthAlreadyLinked = errors.New("oauth account already linked")
)

// DisplayName is the nickname, or the mailbox name before @ when the nickname
// was left empty. The domain is never part of it, matching the account page.
func DisplayName(name, email string) string {
	name = strings.TrimSpace(name)
	if name != "" {
		return name
	}
	if at := strings.IndexByte(email, '@'); at > 0 {
		return email[:at]
	}
	return ""
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	v := value.String
	return &v
}

func nullableInt(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	v := value.Int64
	return &v
}

const userColumns = `id, email, password_hash, email_verified_at, name, avatar, created_at, updated_at`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	var verified sql.NullInt64
	var name, avatar sql.NullString
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &verified, &name, &avatar, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	u.EmailVerifiedAt = nullableInt(verified)
	u.Name = nullableString(name)
	u.Avatar = nullableString(avatar)
	return &u, nil
}

func (d *DB) UserByEmail(ctx context.Context, email string) (*User, error) {
	return scanUser(d.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE email = ?`, email))
}

func (d *DB) UserByID(ctx context.Context, id string) (*User, error) {
	return scanUser(d.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE id = ?`, id))
}

// The admin console publishes official works through a real portal account,
// because works reference users(id) and their media must belong to that same
// account. The account cannot sign in (its password hash is not a scrypt
// value) and is hidden from user-management views by users.system.
const (
	OfficialUserID    = "olai-official"
	OfficialUserEmail = "official@olai.invalid"
	OfficialUserName  = "Olai 官方"
	officialHandle    = "official"
)

// EnsureSystemUser creates the official publisher account on first use and
// returns its id. It is safe to call on every admin work creation.
func (d *DB) EnsureSystemUser(ctx context.Context) (string, error) {
	now := time.Now().UnixMilli()
	if _, err := d.ExecContext(ctx, `INSERT INTO users (id, email, password_hash, email_verified_at, name, system, created_at, updated_at)
		VALUES (?, ?, 'system:no-login', NULL, ?, 1, ?, ?) ON CONFLICT DO NOTHING`,
		OfficialUserID, OfficialUserEmail, OfficialUserName, now, now); err != nil {
		return "", err
	}
	if _, err := d.UserByID(ctx, OfficialUserID); err != nil {
		return "", err
	}
	if _, err := d.EnsureProfile(ctx, OfficialUserID, officialHandle); err != nil {
		return "", err
	}
	return OfficialUserID, nil
}

func (d *DB) CreateUser(ctx context.Context, id, email, passwordHash string, verified bool) (*User, error) {
	now := time.Now().UnixMilli()
	var verifiedAt any = nil
	if verified {
		verifiedAt = now
	}
	_, err := d.ExecContext(ctx, `INSERT INTO users (id, email, password_hash, email_verified_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)`, id, email, passwordHash, verifiedAt, now, now)
	if err != nil {
		return nil, err
	}
	return d.UserByID(ctx, id)
}

// UpdateUserProfile stores a nil name or avatar as NULL. A missing name means
// the account keeps showing the email prefix fallback.
func (d *DB) UpdateUserProfile(ctx context.Context, id string, name, avatar *string) error {
	var nameValue, avatarValue any
	if name != nil {
		nameValue = *name
	}
	if avatar != nil {
		avatarValue = *avatar
	}
	_, err := d.ExecContext(ctx, `UPDATE users SET name = ?, avatar = ?, updated_at = ? WHERE id = ?`,
		nameValue, avatarValue, time.Now().UnixMilli(), id)
	return err
}

func (d *DB) MarkEmailVerified(ctx context.Context, id string) error {
	now := time.Now().UnixMilli()
	_, err := d.ExecContext(ctx, `UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?`, now, now, id)
	return err
}

func (d *DB) UpdatePassword(ctx context.Context, id, passwordHash string) error {
	now := time.Now().UnixMilli()
	_, err := d.ExecContext(ctx, `UPDATE users SET password_hash = ?, email_verified_at = ?, updated_at = ? WHERE id = ?`,
		passwordHash, now, now, id)
	return err
}

func (d *DB) DeleteUser(ctx context.Context, id string) error {
	return d.InTx(ctx, func(tx *Tx) error {
		for _, query := range []string{
			`DELETE FROM email_tokens WHERE user_id = ?`,
			`DELETE FROM invites WHERE inviter_id = ? OR invitee_id = ?`,
			`DELETE FROM sessions WHERE user_id = ?`,
			// An orphaned oauth identity would block the same provider account
			// from being linked again after the user is recreated.
			`DELETE FROM oauth_accounts WHERE user_id = ?`,
			// Foreign-key cascades are not guaranteed on every SQLite connection,
			// so memory rows are removed explicitly with the account.
			`DELETE FROM user_memories WHERE user_id = ?`,
			`DELETE FROM user_memory_settings WHERE user_id = ?`,
			`DELETE FROM gallery_comments WHERE user_id = ?`,
			`DELETE FROM gallery_favorites WHERE user_id = ?`,
			`DELETE FROM favorite_folders WHERE user_id = ?`,
			`DELETE FROM user_follows WHERE follower_id = ? OR followee_id = ?`,
			`DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?`,
			`DELETE FROM direct_messages WHERE sender_id = ?`,
			`DELETE FROM direct_reads WHERE user_id = ?`,
			`DELETE FROM direct_conversations WHERE low_user_id = ? OR high_user_id = ?`,
			`DELETE FROM user_profiles WHERE user_id = ?`,
		} {
			args := []any{id}
			if strings.Count(query, "?") == 2 {
				args = []any{id, id}
			}
			if _, err := tx.ExecContext(ctx, query, args...); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
		return err
	})
}

// ---- sessions ----

func (d *DB) CreateSession(ctx context.Context, tokenHash, userID string, expiresAt int64) error {
	_, err := d.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		tokenHash, userID, expiresAt, time.Now().UnixMilli())
	return err
}

func (d *DB) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (d *DB) DeleteUserSessions(ctx context.Context, userID string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

func (d *DB) SessionUser(ctx context.Context, tokenHash string) (*SessionUser, error) {
	var u SessionUser
	var name, avatar sql.NullString
	err := d.QueryRowContext(ctx, `SELECT u.id, u.email, u.name, u.avatar
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, time.Now().UnixMilli()).
		Scan(&u.ID, &u.Email, &name, &avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	u.Name = nullableString(name)
	u.Avatar = nullableString(avatar)
	return &u, nil
}

// ---- email tokens ----

func (d *DB) DeleteEmailTokens(ctx context.Context, userID, purpose string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?`, userID, purpose)
	return err
}

func (d *DB) InsertEmailToken(ctx context.Context, tokenHash, userID, purpose string, expiresAt int64) error {
	_, err := d.ExecContext(ctx, `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?)`, tokenHash, userID, purpose, expiresAt, time.Now().UnixMilli())
	return err
}

func (d *DB) EmailTokenUser(ctx context.Context, tokenHash, purpose string) (string, error) {
	var userID string
	err := d.QueryRowContext(ctx, `SELECT user_id FROM email_tokens
		WHERE token_hash = ? AND purpose = ? AND expires_at > ?`,
		tokenHash, purpose, time.Now().UnixMilli()).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return userID, err
}

// ConsumeEmailToken deletes and returns the owning user in one statement, so
// two concurrent link clicks cannot both succeed.
func (d *DB) ConsumeEmailToken(ctx context.Context, tokenHash, purpose string) (string, error) {
	var userID string
	err := d.QueryRowContext(ctx, `DELETE FROM email_tokens
		WHERE token_hash = ? AND purpose = ? AND expires_at > ?
		RETURNING user_id`, tokenHash, purpose, time.Now().UnixMilli()).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return userID, err
}

// ---- oauth ----

// OAuthPasswordMarker is the non-login password_hash stored for accounts that
// only use a third-party provider. auth.VerifyPassword rejects the shape.
func OAuthPasswordMarker(provider, providerID string) string {
	return "oauth:" + provider + ":" + providerID
}

func IsOAuthPasswordHash(hash string) bool {
	return strings.HasPrefix(hash, "oauth:")
}

func (d *DB) OAuthUser(ctx context.Context, provider, providerID string) (*User, error) {
	return scanUser(d.QueryRowContext(ctx, `SELECT u.id, u.email, u.password_hash, u.email_verified_at,
		u.name, u.avatar, u.created_at, u.updated_at
		FROM oauth_accounts o JOIN users u ON u.id = o.user_id
		WHERE o.provider = ? AND o.provider_id = ?`, provider, providerID))
}

// LinkOAuth links a provider identity to a user. Re-linking the same pair is a
// no-op; linking it to a different user reports ErrOAuthAlreadyLinked so the
// caller can follow the identity that won a concurrent race.
func (d *DB) LinkOAuth(ctx context.Context, provider, providerID, userID string) error {
	result, err := d.ExecContext(ctx, `INSERT INTO oauth_accounts (provider, provider_id, user_id, created_at)
		VALUES (?, ?, ?, ?) ON CONFLICT (provider, provider_id) DO NOTHING`,
		provider, providerID, userID, time.Now().UnixMilli())
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected > 0 {
		return nil
	}
	var existing string
	err = d.QueryRowContext(ctx, `SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_id = ?`,
		provider, providerID).Scan(&existing)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if existing != userID {
		return ErrOAuthAlreadyLinked
	}
	return nil
}

// TakeOverOAuthUser converts an unverified local signup into an OAuth-only
// account and signs out every existing session in the same transaction. The
// unverified address could belong to someone else, so a password reset link
// alone must not grant access after the provider has proven ownership.
func (d *DB) TakeOverOAuthUser(ctx context.Context, id, passwordHash string) error {
	return d.InTx(ctx, func(tx *Tx) error {
		now := time.Now().UnixMilli()
		if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ?, email_verified_at = ?, updated_at = ? WHERE id = ?`,
			passwordHash, now, now, id); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, id)
		return err
	})
}

// ---- bans ----

func (d *DB) IsBanned(ctx context.Context, userID string) (bool, error) {
	var count int
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_bans WHERE user_id = ?`, userID).Scan(&count)
	return count > 0, err
}

func (d *DB) BanUser(ctx context.Context, userID, reason, adminID string, bannedAt int64) error {
	return d.InTx(ctx, func(tx *Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO user_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (user_id) DO UPDATE SET reason = ?, banned_by = ?, banned_at = ?`,
			userID, reason, adminID, bannedAt, reason, adminID, bannedAt)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
		return err
	})
}

func (d *DB) UnbanUser(ctx context.Context, userID string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM user_bans WHERE user_id = ?`, userID)
	return err
}
