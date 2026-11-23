package store

import (
	"context"
	"strings"
	"testing"
)

func TestProfileDefaultsAndHandleUniqueness(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")

	if _, err := db.ProfileByUser(ctx, "u1"); err != ErrNotFound {
		t.Fatalf("missing profile: %v", err)
	}
	profile := DefaultProfile("u1", "olai-u1")
	profile.Bio = "hello"
	profile.UpdatedAt = 10
	if err := db.SaveProfile(ctx, profile); err != nil {
		t.Fatalf("save profile: %v", err)
	}
	got, err := db.ProfileByHandle(ctx, "olai-u1")
	if err != nil {
		t.Fatalf("profile by handle: %v", err)
	}
	if !got.ShowWorks || got.ShowFavorites || !got.AllowMessages || got.Bio != "hello" {
		t.Fatalf("defaults were not kept: %+v", got)
	}
	taken, err := db.HandleTaken(ctx, "olai-u1", "u2")
	if err != nil || !taken {
		t.Fatalf("handle must be taken by someone else: taken=%v err=%v", taken, err)
	}
	taken, err = db.HandleTaken(ctx, "olai-u1", "u1")
	if err != nil || taken {
		t.Fatalf("an account may keep its own handle: taken=%v err=%v", taken, err)
	}
	other := DefaultProfile("u2", "olai-u1")
	other.UpdatedAt = 11
	if err := db.SaveProfile(ctx, other); err == nil {
		t.Fatal("a second account reused a handle")
	}
}

func TestEnsureProfileKeepsAnExistingProfile(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")

	saved := DefaultProfile("u1", "river")
	saved.Bio = "keep me"
	saved.ShowFavorites = true
	saved.UpdatedAt = 5
	if err := db.SaveProfile(ctx, saved); err != nil {
		t.Fatalf("save profile: %v", err)
	}
	handle, err := db.EnsureProfile(ctx, "u1", "someone-else")
	if err != nil || handle != "river" {
		t.Fatalf("ensure existing = %q err=%v", handle, err)
	}
	got, err := db.ProfileByUser(ctx, "u1")
	if err != nil || got.Bio != "keep me" || !got.ShowFavorites {
		t.Fatalf("existing profile was overwritten: %+v err=%v", got, err)
	}

	if _, err := db.EnsureProfile(ctx, "u2", "river"); err != nil {
		t.Fatalf("ensure colliding handle: %v", err)
	}
	second, err := db.ProfileByUser(ctx, "u2")
	if err != nil || second.Handle == "river" || !strings.HasPrefix(second.Handle, "river-") {
		t.Fatalf("collision handle = %+v err=%v", second, err)
	}
}

func TestFollowAndBlock(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")

	added, err := db.Follow(ctx, "u1", "u2")
	if err != nil || !added {
		t.Fatalf("follow: added=%v err=%v", added, err)
	}
	added, err = db.Follow(ctx, "u1", "u2")
	if err != nil || added {
		t.Fatalf("repeat follow must be a no-op: added=%v err=%v", added, err)
	}
	following, err := db.IsFollowing(ctx, "u1", "u2")
	if err != nil || !following {
		t.Fatalf("is following: %v err=%v", following, err)
	}
	counts, err := db.FollowCounts(ctx, "u2")
	if err != nil || counts.Followers != 1 || counts.Following != 0 {
		t.Fatalf("counts = %+v err=%v", counts, err)
	}
	if err := db.Block(ctx, "u2", "u1"); err != nil {
		t.Fatalf("block: %v", err)
	}
	following, err = db.IsFollowing(ctx, "u1", "u2")
	if err != nil || following {
		t.Fatalf("block must drop the follow: following=%v err=%v", following, err)
	}
	blocked, err := db.BlockedEither(ctx, "u1", "u2")
	if err != nil || !blocked {
		t.Fatalf("blocked either way: %v err=%v", blocked, err)
	}
	if _, err := db.Unblock(ctx, "u2", "u1"); err != nil {
		t.Fatalf("unblock: %v", err)
	}
}

