package server

import (
	"net/http"

	"olai/internal/models"
)

func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	catalog, err := s.Models.PublicCatalog(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
		return
	}
	if catalog.Models == nil {
		catalog.Models = []models.PublicModel{}
	}
	writeJSON(w, http.StatusOK, catalog)
}
