package version

import "testing"

func TestNormalize(t *testing.T) {
	tests := []struct {
		raw  string
		want string
		ok   bool
	}{
		{"1.2.3", "1.2.3", true},
		{"v1.2.3", "1.2.3", true},
		{"V1.2", "1.2", true},
		{"1.2.3-beta.1", "1.2.3-beta.1", true},
		{"1.2.3+build.9", "1.2.3", true},
		{" 1.2.3 ", "1.2.3", true},
		{"dev", "", false},
		{"1..3", "", false},
		{"1.2.3.4.5", "", false},
		{"1.2.x", "", false},
	}
	for _, test := range tests {
		got, ok := Normalize(test.raw)
		if ok != test.ok || got != test.want {
			t.Fatalf("Normalize(%q) = %q, %v; want %q, %v", test.raw, got, ok, test.want, test.ok)
		}
	}
}

func TestCompare(t *testing.T) {
	tests := []struct {
		left, right string
		want        int
	}{
		{"1.2.3", "1.2.4", -1},
		{"1.2.4", "1.2.3", 1},
		{"1.2", "1.2.0", 0},
		{"v1.2.0", "1.2.0", 0},
		{"1.2.3-beta.1", "1.2.3", -1},
		{"1.2.3", "1.2.3-beta.2", 1},
		{"1.2.3-beta.1", "1.2.3-beta.2", -1},
		{"1.2.3-alpha", "1.2.3-beta", -1},
	}
	for _, test := range tests {
		got, ok := Compare(test.left, test.right)
		if !ok || got != test.want {
			t.Fatalf("Compare(%q, %q) = %d, %v; want %d, true", test.left, test.right, got, ok, test.want)
		}
	}
	if _, ok := Compare("1.2.3", "dev"); ok {
		t.Fatal("invalid versions must not compare")
	}
}
