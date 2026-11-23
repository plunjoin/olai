package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	appversion "olai/internal/version"
)

// siteUpdateAPIBase is a variable so tests can point the GitHub client at a
// local fake without changing the production endpoint.
var (
	siteUpdateAPIBase    = "https://api.github.com"
	siteUpdateHTTPClient = &http.Client{Timeout: 15 * time.Second}
)

var (
	siteUpdateTagPattern = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$`)
	siteUpdateRepoRE     = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	siteUpdateFlowRE     = regexp.MustCompile(`^[A-Za-z0-9_.-]+\.ya?ml$`)
	siteUpdateRefRE      = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)
)

type siteUpdateConfig struct {
	Enabled  bool
	Repo     string
	Workflow string
	Ref      string
	Token    string
}

func (c siteUpdateConfig) ready() bool {
	return c.Enabled && siteUpdateRepoRE.MatchString(c.Repo) && !strings.Contains(c.Repo, "..") &&
		siteUpdateFlowRE.MatchString(c.Workflow) && siteUpdateRefRE.MatchString(c.Ref) &&
		!strings.Contains(c.Ref, "..") && c.Token != ""
}

func (s *Server) siteUpdateConfig() siteUpdateConfig {
	return siteUpdateConfig{
		Enabled:  s.Settings.Get("SITE_UPDATE_ENABLED") == "true",
		Repo:     strings.TrimSpace(s.Settings.Get("SITE_UPDATE_REPO")),
		Workflow: strings.TrimSpace(s.Settings.Get("SITE_UPDATE_WORKFLOW")),
		Ref:      strings.TrimSpace(s.Settings.Get("SITE_UPDATE_REF")),
		Token:    strings.TrimSpace(s.Settings.Get("SITE_UPDATE_TOKEN")),
	}
}

type siteUpdateTag struct {
	Name string `json:"name"`
	SHA  string `json:"sha,omitempty"`
}

type siteUpdateRun struct {
	ID           int64  `json:"id"`
	Status       string `json:"status"`
	Conclusion   string `json:"conclusion,omitempty"`
	DisplayTitle string `json:"displayTitle,omitempty"`
	Event        string `json:"event,omitempty"`
	HeadBranch   string `json:"headBranch,omitempty"`
	CreatedAt    string `json:"createdAt,omitempty"`
	UpdatedAt    string `json:"updatedAt,omitempty"`
	HTMLURL      string `json:"htmlUrl,omitempty"`
}

type siteUpdateStatus struct {
	Enabled         bool            `json:"enabled"`
	Configured      bool            `json:"configured"`
	Current         appversion.Info `json:"current"`
	Repo            string          `json:"repo,omitempty"`
	Workflow        string          `json:"workflow,omitempty"`
	Ref             string          `json:"ref,omitempty"`
	LatestTag       string          `json:"latestTag,omitempty"`
	UpdateAvailable bool            `json:"updateAvailable"`
	Tags            []siteUpdateTag `json:"tags"`
	Runs            []siteUpdateRun `json:"runs"`
	Error           string          `json:"error,omitempty"`
}

type githubTag struct {
	Name   string `json:"name"`
	Commit struct {
		SHA string `json:"sha"`
	} `json:"commit"`
}

type githubWorkflowRun struct {
	ID           int64  `json:"id"`
	Status       string `json:"status"`
	Conclusion   string `json:"conclusion"`
	DisplayTitle string `json:"display_title"`
	Event        string `json:"event"`
	HeadBranch   string `json:"head_branch"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
	HTMLURL      string `json:"html_url"`
}

type githubWorkflowRuns struct {
	WorkflowRuns []githubWorkflowRun `json:"workflow_runs"`
}

func (s *Server) siteUpdateRequest(ctx context.Context, cfg siteUpdateConfig, method, path string, payload any) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, siteUpdateAPIBase+path, body)
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", "olai-site-update")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if cfg.Token != "" {
		request.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	response, err := siteUpdateHTTPClient.Do(request)
	if err != nil {
		return 0, nil, fmt.Errorf("无法连接 GitHub：%w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return response.StatusCode, nil, fmt.Errorf("读取 GitHub 响应失败：%w", err)
	}
	return response.StatusCode, data, nil
}

