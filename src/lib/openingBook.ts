// Bundled opening book built from lichess-org/chess-openings (CC0) by scripts/build-openings.mjs.
// Format: { [epd]: 0 | [eco, name] }  (0 = in book but not the end of a named line)
export type OpeningBook = Record<string, 0 | [string, string]>;

export const epd = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** true = in book (unnamed), object = in book with a name, null = out of book. */
export function bookLookup(book: OpeningBook, fen: string): { eco: string; name: string } | true | null {
  const v = book[epd(fen)];
  if (v === undefined) return null;
  return v === 0 ? true : { eco: v[0], name: v[1] };
}

let cached: Promise<OpeningBook> | null = null;
/** Browser: lazily fetch /openings.json (~730 KB, ~90 KB gzipped) once. */
export function loadOpeningBook(url = "/openings.json"): Promise<OpeningBook> {
  if (!cached) cached = fetch(url).then((r) => (r.ok ? r.json() : {}));
  return cached;
}
