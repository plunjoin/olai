package server

import (
	"testing"

	"olai/internal/config"
)

// TestModelsManagerHasPricing guards the dependency wiring: models.DefaultPrices
// dereferences Pricing, so a manager built without it panics on the admin model
// catalog and on gateway sync.
func TestModelsManagerHasPricing(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	if app.Models.Pricing == nil {
		t.Fatal("models.Manager.Pricing is nil; DefaultPrices would panic")
	}
	if app.Models.Pricing != app.Pricing {
		t.Fatal("models.Manager.Pricing is not the server's pricing manager")
	}
}
