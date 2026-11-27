// Quick safety checks, run with: npm test
// Builds every artist, then makes sure each finished page is complete.
import { readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { artistSlugs, buildArtist, check, render } from "./build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(join(ROOT, "template", "page.html"), "utf8");
let n = 0;
const ok = msg => { n++; console.log(`ok ${n} - ${msg}`); };

assert.ok(template.includes("/*@SITE*/{}/*@END*/"), "template has the settings slot");
assert.ok(template.startsWith("{{HEAD}}"), "template starts with the head slot");
ok("template has its slots");

for (const slug of await artistSlugs()) {
  const out = await buildArtist(slug, template);
  const html = await readFile(join(out, "index.html"), "utf8");
  const site = JSON.parse(await readFile(join(ROOT, "artists", slug, "settings.json"), "utf8"));
  assert.ok(!/\{\{\w+\}\}|\/\*@SITE\*\//.test(html), `${slug}: no slots left unfilled`);
  const m = html.match(/const SITE = (\{.*?\});  \/\/ this artist/s);
  assert.ok(m, `${slug}: settings are in the page`);
  assert.deepEqual(JSON.parse(m[1]), site, `${slug}: settings in the page match settings.json`);
  assert.ok(html.includes(`<title>`) && html.startsWith("<!doctype html>"), `${slug}: page has a proper head`);
  for (const p of [site.bio.photo, site.bio.cutout, site.bio.backdrop, site.share?.image].filter(p => p && !/^https?:|^data:/.test(p)))
    await access(join(out, p));
  ok(`${slug}: built, settings and photos in place`);
}

// settings with mistakes are caught with a readable message
const bad = await check({ name: "", slug: "Bad Name", sections: {}, theme: "purple", bio: {} }, join(ROOT, "artists", "nobody"));
assert.ok(bad.some(p => p.includes("name is missing")));
assert.ok(bad.some(p => p.includes('theme "purple"')));
assert.ok(bad.some(p => p.includes("sections.videos")));
ok("broken settings are reported in plain words");

// names with HTML characters cannot break the page
const tricky = render(template, { name: "A </script><b>", slug: "x", bio: {}, sections: {}, theme: "classic" });
assert.ok(!tricky.includes("</script><b>"), "script tag is escaped");
ok("artist text is escaped safely");

console.log(`\nAll ${n} checks passed.`);
