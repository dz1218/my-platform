import { emptyCatalogFilters, type CatalogFilters } from '@/services/catalog';
import type { Gender } from '@/types/companion';
import type { Identity } from '@/types/companion';
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

