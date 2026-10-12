// Copies the single-threaded "lite" Stockfish WASM build into /public so the
// browser can load it as a Web Worker. Single-threaded = no COOP/COEP headers needed.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const src = dirname(require.resolve("stockfish/package.json"));
const out = join(process.cwd(), "public", "stockfish");
mkdirSync(out, { recursive: true });
for (const f of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) {
  const from = join(src, "bin", f);
  if (!existsSync(from)) throw new Error(`Missing ${from}`);
  copyFileSync(from, join(out, f));
}
copyFileSync(join(src, "Copying.txt"), join(out, "COPYING-GPLv3.txt"));
console.log("Copied Stockfish lite single-threaded build to public/stockfish/");
