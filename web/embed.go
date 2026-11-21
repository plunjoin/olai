// Package webui embeds the build outputs of the two independent frontends:
// portal (SSR for the public site plus the client-rendered studio) and admin
// (a client-only SPA). Keeping the embed directives here means //go:embed can
// reach both dist directories with paths relative to web/.
package webui

import "embed"

//go:embed all:portal/dist
var PortalFS embed.FS

//go:embed all:admin/dist
var AdminFS embed.FS
