package server

import (
	"regexp"
	"strings"
)

// Ported from the shared browser/server rule set: private provider metadata is
// removed before records are stored or returned. Ordinary prompts, media
// handles and opaque IDs survive unchanged.
var privateRecordFields = map[string]bool{
	"model": true, "models": true, "modelname": true, "modelid": true,
	"modelmetadata": true, "modelconfig": true, "chatmodel": true, "imagemodel": true,
	"videomodel": true, "musicmodel": true, "audiomodel": true,
	"systemprompt": true, "systemprompts": true, "developerprompt": true,
	"presetprompt": true, "presetprompts": true,
	"apikey": true, "key": true, "rememberkey": true, "authorization": true,
	"proxyauthorization": true, "accesstoken": true, "refreshtoken": true,
	"token": true, "secret": true, "password": true,
	"apibaseurl": true, "baseurl": true, "upstreamurl": true,
	"upstreammodel": true, "upstreammodels": true,
}

var (
	privateRecordRE = regexp.MustCompile(`^ai(?:api|chatmodel|imagemodel|videomodel|musicmodel|systemprompt)`)
	recordIDFieldRE = regexp.MustCompile(`(?:id|ids)$`)
	recordBlobRE    = regexp.MustCompile(`(?:blobdata|base64)$`)
	jobTokenRE      = regexp.MustCompile(`^job_[A-Za-z0-9_-]+$`)
)

func normalizeRecordField(field string) string {
	field = strings.ToLower(field)
	replacer := strings.NewReplacer("-", "", "_", "", " ", "", "\t", "", "\n", "")
	return replacer.Replace(field)
}

func privateRecordField(field string) bool {
	name := normalizeRecordField(field)
	return privateRecordFields[name] || privateRecordRE.MatchString(name)
}

func opaqueRecordText(field, value string) bool {
	name := normalizeRecordField(field)
	return recordIDFieldRE.MatchString(name) || recordBlobRE.MatchString(name) ||
		name == "b64json" || name == "data" || name == "linkedaccountid" ||
		strings.HasPrefix(strings.ToLower(value), "data:") || strings.HasPrefix(strings.ToLower(value), "blob:")
}

// scrubRecordPrivacy returns the same shape minus private fields. The redact
// callback is applied to ordinary textual values only.
func scrubRecordPrivacy(value any, redact func(string) string) any {
	var scrub func(any, string) any
	scrub = func(input any, field string) any {
		switch typed := input.(type) {
		case string:
			if redact != nil && !opaqueRecordText(field, typed) {
				return redact(typed)
			}
			return typed
		case []any:
			out := make([]any, len(typed))
			for i, item := range typed {
				out[i] = scrub(item, field)
			}
			return out
		case map[string]any:
			out := make(map[string]any, len(typed))
			for key, item := range typed {
				if privateRecordField(key) {
					continue
				}
				name := normalizeRecordField(key)
				if name == "remoteid" || name == "videoremoteid" {
					if text, ok := item.(string); ok && !jobTokenRE.MatchString(text) {
						continue
					}
				}
				out[key] = scrub(item, key)
			}
			return out
		default:
			return input
		}
	}
	return scrub(value, "")
}