func githubFailure(status int, data []byte) string {
	var payload struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(data, &payload)
	switch status {
	case http.StatusUnauthorized:
		return "GitHub 令牌无效或已过期。"
	case http.StatusForbidden:
		return "GitHub 拒绝访问，请确认令牌具有 Actions: Read and write 与 Contents: Read 权限。"
	case http.StatusNotFound:
		return "GitHub 仓库、部署工作流或版本不存在。"
	case http.StatusUnprocessableEntity:
		return "GitHub 无法触发该工作流，请确认工作流包含 workflow_dispatch，且分支与参数有效。"
	}
	if payload.Message != "" {
		return fmt.Sprintf("GitHub 返回 %d：%s", status, payload.Message)
	}
	return fmt.Sprintf("GitHub 返回 %d。", status)
}

func (s *Server) siteUpdateTags(ctx context.Context, cfg siteUpdateConfig) ([]siteUpdateTag, error) {
	status, data, err := s.siteUpdateRequest(ctx, cfg, http.MethodGet,
		"/repos/"+cfg.Repo+"/tags?per_page=100", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, errors.New(githubFailure(status, data))
	}
	var raw []githubTag
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, errors.New("GitHub 版本列表格式无效。")
	}
	tags := make([]siteUpdateTag, 0, len(raw))
	for _, tag := range raw {
		if !siteUpdateTagPattern.MatchString(tag.Name) {
			continue
		}
		tags = append(tags, siteUpdateTag{Name: tag.Name, SHA: tag.Commit.SHA})
	}
	sort.SliceStable(tags, func(i, j int) bool {
		left, leftOK := appversion.Normalize(tags[i].Name)
		right, rightOK := appversion.Normalize(tags[j].Name)
		if !leftOK || !rightOK {
			return tags[i].Name > tags[j].Name
		}
		if compared, ok := appversion.Compare(left, right); ok && compared != 0 {
			return compared > 0
		}
		return tags[i].Name > tags[j].Name
	})
	return tags, nil
}

func (s *Server) siteUpdateRuns(ctx context.Context, cfg siteUpdateConfig) ([]siteUpdateRun, error) {
	status, data, err := s.siteUpdateRequest(ctx, cfg, http.MethodGet,
		"/repos/"+cfg.Repo+"/actions/workflows/"+url.PathEscape(cfg.Workflow)+"/runs?per_page=8", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, errors.New(githubFailure(status, data))
	}
	var raw githubWorkflowRuns
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, errors.New("GitHub 部署记录格式无效。")
	}
	runs := make([]siteUpdateRun, 0, len(raw.WorkflowRuns))
	for _, run := range raw.WorkflowRuns {
		runs = append(runs, siteUpdateRun{
			ID: run.ID, Status: run.Status, Conclusion: run.Conclusion,
			DisplayTitle: run.DisplayTitle, Event: run.Event, HeadBranch: run.HeadBranch,
			CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt, HTMLURL: run.HTMLURL,
		})
	}
	return runs, nil
}

func latestSiteUpdateTag(tags []siteUpdateTag) string {
	for _, tag := range tags {
		if !strings.Contains(tag.Name, "-") {
			return tag.Name
		}
	}
	if len(tags) > 0 {
		return tags[0].Name
	}
	return ""
}

func siteUpdateAvailable(current, latest string) bool {
	if latest == "" {
		return false
	}
	currentVersion, currentOK := appversion.Normalize(current)
	latestVersion, latestOK := appversion.Normalize(latest)
	if !currentOK || !latestOK {
		return false
	}
	compared, ok := appversion.Compare(currentVersion, latestVersion)
	return ok && compared < 0
}

func activeSiteUpdateRun(runs []siteUpdateRun) *siteUpdateRun {
	for index := range runs {
		switch runs[index].Status {
		case "queued", "in_progress", "waiting", "requested", "pending":
			return &runs[index]
		}
	}
	return nil
}

