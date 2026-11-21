package store

import "olai/internal/secure"

func newID() string { return secure.ID() }
