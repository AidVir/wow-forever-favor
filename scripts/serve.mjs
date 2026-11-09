// Local preview server: serves this folder with caching turned off, so every reload shows your latest
// edits. Price and sales data are fetched fresh from GitHub (the price bot updates them every hour);
// pass --local-data to use the copies in data/ instead.
//
//   node scripts/serve.mjs [port] [--local-data]      (or double-click serve.cmd)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const PORT = Number(args.find(a => /^\d+$/.test(a)) || 5178);
const LIVE = !args.includes("--local-data");
const LIVE_FILES = new Set(["/data/prices.json", "/data/sales.json", "/data/trends.json"]);
const RAW = "https://raw.githubusercontent.com/AidVir/wow-forever-favor/main";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const headers = { "Cache-Control": "no-store", "Content-Type": TYPES[extname(path)] || "application/octet-stream" };
  try {
    if (LIVE && LIVE_FILES.has(path)) {
      const r = await fetch(RAW + path + "?t=" + Date.now()).catch(() => null);
      if (r?.ok) { res.writeHead(200, headers); return res.end(Buffer.from(await r.arrayBuffer())); }
      console.warn("Could not fetch live", path, "- using local copy");
    }
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(normalize(ROOT))) throw new Error("outside root");
    const body = await readFile(file);
    res.writeHead(200, headers); res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found");
  }
}).listen(PORT, () => {
  console.log(`WoW Forever tools running at http://localhost:${PORT}/`);
  console.log(LIVE ? "Prices and sales: live from GitHub. Code: this folder (no cache)." : "Using local data/ files.");
  console.log("Press Ctrl+C to stop.");
});
