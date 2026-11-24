package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Profile is the public-facing part of one account plus the privacy switches
// that decide what visitors of the profile may see. A missing row means the
// account still uses the defaults: works public, favorites private, messages on.
type Profile struct {
	UserID        string
	Handle        string
	Bio           string
	Website       string
	ShowWorks     bool
	ShowFavorites bool
	ShowBio       bool
	ShowJoined    bool
	ShowFollows   bool
	AllowMessages bool
	UpdatedAt     int64
}

// DefaultProfile fills the privacy defaults for an account that has never
// saved a profile. The handle is derived by the caller.
func DefaultProfile(userID, handle string) Profile {
	return Profile{
		UserID: userID, Handle: handle,
		ShowWorks: true, ShowBio: true, ShowJoined: true, ShowFollows: true, AllowMessages: true,
	}
}

func scanProfile(row interface{ Scan(...any) error }) (*Profile, error) {
	var profile Profile
	var showWorks, showFavorites, showBio, showJoined, showFollows, allowMessages int
	err := row.Scan(&profile.UserID, &profile.Handle, &profile.Bio, &profile.Website,
		&showWorks, &showFavorites, &showBio, &showJoined, &showFollows, &allowMessages, &profile.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	profile.ShowWorks = showWorks != 0
	profile.ShowFavorites = showFavorites != 0
	profile.ShowBio = showBio != 0
	profile.ShowJoined = showJoined != 0
	profile.ShowFollows = showFollows != 0
	profile.AllowMessages = allowMessages != 0
	return &profile, nil
}

const profileColumns = `user_id, handle, bio, website, show_works, show_favorites, show_bio, show_joined, show_follows, allow_messages, updated_at`

func (d *DB) ProfileByUser(ctx context.Context, userID string) (*Profile, error) {
	return scanProfile(d.QueryRowContext(ctx, `SELECT `+profileColumns+` FROM user_profiles WHERE user_id = ?`, userID))
}

func (d *DB) ProfileByHandle(ctx context.Context, handle string) (*Profile, error) {
	return scanProfile(d.QueryRowContext(ctx, `SELECT `+profileColumns+` FROM user_profiles WHERE handle = ?`, handle))
}

// SaveProfile inserts or replaces one profile. The handle must already be
// unique; a conflicting handle comes back as a constraint error.
func (d *DB) SaveProfile(ctx context.Context, profile Profile) error {
	_, err := d.ExecContext(ctx, `INSERT INTO user_profiles
		(user_id, handle, bio, website, show_works, show_favorites, show_bio, show_joined, show_follows, allow_messages, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE SET
			handle = excluded.handle, bio = excluded.bio, website = excluded.website,
			show_works = excluded.show_works, show_favorites = excluded.show_favorites,
			show_bio = excluded.show_bio, show_joined = excluded.show_joined,
			show_follows = excluded.show_follows, allow_messages = excluded.allow_messages,
			updated_at = excluded.updated_at`,
		profile.UserID, profile.Handle, profile.Bio, profile.Website,
		boolInt(profile.ShowWorks), boolInt(profile.ShowFavorites), boolInt(profile.ShowBio),
		boolInt(profile.ShowJoined), boolInt(profile.ShowFollows), boolInt(profile.AllowMessages),
		profile.UpdatedAt)
	return err
}

// EnsureProfile stores the default profile the first time an account needs a
// public address, so a work or comment can link to a page that actually
// exists. A handle another account already took gets a short suffix. Saving
// a profile later replaces this row in place.
func (d *DB) EnsureProfile(ctx context.Context, userID, handle string) (string, error) {
	existing, err := d.ProfileByUser(ctx, userID)
	if err == nil {
		return existing.Handle, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return "", err
	}
	base := handle
	now := time.Now().UnixMilli()
	for attempt := 0; attempt < 8; attempt++ {
		next := base
		if attempt > 0 {
			next = base + "-" + strconv.Itoa(attempt+1)
		}
		_, err = d.ExecContext(ctx, `INSERT INTO user_profiles
			(user_id, handle, bio, website, show_works, show_favorites, show_bio, show_joined, show_follows, allow_messages, updated_at)
			VALUES (?, ?, '', '', 1, 0, 1, 1, 1, 1, ?)
			ON CONFLICT (user_id) DO NOTHING`, userID, next, now)
		if err != nil && !IsUniqueViolation(err) {
			return "", err
		}
		winner, again := d.ProfileByUser(ctx, userID)
		if again == nil {
			return winner.Handle, nil
		}
		if !errors.Is(again, ErrNotFound) {
			return "", again
		}
	}
	return "", fmt.Errorf("profile handle %s stayed taken", base)
}

// HandleTaken reports whether another account already published this handle.
func (d *DB) HandleTaken(ctx context.Context, handle, exceptUserID string) (bool, error) {
	var owner string
	err := d.QueryRowContext(ctx, `SELECT user_id FROM user_profiles WHERE handle = ?`, handle).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return owner != exceptUserID, nil
}

// ---- follows and blocks ----

// Follow inserts one follow. Following yourself or an unknown account is the
// caller's job to reject; a repeat follow changes nothing and returns false.
func (d *DB) Follow(ctx context.Context, followerID, followeeID string) (bool, error) {
	result, err := d.ExecContext(ctx, `INSERT INTO user_follows (follower_id, followee_id, created_at)
		VALUES (?, ?, ?) ON CONFLICT (follower_id, followee_id) DO NOTHING`,
		followerID, followeeID, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (d *DB) Unfollow(ctx context.Context, followerID, followeeID string) (bool, error) {
	result, err := d.ExecContext(ctx, `DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?`, followerID, followeeID)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (d *DB) IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error) {
	var exists int
	err := d.QueryRowContext(ctx, `SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?`, followerID, followeeID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

type FollowCounts struct {
	Followers int64
	Following int64
}

func (d *DB) FollowCounts(ctx context.Context, userID string) (FollowCounts, error) {
	var counts FollowCounts
	err := d.QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM user_follows WHERE followee_id = ?),
		(SELECT COUNT(*) FROM user_follows WHERE follower_id = ?)`, userID, userID).
		Scan(&counts.Followers, &counts.Following)
	return counts, err
}

// FollowList is one page of people, newest relationship first.
type FollowListItem struct {
	UserID    string
	Name      string
	Avatar    string
	Handle    string
	CreatedAt int64
}

func (d *DB) listFollows(ctx context.Context, query string, args ...any) ([]FollowListItem, error) {
	rows, err := d.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FollowListItem{}
	for rows.Next() {
		var item FollowListItem
		var name, avatar, handle sql.NullString
		if err := rows.Scan(&item.UserID, &name, &avatar, &handle, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.Name = name.String
		item.Avatar = avatar.String
		item.Handle = handle.String
		out = append(out, item)
	}
	return out, rows.Err()
}

func (d *DB) Followers(ctx context.Context, userID string, limit, offset int) ([]FollowListItem, error) {
	return d.listFollows(ctx, `SELECT u.id, u.name, u.avatar, p.handle, f.created_at
		FROM user_follows f
		JOIN users u ON u.id = f.follower_id
		LEFT JOIN user_profiles p ON p.user_id = u.id
		WHERE f.followee_id = ?
		ORDER BY f.created_at DESC, u.id LIMIT ? OFFSET ?`, userID, limit, offset)
}

func (d *DB) Following(ctx context.Context, userID string, limit, offset int) ([]FollowListItem, error) {
	return d.listFollows(ctx, `SELECT u.id, u.name, u.avatar, p.handle, f.created_at
		FROM user_follows f
		JOIN users u ON u.id = f.followee_id
		LEFT JOIN user_profiles p ON p.user_id = u.id
		WHERE f.follower_id = ?
		ORDER BY f.created_at DESC, u.id LIMIT ? OFFSET ?`, userID, limit, offset)
}

func (d *DB) Block(ctx context.Context, blockerID, blockedID string) error {
	return d.InTx(ctx, func(tx *Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_blocks (blocker_id, blocked_id, created_at)
			VALUES (?, ?, ?) ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
			blockerID, blockedID, time.Now().UnixMilli()); err != nil {
			return err
		}
		// A block ends the relationship in both directions.
		_, err := tx.ExecContext(ctx, `DELETE FROM user_follows
			WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)`,
			blockerID, blockedID, blockedID, blockerID)
		return err
	})
}

func (d *DB) Unblock(ctx context.Context, blockerID, blockedID string) (bool, error) {
	result, err := d.ExecContext(ctx, `DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`, blockerID, blockedID)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

// BlockedEither reports whether either account has blocked the other.
func (d *DB) BlockedEither(ctx context.Context, a, b string) (bool, error) {
	var exists int
	err := d.QueryRowContext(ctx, `SELECT 1 FROM user_blocks
		WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
		a, b, b, a).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// UserSearchResult is one account a signed-in person can share a work with.
type UserSearchResult struct {
	UserID string
	Handle string
	Name   string
	Email  string
	Avatar string
}

// escapedLike keeps typed input literal inside a SQL LIKE pattern so a % or _
// searches for that character instead of matching every account.
func escapedLike(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}

// SearchMessageUsers finds accounts by handle or display name that the viewer
// may message. Blocked, banned and messaging-disabled accounts stay out, and
// the viewer never sees themselves. Handle prefix matches come first.
func (d *DB) SearchMessageUsers(ctx context.Context, viewerID, query string, limit int) ([]UserSearchResult, error) {
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" || limit <= 0 {
		return nil, nil
	}
	escaped := escapedLike(needle)
	contains := "%" + escaped + "%"
	prefix := escaped + "%"
	rows, err := d.QueryContext(ctx, `SELECT p.user_id, p.handle, u.name, u.email, u.avatar
		FROM user_profiles p
		JOIN users u ON u.id = p.user_id
		WHERE p.user_id <> ?
			AND p.allow_messages = 1
			AND u.system = 0
			AND NOT EXISTS (SELECT 1 FROM user_bans b WHERE b.user_id = p.user_id)
			AND NOT EXISTS (SELECT 1 FROM user_blocks x
				WHERE (x.blocker_id = ? AND x.blocked_id = p.user_id)
					OR (x.blocker_id = p.user_id AND x.blocked_id = ?))
			AND (LOWER(p.handle) LIKE ? ESCAPE '\' OR LOWER(u.name) LIKE ? ESCAPE '\')
		ORDER BY CASE WHEN LOWER(p.handle) LIKE ? ESCAPE '\' THEN 0 ELSE 1 END, LOWER(p.handle), p.handle
		LIMIT ?`,
		viewerID, viewerID, viewerID, contains, contains, prefix, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserSearchResult
	for rows.Next() {
		var row UserSearchResult
		var name, avatar sql.NullString
		if err := rows.Scan(&row.UserID, &row.Handle, &name, &row.Email, &avatar); err != nil {
			return nil, err
		}
		if name.Valid {
			row.Name = name.String
		}
		if avatar.Valid {
			row.Avatar = avatar.String
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ---- direct messages ----

type DirectConversation struct {
	ID         string
	LowUserID  string
	HighUserID string
	CreatedAt  int64
	UpdatedAt  int64
}

func conversationPair(a, b string) (string, string) {
	if a < b {
		return a, b
	}
	return b, a
}

// OpenConversation returns the conversation between two accounts, creating it
// when this is their first message.
func (d *DB) OpenConversation(ctx context.Context, id, a, b string) (*DirectConversation, error) {
	low, high := conversationPair(a, b)
	var conversation DirectConversation
	err := d.InTx(ctx, func(tx *Tx) error {
		now := time.Now().UnixMilli()
		if _, err := tx.ExecContext(ctx, `INSERT INTO direct_conversations (id, low_user_id, high_user_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?) ON CONFLICT (low_user_id, high_user_id) DO NOTHING`, id, low, high, now, now); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT id, low_user_id, high_user_id, created_at, updated_at
			FROM direct_conversations WHERE low_user_id = ? AND high_user_id = ?`, low, high).
			Scan(&conversation.ID, &conversation.LowUserID, &conversation.HighUserID, &conversation.CreatedAt, &conversation.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	return &conversation, nil
}

func (d *DB) ConversationByID(ctx context.Context, id string) (*DirectConversation, error) {
	var conversation DirectConversation
	err := d.QueryRowContext(ctx, `SELECT id, low_user_id, high_user_id, created_at, updated_at
		FROM direct_conversations WHERE id = ?`, id).
		Scan(&conversation.ID, &conversation.LowUserID, &conversation.HighUserID, &conversation.CreatedAt, &conversation.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &conversation, nil
}

func (conversation DirectConversation) Other(userID string) string {
	if conversation.LowUserID == userID {
		return conversation.HighUserID
	}
	return conversation.LowUserID
}

func (conversation DirectConversation) Has(userID string) bool {
	return conversation.LowUserID == userID || conversation.HighUserID == userID
}

type DirectMessage struct {
	ID             string
	ConversationID string
	SenderID       string
	Body           string
	CreatedAt      int64
}

// AddDirectMessage stores one message and bumps the conversation so the inbox
// sorts by the latest message.
func (d *DB) AddDirectMessage(ctx context.Context, message DirectMessage) error {
	return d.InTx(ctx, func(tx *Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO direct_messages (id, conversation_id, sender_id, body, created_at)
			VALUES (?, ?, ?, ?, ?)`, message.ID, message.ConversationID, message.SenderID, message.Body, message.CreatedAt); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE direct_conversations SET updated_at = ? WHERE id = ?`, message.CreatedAt, message.ConversationID)
		return err
	})
}

func (d *DB) DirectMessages(ctx context.Context, conversationID string, limit, offset int) ([]DirectMessage, error) {
	rows, err := d.QueryContext(ctx, `SELECT id, conversation_id, sender_id, body, created_at
		FROM direct_messages WHERE conversation_id = ?
		ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, conversationID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DirectMessage{}
	for rows.Next() {
		var message DirectMessage
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.SenderID, &message.Body, &message.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, message)
	}
	return out, rows.Err()
}

// MarkConversationRead records that this member has seen messages up to now.
func (d *DB) MarkConversationRead(ctx context.Context, conversationID, userID string, readAt int64) error {
	_, err := d.ExecContext(ctx, `INSERT INTO direct_reads (conversation_id, user_id, read_at)
		VALUES (?, ?, ?) ON CONFLICT (conversation_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
		conversationID, userID, readAt)
	return err
}

// InboxItem is one conversation as it appears in one member's inbox.
type InboxItem struct {
	ConversationID string
	OtherUserID    string
	OtherName      string
	OtherAvatar    string
	OtherHandle    string
	LastBody       string
	LastSenderID   string
	UpdatedAt      int64
	Unread         int64
}

func (d *DB) Inbox(ctx context.Context, userID string, limit, offset int) ([]InboxItem, error) {
	rows, err := d.QueryContext(ctx, `SELECT c.id,
		CASE WHEN c.low_user_id = ? THEN c.high_user_id ELSE c.low_user_id END,
		COALESCE(u.name, ''), COALESCE(u.email, ''), COALESCE(u.avatar, ''), COALESCE(p.handle, ''),
		COALESCE(m.body, ''), COALESCE(m.sender_id, ''), c.updated_at,
		(SELECT COUNT(*) FROM direct_messages dm
			WHERE dm.conversation_id = c.id AND dm.sender_id <> ?
			AND dm.created_at > COALESCE((SELECT read_at FROM direct_reads r WHERE r.conversation_id = c.id AND r.user_id = ?), 0))
		FROM direct_conversations c
		JOIN users u ON u.id = CASE WHEN c.low_user_id = ? THEN c.high_user_id ELSE c.low_user_id END
		LEFT JOIN user_profiles p ON p.user_id = u.id
		LEFT JOIN direct_messages m ON m.id = (
			SELECT id FROM direct_messages WHERE conversation_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1)
		WHERE c.low_user_id = ? OR c.high_user_id = ?
		ORDER BY c.updated_at DESC, c.id LIMIT ? OFFSET ?`,
		userID, userID, userID, userID, userID, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InboxItem{}
	for rows.Next() {
		var item InboxItem
		var email string
		if err := rows.Scan(&item.ConversationID, &item.OtherUserID, &item.OtherName, &email, &item.OtherAvatar,
			&item.OtherHandle, &item.LastBody, &item.LastSenderID, &item.UpdatedAt, &item.Unread); err != nil {
			return nil, err
		}
		item.OtherName = DisplayName(item.OtherName, email)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (d *DB) UnreadMessageCount(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM direct_messages dm
		JOIN direct_conversations c ON c.id = dm.conversation_id
		WHERE (c.low_user_id = ? OR c.high_user_id = ?) AND dm.sender_id <> ?
		AND dm.created_at > COALESCE((SELECT read_at FROM direct_reads r WHERE r.conversation_id = c.id AND r.user_id = ?), 0)`,
		userID, userID, userID, userID).Scan(&total)
	return total, err
}

// ---- favorite folders ----

type FavoriteFolder struct {
	ID        string
	UserID    string
	Name      string
	CreatedAt int64
	Count     int64
}

func (d *DB) CreateFavoriteFolder(ctx context.Context, folder FavoriteFolder) error {
	_, err := d.ExecContext(ctx, `INSERT INTO favorite_folders (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
		folder.ID, folder.UserID, folder.Name, folder.CreatedAt)
	return err
}

func (d *DB) RenameFavoriteFolder(ctx context.Context, id, userID, name string) (bool, error) {
	result, err := d.ExecContext(ctx, `UPDATE favorite_folders SET name = ? WHERE id = ? AND user_id = ?`, name, id, userID)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

// DeleteFavoriteFolder removes the folder. Favorites inside it stay, with the
// folder cleared by the foreign key.
func (d *DB) DeleteFavoriteFolder(ctx context.Context, id, userID string) (bool, error) {
	result, err := d.ExecContext(ctx, `DELETE FROM favorite_folders WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (d *DB) FavoriteFolders(ctx context.Context, userID string) ([]FavoriteFolder, error) {
	rows, err := d.QueryContext(ctx, `SELECT f.id, f.user_id, f.name, f.created_at,
		(SELECT COUNT(*) FROM gallery_favorites g WHERE g.folder_id = f.id)
		FROM favorite_folders f WHERE f.user_id = ? ORDER BY f.created_at, f.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FavoriteFolder{}
	for rows.Next() {
		var folder FavoriteFolder
		if err := rows.Scan(&folder.ID, &folder.UserID, &folder.Name, &folder.CreatedAt, &folder.Count); err != nil {
			return nil, err
		}
		out = append(out, folder)
	}
	return out, rows.Err()
}

func (d *DB) FavoriteFolderOwned(ctx context.Context, id, userID string) (bool, error) {
	if id == "" {
		return true, nil
	}
	var exists int
	err := d.QueryRowContext(ctx, `SELECT 1 FROM favorite_folders WHERE id = ? AND user_id = ?`, id, userID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// SetFavoriteFolder moves one of the caller's favorites into a folder, or out
// of every folder when folderID is empty. It does nothing when the favorite
// itself does not exist.
func (d *DB) SetFavoriteFolder(ctx context.Context, userID, recordKey, folderID string) (bool, error) {
	var value any
	if folderID != "" {
		value = folderID
	}
	result, err := d.ExecContext(ctx, `UPDATE gallery_favorites SET folder_id = ? WHERE user_id = ? AND record_key = ?`, value, userID, recordKey)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

// PublicAssetKeys returns one newest-first page of an account's works that are
// still marked public. The caller still has to drop hidden and incomplete rows.
func (d *DB) PublicAssetKeys(ctx context.Context, userID string, limit, offset int) ([]string, error) {
	rows, err := d.QueryContext(ctx, `SELECT key FROM studio_records
		WHERE user_id = ? AND store = 'assets' AND visibility = 'public'
		ORDER BY created_at DESC, key DESC LIMIT ? OFFSET ?`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

// SetRecordVisibility changes one owned work between public and private.
func (d *DB) SetRecordVisibility(ctx context.Context, key, userID, visibility string) (bool, error) {
	result, err := d.ExecContext(ctx, `UPDATE studio_records SET visibility = ?
		WHERE key = ? AND user_id = ? AND store = 'assets'`, visibility, key, userID)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (d *DB) RecordVisibility(ctx context.Context, key string) (string, error) {
	var visibility string
	err := d.QueryRowContext(ctx, `SELECT visibility FROM studio_records WHERE key = ? AND store = 'assets'`, key).Scan(&visibility)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return visibility, err
}

// CountPublicAssets counts works an account has left public. It does not know
// which of them are complete; the gallery applies that rule when rendering.
func (d *DB) CountPublicAssets(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM studio_records
		WHERE user_id = ? AND store = 'assets' AND visibility = 'public'`, userID).Scan(&total)
	return total, err
}

// TrimHandle keeps a handle inside the published alphabet.
func TrimHandle(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
