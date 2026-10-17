import type { IdentityStore } from './store';

export const identitySelectors = {
  view: (s: IdentityStore) => ({
    pending: s.pending, claimId: s.claimId, requestedGender: s.requestedGender, claimError: s.claimError, skipError: s.skipError, genderError: s.genderError,
    selectedId: s.selectedId,
    selectedSnapshot: s.selectedSnapshot,
    filters: s.filters,
    gender: s.gender,
  }),
};

