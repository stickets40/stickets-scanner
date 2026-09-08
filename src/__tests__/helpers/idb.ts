import { closeDb } from "@/lib/idb";

/** Drop the whole database between tests (fake-indexeddb). */
export async function resetDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("stickets-scanner");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
