package store

import (
	"context"
	"errors"
	"testing"
)

func TestMemoryDefaultsAndChatInjection(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")

	settings, err := db.MemorySettings(ctx, "u1")
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	if !settings.Enabled || settings.AutoCapture {
		t.Fatalf("defaults must be enabled=true autoCapture=false, got %+v", settings)
	}

	first, err := db.CreateMemory(ctx, "u1", "m1", "用户叫约翰。", "manual", 50)
	if err != nil || first.Content != "用户叫约翰。" {
		t.Fatalf("create memory: %#v err=%v", first, err)
	}
	if _, err := db.CreateMemory(ctx, "u1", "m2", "喜欢简洁的回答。", "auto", 50); err != nil {
		t.Fatalf("create second memory: %v", err)
	}
	contents, err := db.ChatMemories(ctx, "u1")
	if err != nil || len(contents) != 2 || contents[0] != "用户叫约翰。" {
		t.Fatalf("chat memories = %#v err=%v", contents, err)
	}

	if err := db.SaveMemorySettings(ctx, "u1", MemorySettings{Enabled: false, AutoCapture: false}); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	if contents, err := db.ChatMemories(ctx, "u1"); err != nil || len(contents) != 0 {
		t.Fatalf("disabled memory must inject nothing, got %#v err=%v", contents, err)
	}
	if items, _ := db.MemoryList(ctx, "u1"); len(items) != 2 {
		t.Fatalf("disabling memory must keep saved notes, got %d", len(items))
	}
}

func TestMemoryCRUDIsAccountScoped(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	insertUser(t, db, "u2")
	if _, err := db.CreateMemory(ctx, "u1", "m1", "用户叫约翰。", "manual", 50); err != nil {
		t.Fatalf("create: %v", err)
	}

	updated, err := db.UpdateMemory(ctx, "u2", "m1", "被改掉了")
	if err != nil || updated {
		t.Fatalf("another account must not edit the memory: updated=%v err=%v", updated, err)
	}
	updated, err = db.UpdateMemory(ctx, "u1", "m1", "用户叫 John。")
	if err != nil || !updated {
		t.Fatalf("owner update: updated=%v err=%v", updated, err)
	}
	if items, _ := db.MemoryList(ctx, "u1"); items[0].Content != "用户叫 John。" {
		t.Fatalf("update not persisted: %#v", items)
	}

	deleted, err := db.DeleteMemory(ctx, "u2", "m1")
	if err != nil || deleted {
		t.Fatalf("another account must not delete the memory: deleted=%v err=%v", deleted, err)
	}
	if deleted, err = db.DeleteMemory(ctx, "u1", "m1"); err != nil || !deleted {
		t.Fatalf("owner delete: deleted=%v err=%v", deleted, err)
	}
	if items, _ := db.MemoryList(ctx, "u1"); len(items) != 0 {
		t.Fatalf("memory still present after delete: %#v", items)
	}
}

func TestMemoryLimitAndClear(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	insertUser(t, db, "u1")
	for i := 0; i < 2; i++ {
		if _, err := db.CreateMemory(ctx, "u1", "m"+string(rune('a'+i)), "记忆内容", "manual", 2); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	if _, err := db.CreateMemory(ctx, "u1", "m3", "第三条", "manual", 2); !errors.Is(err, ErrMemoryLimit) {
		t.Fatalf("expected ErrMemoryLimit, got %v", err)
	}
	if err := db.ClearMemories(ctx, "u1"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if count, _ := db.MemoryCount(ctx, "u1"); count != 0 {
		t.Fatalf("clear left %d memories", count)
	}
}
