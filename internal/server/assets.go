package server

import "net/http"

// RevalidatingAssets makes the fixed-name client bundles revalidate on every
// load. webfront hashes split chunks, but client.js and client.css keep their
// names across builds; a long max-age would leave browsers on an old bundle
// after a deploy. ETag/304 handling still applies, so unchanged files stay
// cheap. Both the portal (/assets) and admin (/admin/assets) trees are covered.
func RevalidatingAssets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/assets/client.js", "/assets/client.css",
			"/admin/assets/client.js", "/admin/assets/client.css":
			next.ServeHTTP(&cacheControlWriter{ResponseWriter: w}, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

type cacheControlWriter struct{ http.ResponseWriter }

func (w *cacheControlWriter) WriteHeader(status int) {
	w.Header().Set("Cache-Control", "no-cache")
	w.ResponseWriter.WriteHeader(status)
}
