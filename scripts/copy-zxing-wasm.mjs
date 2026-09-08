// Self-host the ZXing decoder. zxing-wasm loads `zxing_reader.wasm` from the
// jsDelivr CDN by default — blocked by our CSP (connect-src 'self') and, more
// importantly, unreachable on a venue network without internet. The scanner
// must decode offline, so the binary ships with the app and is precached.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// zxing-wasm's package.json is not exported: resolve the reader entry
// (dist/cjs/reader/index.js) and walk up to the package root.
let pkgRoot = dirname(require.resolve("zxing-wasm/reader"));
while (!existsSync(join(pkgRoot, "dist", "reader", "zxing_reader.wasm"))) {
  const parent = dirname(pkgRoot);
  if (parent === pkgRoot) throw new Error("zxing_reader.wasm not found under zxing-wasm");
  pkgRoot = parent;
}
const src = join(pkgRoot, "dist", "reader", "zxing_reader.wasm");
const outDir = join(root, "public", "zxing");
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, "zxing_reader.wasm"));
console.log(`zxing_reader.wasm → public/zxing (${statSync(src).size} bytes)`);
