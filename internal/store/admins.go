package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// AdminAccount is the console's own identity. It is intentionally unrelated to
// User: the portal account table and the admin account table never join, so
// neither login path can authenticate the other.
type AdminAccount struct {
	ID           string  `json:"id"`
	Email        string  `json:"email"`
	PasswordHash string  `json:"-"`
	Name         *string `json:"name,omitempty"`
	LastLoginAt  *int64  `json:"lastLoginAt,omitempty"`
	CreatedAt    int64   `json:"createdAt"`
	UpdatedAt    int64   `json:"updatedAt"`
}

const adminColumns = `id, email, password_hash, name, last_login_at, created_at, updated_at`

func scanAdmin(row interface{ Scan(...any) error }) (*AdminAccount, error) {
	var admin AdminAccount
	var name sql.NullString
	var lastLogin sql.NullInt64
	err := row.Scan(&admin.ID, &admin.Email, &admin.PasswordHash, &name, &lastLogin, &admin.CreatedAt, &admin.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	admin.Name = nullableString(name)
	admin.LastLoginAt = nullableInt(lastLogin)
	return &admin, nil
}

func (d *DB) AdminByEmail(ctx context.Context, email string) (*AdminAccount, error) {
	return scanAdmin(d.QueryRowContext(ctx, `SELECT `+adminColumns+` FROM admin_accounts WHERE email = ?`, email))
}

func (d *DB) AdminByID(ctx context.Context, id string) (*AdminAccount, error) {
	return scanAdmin(d.QueryRowContext(ctx, `SELECT `+adminColumns+` FROM admin_accounts WHERE id = ?`, id))
}

func (d *DB) AdminCount(ctx context.Context) (int64, error) {
	var count int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_accounts`).Scan(&count)
	return count, err
}

func (d *DB) CreateAdminAccount(ctx context.Context, id, email, passwordHash string, name *string) (*AdminAccount, error) {
	now := time.Now().UnixMilli()
	var nameValue any
	if name != nil {
		nameValue = *name
	}
	if _, err := d.ExecContext(ctx, `INSERT INTO admin_accounts
		(id, email, password_hash, name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)`, id, email, passwordHash, nameValue, now, now); err != nil {
		return nil, err
	}
	return d.AdminByID(ctx, id)
}

// UpsertAdminAccount is the operator path (cmd/admin-passwd): it creates a
// missing console account or replaces the password of an existing one, then
// revokes every existing console session for that account.
func (d *DB) UpsertAdminAccount(ctx context.Context, email, passwordHash string, name *string) (bool, *AdminAccount, error) {
	existing, err := d.AdminByEmail(ctx, email)
	if err == nil {
		now := time.Now().UnixMilli()
		var update error
		if name != nil {
			_, update = d.ExecContext(ctx, `UPDATE admin_accounts SET password_hash = ?, name = ?, updated_at = ? WHERE id = ?`,
				passwordHash, *name, now, existing.ID)
		} else {
			_, update = d.ExecContext(ctx, `UPDATE admin_accounts SET password_hash = ?, updated_at = ? WHERE id = ?`,
				passwordHash, now, existing.ID)
		}
		if update != nil {
			return false, nil, update
		}
		if err := d.DeleteAdminSessions(ctx, existing.ID); err != nil {
			return false, nil, err
		}
		account, err := d.AdminByID(ctx, existing.ID)
		return false, account, err
	}
	if !errors.Is(err, ErrNotFound) {
		return false, nil, err
	}
	account, err := d.CreateAdminAccount(ctx, newID(), email, passwordHash, name)
	return true, account, err
}

func (d *DB) SetAdminPassword(ctx context.Context, id, passwordHash string) error {
	_, err := d.ExecContext(ctx, `UPDATE admin_accounts SET password_hash = ?, updated_at = ? WHERE id = ?`,
		passwordHash, time.Now().UnixMilli(), id)
	return err
}

func (d *DB) TouchAdminLogin(ctx context.Context, id string, at int64) error {
	_, err := d.ExecContext(ctx, `UPDATE admin_accounts SET last_login_at = ? WHERE id = ?`, at, id)
	return err
}

// ---- admin sessions ----

func (d *DB) CreateAdminSession(ctx context.Context, tokenHash, adminID string, expiresAt int64) error {
	_, err := d.ExecContext(ctx, `INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at)
		VALUES (?, ?, ?, ?)`, tokenHash, adminID, expiresAt, time.Now().UnixMilli())
	return err
}

func (d *DB) DeleteAdminSession(ctx context.Context, tokenHash string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM admin_sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (d *DB) DeleteAdminSessions(ctx context.Context, adminID string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM admin_sessions WHERE admin_id = ?`, adminID)
	return err
}

func (d *DB) AdminSessionAccount(ctx context.Context, tokenHash string) (*AdminAccount, error) {
	return scanAdmin(d.QueryRowContext(ctx, `SELECT a.id, a.email, a.password_hash, a.name,
		a.last_login_at, a.created_at, a.updated_at
		FROM admin_sessions s JOIN admin_accounts a ON a.id = s.admin_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, time.Now().UnixMilli()))
}

// SeedLegacyAdmins gives existing installations a console account on first
// start after the split. It only runs while no console account exists and only
// copies portal passwords that are real scrypt hashes; GitHub-only users must
// have a console password set with cmd/admin-passwd. The copied hash is a
// one-time bootstrap, not a live link: later portal password changes do not
// affect the console account.
func (d *DB) SeedLegacyAdmins(ctx context.Context, emails []string) (created, skipped []string, err error) {
	count, err := d.AdminCount(ctx)
	if err != nil {
		return nil, nil, err
	}
	if count > 0 {
		return nil, nil, nil
	}
	seen := make(map[string]bool, len(emails))
	for _, raw := range emails {
		email := strings.ToLower(strings.TrimSpace(raw))
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		user, err := d.UserByEmail(ctx, email)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return created, skipped, err
		}
		if !strings.HasPrefix(user.PasswordHash, "scrypt:") {
			skipped = append(skipped, email)
			continue
		}
		if _, err := d.CreateAdminAccount(ctx, newID(), email, user.PasswordHash, user.Name); err != nil {
			if IsUniqueViolation(err) {
				continue
			}
			return created, skipped, err
		}
		created = append(created, email)
	}
	return created, skipped, nil
}
