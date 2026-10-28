// Static server for dev/out (the harness fetches sample.table, which file:// can't do).
import { createServer } from "http";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "dev/out");
const port = Number(process.env.PORT ?? 5199);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".table": "application/json" };

createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(root, path.normalize(name));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`e2e server on http://localhost:${port}`));