func (s *Server) handleAdminSiteUpdate(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	s.Settings.Refresh(r.Context(), true)
	cfg := s.siteUpdateConfig()
	response := siteUpdateStatus{
		Enabled: cfg.Enabled, Configured: cfg.ready(), Current: appversion.Current(),
		Repo: cfg.Repo, Workflow: cfg.Workflow, Ref: cfg.Ref,
		Tags: []siteUpdateTag{}, Runs: []siteUpdateRun{},
	}
	if !cfg.Enabled {
		writeJSON(w, http.StatusOK, response)
		return
	}
	if !cfg.ready() {
		response.Error = "请先配置 GitHub 仓库、部署工作流、分支和令牌。"
		writeJSON(w, http.StatusOK, response)
		return
	}
	tags, err := s.siteUpdateTags(r.Context(), cfg)
	if err != nil {
		response.Error = err.Error()
		writeJSON(w, http.StatusOK, response)
		return
	}
	response.Tags = tags
	response.LatestTag = latestSiteUpdateTag(tags)
	response.UpdateAvailable = siteUpdateAvailable(response.Current.Version, response.LatestTag)
	runs, err := s.siteUpdateRuns(r.Context(), cfg)
	if err != nil {
		response.Error = err.Error()
		writeJSON(w, http.StatusOK, response)
		return
	}
	response.Runs = runs
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleAdminSiteUpdateStart(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	s.siteUpdateMu.Lock()
	defer s.siteUpdateMu.Unlock()
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "不允许跨站调用。")
		return
	}
	input, err := readJSONObject(r, 8*1024)
	if err != nil {
		writeError(w, http.StatusBadRequest, "更新参数无效。")
		return
	}
	tag, _ := input["tag"].(string)
	tag = strings.TrimSpace(tag)
	if !siteUpdateTagPattern.MatchString(tag) {
		writeError(w, http.StatusBadRequest, "版本 tag 无效，例如 v1.5.0。")
		return
	}
	s.Settings.Refresh(r.Context(), true)
	cfg := s.siteUpdateConfig()
	if !cfg.Enabled {
		writeError(w, http.StatusConflict, "整站更新尚未启用。")
		return
	}
	if !cfg.ready() {
		writeError(w, http.StatusConflict, "请先配置 GitHub 仓库、部署工作流、分支和令牌。")
		return
	}
	runs, err := s.siteUpdateRuns(r.Context(), cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if active := activeSiteUpdateRun(runs); active != nil {
		writeError(w, http.StatusConflict, "已有整站部署正在进行，请等待当前部署结束后再试。")
		return
	}
	status, data, err := s.siteUpdateRequest(r.Context(), cfg, http.MethodGet,
		"/repos/"+cfg.Repo+"/git/ref/tags/"+url.PathEscape(tag), nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if status == http.StatusNotFound {
		writeError(w, http.StatusBadRequest, "GitHub 上找不到这个版本 tag，请确认镜像发布完成。")
		return
	}
	if status != http.StatusOK {
		writeError(w, http.StatusBadGateway, githubFailure(status, data))
		return
	}
	status, data, err = s.siteUpdateRequest(r.Context(), cfg, http.MethodPost,
		"/repos/"+cfg.Repo+"/actions/workflows/"+url.PathEscape(cfg.Workflow)+"/dispatches",
		map[string]any{"ref": cfg.Ref, "inputs": map[string]string{"tag": tag}})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if status != http.StatusNoContent && status != http.StatusCreated {
		writeError(w, http.StatusBadGateway, githubFailure(status, data))
		return
	}
	_ = s.logAdmin(r, admin, "site.update", tag, map[string]any{
		"repo": cfg.Repo, "workflow": cfg.Workflow, "ref": cfg.Ref,
	})
	writeJSON(w, http.StatusAccepted, map[string]any{
		"ok": true, "tag": tag,
		"message": "已触发整站部署。GitHub Actions 会按部署脚本备份数据（如适用），再拉取新镜像并做健康检查；成功后站点会自动重启，失败会自动回滚。",
	})
}
