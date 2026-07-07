// Small cross-section navigation bus so the assistant (and other views) can ask
// the Mail section to open a specific email by id, even before it has mounted.

type EmailOpener = (emailId: string) => void;

let opener: EmailOpener | null = null;
let pending: string | null = null;

/** Mail view registers its opener on mount; flushes any queued request. */
export function registerEmailOpener(fn: EmailOpener): void {
  opener = fn;
  if (pending) {
    const id = pending;
    pending = null;
    fn(id);
  }
}

export function unregisterEmailOpener(fn: EmailOpener): void {
  if (opener === fn) opener = null;
}

/** Open an email by id; queues if the Mail view isn't mounted yet. */
export function requestOpenEmail(emailId: string): void {
  if (opener) opener(emailId);
  else pending = emailId;
}
