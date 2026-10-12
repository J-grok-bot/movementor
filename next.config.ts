import type { NextConfig } from "next";

// Stockfish runs as the single-threaded lite WASM build, which does NOT need SharedArrayBuffer,
// so no COOP/COEP (cross-origin isolation) headers are required. If you switch to a
// multi-threaded build, add:
//   { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
//   { key: "Cross-Origin-Embedder-Policy", value: "require-corp" }
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/stockfish/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/stockfish/:file*.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/openings.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;
