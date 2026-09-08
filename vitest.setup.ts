// In-memory IndexedDB for the queue / manifest tests. Node exposes a
// `localStorage` getter that is undefined without --localstorage-file (and it
// shadows jsdom's), and jsdom's window lacks a full WebCrypto (randomUUID) —
// give every environment working versions of both. jest-dom matchers are
// harmless under node.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";

const g = globalThis as unknown as { crypto?: Crypto; localStorage?: Storage };
if (!g.crypto || typeof g.crypto.randomUUID !== "function") {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
if (!g.localStorage || typeof g.localStorage.setItem !== "function") {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true });
}
