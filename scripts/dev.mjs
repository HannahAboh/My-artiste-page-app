// Try the sales and account pages on your own computer: npm run dev, then open http://localhost:8787
// Keys come from a file called .dev.vars (never committed), one per line: PAYSTACK_SECRET_KEY=sk_test_...
// Without keys the pages still open, but payments and sign-in won't work.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../worker/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { SITE_URL: "http://localhost:8787" };
for (const m of (await readFile(join(ROOT, "wrangler.toml"), "utf8")).matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)) env[m[1]] = m[2];
try { for (const l of (await readFile(join(ROOT, ".dev.vars"), "utf8")).split("\n")) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/); if (m) env[m[1]] = m[2]; } } catch {}
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

env.ASSETS = {
  async fetch(req) {
    let p = new URL(req.url).pathname;
    if (p.endsWith("/")) p += "index.html";
    if (!extname(p)) p += ".html";
    try { return new Response(await readFile(join(ROOT, "web", p.replace(/\.\.+/g, ""))), { headers: { "Content-Type": types[extname(p)] || "application/octet-stream" } }); }
    catch { return new Response(await readFile(join(ROOT, "web", "404.html")), { status: 404, headers: { "Content-Type": types[".html"] } }); }
  },
};

createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await handle(new Request(`http://localhost:8787${req.url}`, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log("Open http://localhost:8787"));
