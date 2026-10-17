import { emptyCatalogFilters, type CatalogFilters } from '@my-platform/shared';
import type { Gender } from '@my-platform/shared';
import type { Identity } from '@my-platform/shared';
type InheritanceCandidate = Identity & { available: boolean };

export type IdentityState = {
  pending: 'inherit' | 'skip' | 'gender' | null;
  claimId: string | null;
  requestedGender: Gender | null;
  claimError: Error | null;
  skipError: Error | null;
  genderError: Error | null;
  lastInheritedId: string | null;
  selectedId: string | null;
  selectedSnapshot: InheritanceCandidate | null;
  filters: CatalogFilters;
  gender: Gender | '';
};

export const initialIdentityState = (): IdentityState => ({
  pending: null, claimId: null, requestedGender: null, claimError: null, skipError: null, genderError: null, lastInheritedId: null,
  selectedId: null,
  selectedSnapshot: null,
  filters: { ...emptyCatalogFilters },
  gender: '',
});

