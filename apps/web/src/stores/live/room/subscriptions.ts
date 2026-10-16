import type { createLiveRoomStore } from './store';

export function subscribeRoomNotice(store: ReturnType<typeof createLiveRoomStore>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe(s => s.notice, notice => {
    clearTimeout(timer);
    if (notice) timer = setTimeout(() => store.getState().setNotice(''), 4000);
  }, { fireImmediately: true });
  return () => { unsubscribe(); clearTimeout(timer); };
}
