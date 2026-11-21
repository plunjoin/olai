package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"olai/internal/httpx"
	"olai/internal/secure"
	"olai/internal/store"
)

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"message": message}})
}

func parseFloat(value string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(value), 64)
}

var integerRE = regexp.MustCompile(`^\d+$`)

// readBody buffers at most max bytes; oversized uploads are rejected without
// retaining them. A small JSON envelope is all these routes ever accept.
func readBody(r *http.Request, max int64) ([]byte, bool) {
	if r.Body == nil {
		return nil, true
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil || int64(len(data)) > max {
		return nil, false
	}
	return data, true
}

func readJSONObject(r *http.Request, max int64) (map[string]any, error) {
	data, ok := readBody(r, max)
	if !ok {
		return nil, errBodyTooLarge
	}
	if len(data) == 0 {
		return nil, errInvalidJSON
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, errInvalidJSON
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errInvalidJSON
	}
	return object, nil
}

var (
	errBodyTooLarge = errors.New("request body too large")
	errInvalidJSON  = errors.New("invalid json object")
)

func pageParam(r *http.Request, limit int) int {
	raw := r.URL.Query().Get("page")
	if raw == "" {
		raw = "1"
	}
	if !integerRE.MatchString(raw) {
		return 0
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return 0
	}
	if value > 1_000_000 {
		value = 1_000_000
	}
	return (value - 1) * limit
}

func nextPage(offset, returned int, total int64, limit int) any {
	if int64(offset+returned) < total {
		return offset/limit + 2
	}
	return nil
}

func (s *Server) currentAdmin(w http.ResponseWriter, r *http.Request) (*store.AdminAccount, bool) {
	admin, err := s.Auth.CurrentAdmin(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "操作失败，请稍后重试。")
		return nil, false
	}
	if admin == nil {
		writeError(w, http.StatusUnauthorized, "请先登录管理后台。")
		return nil, false
	}
	return admin, true
}

// requireAdmin authenticates the administrator for every console API. It only
// accepts the console's own session cookie and account table; the portal login
// cookie never authorizes an admin request.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) (*store.AdminAccount, bool) {
	return s.currentAdmin(w, r)
}

func (s *Server) adminFailure(w http.ResponseWriter) {
	writeError(w, http.StatusServiceUnavailable, "操作失败，请稍后重试。")
}

func (s *Server) logAdmin(r *http.Request, admin *store.AdminAccount, action, target string, detail map[string]any) error {
	data, err := json.Marshal(detail)
	if err != nil {
		data = []byte("{}")
	}
	text := string(data)
	if len(text) > 4000 {
		text = text[:4000]
	}
	ip := "unknown"
	if value, err := httpx.ClientIP(r, s.Settings); err == nil {
		ip = value
	}
	return s.DB.InsertAdminLog(r.Context(), store.AdminLog{
		ID: secure.ID(), AdminID: admin.ID, AdminEmail: admin.Email,
		Action: action, Target: target, Detail: text, IP: ip, CreatedAt: time.Now().UnixMilli(),
	})
}

func safeInt(value any) (int64, bool) {
	number, ok := value.(float64)
	if !ok || number != float64(int64(number)) {
		return 0, false
	}
	return int64(number), true
}

func fmtInt(value int64) string { return fmt.Sprintf("%d", value) }

func lowerTrim(value string) string { return strings.ToLower(strings.TrimSpace(value)) }
