// Browser adapter only: no account data or credentials travel in this event.
export const SESSION_INVALIDATED_EVENT = 'radio-friday:session-invalidated';
export function requestSessionVerification() {
  window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT));
}
