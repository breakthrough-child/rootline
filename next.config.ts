import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / wasm / binary packages stay as runtime requires instead of being bundled.
  serverExternalPackages: ["tesseract.js", "@napi-rs/canvas", "pdfjs-dist", "ffmpeg-static", "mammoth", "xlsx", "jszip"],
  // Make sure the demo fixtures and the ffmpeg binary ship with the serverless functions.
  outputFileTracingIncludes: {
    "/api/demo/[id]": ["./fixtures/*.json"],
    "/api/status": ["./fixtures/*.json"],
    "/api/run": ["./fixtures/*.json"],
    "/api/extract": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*"],
  },
  poweredByHeader: false,
};

export default nextConfig;
