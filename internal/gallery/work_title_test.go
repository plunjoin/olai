package gallery

import (
	"context"
	"strings"
	"testing"

	"olai/internal/store"
)

func TestProjectionPublishesCreatorTitle(t *testing.T) {
	output := projection(
		store.RecordWithBody{StudioRecord: store.StudioRecord{Key: "record"}},
		map[string]any{"title": "  Sunset over the sea  "},
		nil,
	)
	if output["title"] != "Sunset over the sea" {
		t.Fatalf("title = %v, want trimmed title", output["title"])
	}
}

func TestProjectionOmitsBlankTitle(t *testing.T) {
	output := projection(
		store.RecordWithBody{StudioRecord: store.StudioRecord{Key: "record"}},
		map[string]any{"title": "   "},
		nil,
	)
	if _, ok := output["title"]; ok {
		t.Fatalf("blank title should fall back to the prompt: %v", output["title"])
	}
}

func TestProjectionClampsTitle(t *testing.T) {
	output := projection(
		store.RecordWithBody{StudioRecord: store.StudioRecord{Key: "record"}},
		map[string]any{"title": strings.Repeat("长", maxTitleRunes+20)},
		nil,
	)
	title, _ := output["title"].(string)
	if len([]rune(title)) != maxTitleRunes {
		t.Fatalf("title runes = %d, want %d", len([]rune(title)), maxTitleRunes)
	}
}

// The plaza editor needs the owner's record id to refresh the matching 我的库
// asset, but no other viewer may learn it.
func TestProjectionExposesRecordIDOnlyToOwner(t *testing.T) {
	ctx := context.Background()
	m, db := galleryManager(t)
	galleryUser(t, db, "u1")
	galleryUser(t, db, "u2")
	key := strings.Repeat("c", 64)
	galleryAsset(t, db, "u1", key)

	work := func(viewer string) map[string]any {
		t.Helper()
		page, err := m.List(ctx, galleryRequest(t, "/api/gallery?limit=10"), viewer)
		if err != nil {
			t.Fatalf("list as %q: %v", viewer, err)
		}
		for _, record := range page["records"].([]any) {
			asset := record.(map[string]any)
			if asset["id"] == "gallery_"+key {
				return asset
			}
		}
		t.Fatalf("work missing from %q's list", viewer)
		return nil
	}

	owner := work("u1")
	if owner["owner"] != true || owner["recordId"] != "asset-"+key[:8] {
		t.Fatalf("owner projection = %v, want owner and recordId", owner)
	}
	for _, viewer := range []string{"u2", ""} {
		asset := work(viewer)
		if _, ok := asset["recordId"]; ok {
			t.Fatalf("viewer %q received recordId: %v", viewer, asset)
		}
		if viewer != "" && asset["owner"] != false {
			t.Fatalf("viewer %q owner flag = %v, want false", viewer, asset["owner"])
		}
		if viewer == "" {
			if _, ok := asset["owner"]; ok {
				t.Fatalf("guest received owner flag: %v", asset)
			}
		}
	}
}
