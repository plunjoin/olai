package settings

import "testing"

func TestEverySettingGroupIsListed(t *testing.T) {
	groups := make(map[string]bool, len(Groups))
	for _, group := range Groups {
		groups[group] = true
	}
	for _, def := range Defs {
		if !groups[def.Group] {
			t.Errorf("setting %s uses group %q, which is missing from Groups", def.Key, def.Group)
		}
	}
}

func TestSettingKeysAreUnique(t *testing.T) {
	seen := make(map[string]bool, len(Defs))
	for _, def := range Defs {
		if seen[def.Key] {
			t.Errorf("duplicate setting key %s", def.Key)
		}
		seen[def.Key] = true
	}
}
