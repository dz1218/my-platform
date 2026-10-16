import type { createAuthFormStore } from './store';

/** Bind once per form owner. Strict Mode cleanup cancels both listener and timer. */
export function subscribeAuthCooldown(store: ReturnType<typeof createAuthFormStore>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe(s => s.cooldown, cooldown => {
    clearTimeout(timer);
    if (cooldown > 0) timer = setTimeout(() => store.getState().tickCooldown(), 1000);
  }, { fireImmediately: true });
  return () => { unsubscribe(); clearTimeout(timer); };
}
