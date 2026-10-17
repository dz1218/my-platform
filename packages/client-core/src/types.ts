/** Functional updates read the current store snapshot, including inside SDK callbacks. */
export type StateUpdate<T> = T | ((current: T) => T);
