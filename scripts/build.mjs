// Builds one finished page per artist.
//   template/page.html              the shared page design (one for every artist)
//   artists/<slug>/settings.json    that artist's content, colours and on/off switches
//   artists/<slug>/photos/          that artist's photos
// Output: dist/<slug>/index.html plus the artist's photos, ready to upload to any static host.
//
// Run: npm run build            (all artists)
//      npm run build hannah-aboh (one artist)

import { readFile, writeFile, readdir, mkdir, cp, rm, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS = { classic: "#f2ece2", linen: "#f2ece4", midnight: "#eef3f8", rose: "#f7eee6", onyx: "#0f0f11" };
const SECTION_KEYS = ["videos", "listen", "release", "tour", "store", "support", "mailingList", "booking"];
const HEX = /^#[0-9a-f]{6}$/i;

const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// JSON that is safe to place inside a <script> tag
const scriptJson = v => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16));
const exists = p => access(p).then(() => true, () => false);
const isLocal = p => typeof p === "string" && p !== "" && !/^(https?:|data:)/.test(p);

/** Returns a list of plain-language problems with an artist's settings (empty when all is well). */
export async function check(site, folder) {
  const problems = [];
  const slug = folder.split(/[\\/]/).pop();
  if (!site.name || typeof site.name !== "string") problems.push("name is missing.");
  if (site.slug !== slug) problems.push(`slug should be "${slug}", the same as the folder name.`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(site.slug || "")) problems.push("slug may only use small letters, numbers and dashes, like hannah-aboh.");
  for (const k of SECTION_KEYS)
    if (typeof site.sections?.[k] !== "boolean") problems.push(`sections.${k} must be true or false.`);
  const t = site.theme;
  if (typeof t === "string") { if (!PRESETS[t]) problems.push(`theme "${t}" is not one of: ${Object.keys(PRESETS).join(", ")}.`); }
  else if (t && typeof t === "object") {
    for (const k of ["background", "text", "main", "accent"])
      if (!HEX.test(t[k] || "")) problems.push(`theme.${k} must be a colour like #1f3550.`);
  } else problems.push("theme is missing.");
  const photos = [site.bio?.photo, site.bio?.cutout, site.bio?.backdrop, site.share?.image].filter(isLocal);
  for (const p of photos) if (!(await exists(join(folder, p)))) problems.push(`photo not found: ${p}`);
  if (!site.bio?.photo) problems.push("bio.photo is missing (the main photo at the top of the page).");
  return problems;
}

function headFor(site) {
  const share = site.share || {};
  const title = share.title || [site.name, site.descriptor].filter(Boolean).join(" · ");
  const desc = share.description || site.bio?.short || "";
  const base = (site.siteUrl || "").replace(/\/$/, "");
  const abs = p => (!p ? "" : /^https?:/.test(p) ? p : base ? `${base}/${p.replace(/^\//, "")}` : `/${p.replace(/^\//, "")}`);
  const image = abs(share.image);
  const bg = typeof site.theme === "string" ? PRESETS[site.theme] : site.theme?.background || PRESETS.classic;
  const sameAs = [site.youtube, site.spotifyArtist, site.artistPage, site.socials?.instagram, site.socials?.tiktok]
    .filter(u => u && /^https?:/.test(u));
  const ld = { "@context": "https://schema.org", "@type": "MusicGroup", name: site.name, description: desc, ...(image && { image }), ...(sameAs.length && { sameAs: [...new Set(sameAs)] }) };
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
    `<title>${escHtml(title)}</title>`,
    share.hideFromSearch ? `<meta name="robots" content="noindex, nofollow">` : "",
    `<meta name="description" content="${escHtml(desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escHtml(site.name)}">`,
    `<meta property="og:description" content="${escHtml(desc)}">`,
    base ? `<meta property="og:url" content="${escHtml(base)}/">` : "",
    image ? `<meta property="og:image" content="${escHtml(image)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="theme-color" content="${escHtml(bg)}">`,
    `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Ccircle cx=%2712%27 cy=%2712%27 r=%2712%27 fill=%27%231e1814%27/%3E%3Cpath fill=%27%23f2ece2%27 d=%27M10 6v7.1A2.6 2.6 0 1 0 11.4 15.4V9l5-1.2v3.9a2.6 2.6 0 1 0 1.4 2.3V4.6Z%27/%3E%3C/svg%3E">`,
    `<script type="application/ld+json">${scriptJson(ld)}</script>`,
    `<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>`,
  ].filter(Boolean).join("\n");
}

/** Turns the template and one artist's settings into the finished page HTML. */
export function render(template, site) {
  const page = { ...site };
  const first = String(site.name || "").trim().split(/\s+/)[0] || "the artist";
  let html = template
    .replace("{{HEAD}}", () => headFor(site))
    .replace("/*@SITE*/{}/*@END*/", () => scriptJson(page))
    .replaceAll("{{firstName}}", escHtml(first))
    .replaceAll("{{name}}", escHtml(site.name));
  return html;
}

export async function buildArtist(slug, template) {
  const folder = join(ROOT, "artists", slug);
  const site = JSON.parse(await readFile(join(folder, "settings.json"), "utf8"));
  const problems = await check(site, folder);
  if (problems.length) throw new Error(`${slug}:\n  - ${problems.join("\n  - ")}`);
  const out = join(ROOT, "dist", slug);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "index.html"), render(template, site));
  if (await exists(join(folder, "photos"))) await cp(join(folder, "photos"), join(out, "photos"), { recursive: true });
  // the link-in-bio page (yourdomain/links) is the same page in a different mode
  await writeFile(join(out, "_redirects"), "/links  /index.html  200\n");
  await writeFile(join(out, "robots.txt"), site.share?.hideFromSearch ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\n");
  return out;
}

export async function artistSlugs() {
  const dirs = await readdir(join(ROOT, "artists"), { withFileTypes: true });
  const slugs = [];
  for (const d of dirs) if (d.isDirectory() && (await exists(join(ROOT, "artists", d.name, "settings.json")))) slugs.push(d.name);
  return slugs.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const template = await readFile(join(ROOT, "template", "page.html"), "utf8");
  const wanted = process.argv.slice(2);
  const slugs = wanted.length ? wanted : await artistSlugs();
  let failed = 0;
  for (const slug of slugs) {
    try { const out = await buildArtist(slug, template); console.log(`Built ${slug} -> ${out.replace(ROOT + "/", "")}/index.html`); }
    catch (e) { failed++; console.error(`Could not build ${e.message}`); }
  }
  if (failed) process.exit(1);
}
