// In-memory IndexedDB for the scan-queue tests. Node 20 provides globalThis.crypto
// (subtle + randomUUID), so no crypto polyfill is needed.
import "fake-indexeddb/auto";
