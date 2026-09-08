/** Window events the modules use to talk without importing each other's React trees. */
export const QUEUE_CHANGED_EVENT = "stickets:queue-changed";
export const QUEUE_DRAIN_EVENT = "stickets:queue-drain";
export const AUTH_REQUIRED_EVENT = "stickets:auth-required";
export const AUTH_RESTORED_EVENT = "stickets:auth-restored";
export const MANIFEST_CHANGED_EVENT = "stickets:manifest-changed";
export const SHIFT_CHANGED_EVENT = "stickets:shift-changed";

function emit(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }));
}

export const notifyQueueChanged = () => emit(QUEUE_CHANGED_EVENT);
export const requestQueueDrain = () => emit(QUEUE_DRAIN_EVENT);
export const notifyAuthRequired = (code: string) => emit(AUTH_REQUIRED_EVENT, { code });
export const notifyAuthRestored = () => emit(AUTH_RESTORED_EVENT);
export const notifyManifestChanged = () => emit(MANIFEST_CHANGED_EVENT);
export const notifyShiftChanged = () => emit(SHIFT_CHANGED_EVENT);
