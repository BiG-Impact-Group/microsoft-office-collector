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

// ── OneDrive "reveal a file's folder" bus (assistant document sources) ──
export interface RevealTarget {
  folderId?: string;
  folderName?: string;
  highlightId?: string;
}
type OneDriveOpener = (target: RevealTarget) => void;

let odOpener: OneDriveOpener | null = null;
let odPending: RevealTarget | null = null;

export function registerOneDriveOpener(fn: OneDriveOpener): void {
  odOpener = fn;
  if (odPending) {
    const t = odPending;
    odPending = null;
    fn(t);
  }
}
export function unregisterOneDriveOpener(fn: OneDriveOpener): void {
  if (odOpener === fn) odOpener = null;
}
/** Reveal a folder (and optionally highlight an item) in the OneDrive view;
 *  queues if that view isn't mounted yet. */
export function requestRevealOneDrive(target: RevealTarget): void {
  if (odOpener) odOpener(target);
  else odPending = target;
}
