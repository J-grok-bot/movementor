// Generates MoveMentor app icons (PNG + ICO) from one SVG source. usage: node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = "#18181b";
// Logo glyph (from public/logo.svg), drawn in a 64-unit box; arrow nudged up-right for clearance; bbox incl. strokes ≈ x 11–55.5, y 14.5–49.
const glyph = `
  <path d="M14 46V20l12 14 12-14v26" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <g transform="translate(4 -2)">
    <path d="M40 30l9-11m0 0h-8m8 0v8" fill="none" stroke="#1e1b4b" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M40 30l9-11m0 0h-8m8 0v8" fill="none" stroke="#facc15" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

/** Square, fully opaque icon. `content` = glyph width as a fraction of the canvas. */
function svg(size, content) {
  const s = (size * content) / 44.5; // glyph bbox width
  const tx = size / 2 - 33.25 * s;
  const ty = size / 2 - 31.75 * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="70%">
      <stop offset="0" stop-color="#312e81"/><stop offset="0.55" stop-color="#1e1b4b"/><stop offset="1" stop-color="${BG}"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <g transform="translate(${tx} ${ty}) scale(${s})">${glyph}</g>
</svg>`;
}

const out = "public/icons";
mkdirSync(out, { recursive: true });
const png = (size, content) => sharp(Buffer.from(svg(size, content))).flatten({ background: BG }).png().toBuffer();

writeFileSync("assets/app-icon.svg", svg(1024, 0.6));
const jobs = [
  ["apple-touch-icon.png", 180, 0.6],
  ["apple-touch-icon-167.png", 167, 0.6],
  ["apple-touch-icon-152.png", 152, 0.6],
  ["icon-192.png", 192, 0.6],
  ["icon-512.png", 512, 0.6],
  ["icon-maskable-512.png", 512, 0.46], // glyph stays inside the 80% safe-zone circle
  ["favicon-32.png", 32, 0.78],
  ["favicon-16.png", 16, 0.82],
];
for (const [name, size, c] of jobs) writeFileSync(`${out}/${name}`, await png(size, c));
writeFileSync("public/apple-touch-icon.png", await png(180, 0.6)); // default path iOS probes

// favicon.ico with embedded PNGs (16, 32, 48)
const imgs = await Promise.all([16, 32, 48].map((s) => png(s, s <= 16 ? 0.82 : 0.78)));
const head = Buffer.alloc(6 + 16 * imgs.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
let off = head.length;
imgs.forEach((b, i) => {
  const s = [16, 32, 48][i], e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12);
  off += b.length;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([head, ...imgs]));
writeFileSync("src/app/icon.svg", svg(64, 0.78));

// docs preview: 512 icon in an iOS-style rounded mask next to the maskable circle crop
const icon = await png(512, 0.6), mask = await png(512, 0.46);
const rr = Buffer.from(`<svg width="512" height="512"><rect width="512" height="512" rx="114" fill="#fff"/></svg>`);
const circ = Buffer.from(`<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="#fff"/></svg>`);
const a = await sharp(icon).composite([{ input: rr, blend: "dest-in" }]).png().toBuffer();
const b = await sharp(mask).composite([{ input: circ, blend: "dest-in" }]).png().toBuffer();
await sharp({ create: { width: 1184, height: 640, channels: 4, background: "#f4f4f5" } })
  .composite([{ input: a, left: 64, top: 64 }, { input: b, left: 608, top: 64 }])
  .png().toFile("docs/app-icon-preview.png");
console.log("icons written");
