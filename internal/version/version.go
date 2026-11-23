// Package version exposes the build revision and compares client release
// versions. Version is injected at build time with:
//
//	go build -ldflags "-X olai/internal/version.Version=1.5.0"
//
// Values stay empty by default so local `go build` keeps working without any
// deployment tooling.
package version

import (
	"runtime/debug"
	"strconv"
	"strings"
)

var (
	Version = "dev"
	Commit  = ""
	BuiltAt = ""
)

type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit,omitempty"`
	BuiltAt string `json:"builtAt,omitempty"`
}

// Current returns the compiled-in version. Commit and BuiltAt fall back to
// Go's VCS metadata when ldflags did not provide them.
func Current() Info {
	info := Info{Version: strings.TrimSpace(Version)}
	if normalized, ok := Normalize(info.Version); ok {
		info.Version = normalized
	}
	if info.Version == "" {
		info.Version = "dev"
	}
	info.Commit = strings.TrimSpace(Commit)
	info.BuiltAt = strings.TrimSpace(BuiltAt)
	if info.Commit == "" || info.BuiltAt == "" {
		if build, ok := debug.ReadBuildInfo(); ok {
			for _, setting := range build.Settings {
				switch setting.Key {
				case "vcs.revision":
					if info.Commit == "" {
						info.Commit = setting.Value
					}
				case "vcs.time":
					if info.BuiltAt == "" {
						info.BuiltAt = setting.Value
					}
				}
			}
		}
	}
	if len(info.Commit) > 12 {
		info.Commit = info.Commit[:12]
	}
	return info
}

// Normalize accepts "1.2", "v1.2.3" and "1.2.3-beta.1" and returns the same
// core without a leading v. Build metadata after + is ignored.
func Normalize(raw string) (string, bool) {
	parsed, ok := parse(raw)
	if !ok {
		return "", false
	}
	var out strings.Builder
	for index, part := range parsed.core {
		if index > 0 {
			out.WriteByte('.')
		}
		out.WriteString(strconv.Itoa(part))
	}
	if len(parsed.pre) > 0 {
		out.WriteByte('-')
		out.WriteString(strings.Join(parsed.pre, "."))
	}
	return out.String(), true
}

// Compare returns -1, 0 or 1 when left is older, equal or newer than right.
// ok is false when either version is not parseable.
func Compare(left, right string) (int, bool) {
	a, aok := parse(left)
	b, bok := parse(right)
	if !aok || !bok {
		return 0, false
	}
	for index := 0; index < len(a.core) || index < len(b.core); index++ {
		av, bv := 0, 0
		if index < len(a.core) {
			av = a.core[index]
		}
		if index < len(b.core) {
			bv = b.core[index]
		}
		if av < bv {
			return -1, true
		}
		if av > bv {
			return 1, true
		}
	}
	if len(a.pre) == 0 && len(b.pre) == 0 {
		return 0, true
	}
	if len(a.pre) == 0 {
		return 1, true
	}
	if len(b.pre) == 0 {
		return -1, true
	}
	for index := 0; index < len(a.pre) || index < len(b.pre); index++ {
		if index >= len(a.pre) {
			return -1, true
		}
		if index >= len(b.pre) {
			return 1, true
		}
		leftPart, rightPart := a.pre[index], b.pre[index]
		leftNumber, leftNumeric := numericIdentifier(leftPart)
		rightNumber, rightNumeric := numericIdentifier(rightPart)
		switch {
		case leftNumeric && rightNumeric && leftNumber != rightNumber:
			if leftNumber < rightNumber {
				return -1, true
			}
			return 1, true
		case leftNumeric != rightNumeric:
			if leftNumeric {
				return -1, true
			}
			return 1, true
		case leftPart != rightPart:
			if leftPart < rightPart {
				return -1, true
			}
			return 1, true
		}
	}
	return 0, true
}

type parsedVersion struct {
	core []int
	pre  []string
}

func parse(raw string) (parsedVersion, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return parsedVersion{}, false
	}
	value = strings.TrimPrefix(value, "v")
	value = strings.TrimPrefix(value, "V")
	if index := strings.IndexByte(value, '+'); index >= 0 {
		value = value[:index]
	}
	core, pre, hasPre := strings.Cut(value, "-")
	parts := strings.Split(core, ".")
	if len(parts) == 0 || len(parts) > 4 {
		return parsedVersion{}, false
	}
	out := parsedVersion{core: make([]int, 0, len(parts))}
	for _, part := range parts {
		if part == "" || len(part) > 9 {
			return parsedVersion{}, false
		}
		for _, char := range part {
			if char < '0' || char > '9' {
				return parsedVersion{}, false
			}
		}
		number, err := strconv.Atoi(part)
		if err != nil {
			return parsedVersion{}, false
		}
		out.core = append(out.core, number)
	}
	if hasPre {
		if pre == "" {
			return parsedVersion{}, false
		}
		for _, part := range strings.Split(pre, ".") {
			if part == "" || len(part) > 64 {
				return parsedVersion{}, false
			}
			for _, char := range part {
				if !(char >= '0' && char <= '9' || char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z' || char == '-') {
					return parsedVersion{}, false
				}
			}
		}
		out.pre = strings.Split(pre, ".")
	}
	return out, true
}

func numericIdentifier(value string) (int, bool) {
	for _, char := range value {
		if char < '0' || char > '9' {
			return 0, false
		}
	}
	number, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	return number, true
}