func TestDirectMessagesStayInsideThePair(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")

	first, err := db.OpenConversation(ctx, "c-new", "u2", "u1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	again, err := db.OpenConversation(ctx, "c-other", "u1", "u2")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if first.ID != again.ID || first.LowUserID != "u1" || first.HighUserID != "u2" {
		t.Fatalf("pair was not stable: %+v %+v", first, again)
	}
	if err := db.AddDirectMessage(ctx, DirectMessage{ID: "m1", ConversationID: first.ID, SenderID: "u1", Body: "hi", CreatedAt: 10}); err != nil {
		t.Fatalf("message: %v", err)
	}
	messages, err := db.DirectMessages(ctx, first.ID, 20, 0)
	if err != nil || len(messages) != 1 || messages[0].Body != "hi" {
		t.Fatalf("messages = %+v err=%v", messages, err)
	}
	if err := db.MarkConversationRead(ctx, first.ID, "u2", 10); err != nil {
		t.Fatalf("read: %v", err)
	}
	unread, err := db.UnreadMessageCount(ctx, "u2")
	if err != nil || unread != 0 {
		t.Fatalf("unread after read = %d err=%v", unread, err)
	}
	inbox, err := db.Inbox(ctx, "u2", 20, 0)
	if err != nil || len(inbox) != 1 || inbox[0].OtherUserID != "u1" || inbox[0].LastBody != "hi" {
		t.Fatalf("inbox = %+v err=%v", inbox, err)
	}
}

func TestFavoriteFoldersAndWorkVisibility(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	key := strings.Repeat("a", 64)
	galleryRecord(t, db, "u1", key)
	if _, err := db.AddGalleryFavorite(ctx, "u1", key); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	if err := db.CreateFavoriteFolder(ctx, FavoriteFolder{ID: "f1", UserID: "u1", Name: "灵感", CreatedAt: 5}); err != nil {
		t.Fatalf("folder: %v", err)
	}
	moved, err := db.SetFavoriteFolder(ctx, "u1", key, "f1")
	if err != nil || !moved {
		t.Fatalf("move into folder: moved=%v err=%v", moved, err)
	}
	keys, total, err := db.GalleryFavoriteKeysIn(ctx, "u1", "f1", 20, 0)
	if err != nil || total != 1 || len(keys) != 1 || keys[0] != key {
		t.Fatalf("folder keys = %v total=%d err=%v", keys, total, err)
	}
	folders, err := db.FavoriteFolders(ctx, "u1")
	if err != nil || len(folders) != 1 || folders[0].Count != 1 {
		t.Fatalf("folders = %+v err=%v", folders, err)
	}

	visibility, err := db.RecordVisibility(ctx, key)
	if err != nil || visibility != "public" {
		t.Fatalf("new work visibility = %q err=%v", visibility, err)
	}
	changed, err := db.SetRecordVisibility(ctx, key, "u1", "private")
	if err != nil || !changed {
		t.Fatalf("hide work: changed=%v err=%v", changed, err)
	}
	publicKeys, err := db.PublicAssetKeys(ctx, "u1", 20, 0)
	if err != nil || len(publicKeys) != 0 {
		t.Fatalf("private work leaked into the public list: %v err=%v", publicKeys, err)
	}
}

func TestDeleteUserClearsSocialRows(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")
	profile := DefaultProfile("u1", "olai-u1")
	profile.UpdatedAt = 1
	if err := db.SaveProfile(ctx, profile); err != nil {
		t.Fatalf("profile: %v", err)
	}
	if _, err := db.Follow(ctx, "u2", "u1"); err != nil {
		t.Fatalf("follow: %v", err)
	}
	if err := db.DeleteUser(ctx, "u1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	counts, err := db.FollowCounts(ctx, "u2")
	if err != nil || counts.Following != 0 {
		t.Fatalf("follow survived account deletion: %+v err=%v", counts, err)
	}
}
