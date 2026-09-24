package matching

import (
	"companion/server/internal/identity"
	"context"
)

type Service struct {
	Repo       Repository
	Identities identity.Repository
}

func (s Service) Meet(ctx context.Context, userID, identityID string) (Match, error) {
	if _, err := s.Identities.Get(ctx, identityID); err != nil {
		return Match{}, err
	}
	return s.Repo.Create(ctx, userID, identityID)
}
