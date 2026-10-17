import type { Mutate, StoreApi } from 'zustand/vanilla';

type DomainStore<T> = Mutate<StoreApi<T>, [['zustand/subscribeWithSelector', never]]>;

/** Attach web presentation fields while retaining one store and subscription
 * graph. Called only by factories before the instance escapes; getInitialState
 * includes presentation so SSR and React's first snapshot agree. */
export function withPresentation<T, U>(
  store: DomainStore<T>,
  presentation: (set: StoreApi<T & U>['setState'], get: () => T & U) => U,
): DomainStore<T & U> {
  const composed = store as unknown as DomainStore<T & U>;
  const initial = { ...store.getInitialState(), ...presentation(composed.setState, composed.getState) };
  composed.setState(initial, true);
  composed.getInitialState = () => initial;
  return composed;
}
