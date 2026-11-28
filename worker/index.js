// The website's server, running on Cloudflare Workers.
// It serves the sales and account pages (from web/) and answers these addresses:
//
//   GET  /api/config              public settings the pages need (prices, Supabase public key)
//   POST /api/checkout            start a Paystack payment for a plan
//   GET  /api/confirm?reference=  after payment: has it gone through?
//   POST /api/paystack/webhook    Paystack's payment news (signed)
//   POST /api/forgot              email a "set a new password" link
//   GET  /api/me                  the signed-in artist's account
//   POST /api/onboarding          save the artist's Spotify link (first login)
//   POST /api/billing/card        a Paystack link to change the card on file
//   GET  /api/site-status?slug=   is this artist's page live, or "coming back soon"?
//
// Once a day (see wrangler.toml) it sends reminders and locks pages whose grace period is over.

import { makeBilling, accountSummary, parseSpotify, slugify, cleanEmail } from "./billing.js";
import { makePaystack, validSignature } from "./paystack.js";
import { makeStore } from "./store.js";
import { makeMail } from "./mail.js";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

export function services(env, fetcher = fetch) {
  const store = makeStore(env, fetcher);
  const paystack = makePaystack(env, fetcher);
  const mail = makeMail(env, fetcher);
  return { store, paystack, mail, billing: makeBilling({ store, paystack, mail, env }) };
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function signedIn(request, store) {
  const auth = request.headers.get("Authorization") || "";
  const user = await store.userFromToken(auth.replace(/^Bearer\s+/i, ""));
  if (!user?.id) return {};
  const acc = (await store.findAccount({ user_id: user.id })) || (await store.findAccount({ email: cleanEmail(user.email) }));
  if (acc && !acc.user_id) await store.updateAccount(acc.id, { user_id: user.id });
  return { user, acc };
}

async function spotifyDetails(env, ref, fetcher) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return {};
  try {
    const t = await fetcher("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }).then(r => r.json());
    const r = await fetcher(`https://api.spotify.com/v1/${ref.type}s/${ref.id}?market=US`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (!r.ok) return {};
    const d = await r.json();
    return { name: d.name, image: d.images?.[0]?.url };
  } catch { return {}; }
}

async function uniqueSlug(store, name, accId) {
  const base = slugify(name);
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const taken = await store.findAccount({ slug });
    if (!taken || taken.id === accId) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function handle(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const { store, paystack, mail, billing } = services(env, fetcher);
  const site = String(env.SITE_URL || url.origin).replace(/\/$/, "");
  const is = (m, p) => request.method === m && path === p;

  try {
    if (is("GET", "/api/config")) {
      const p = billing.plans;
      return json({
        brand: env.BRAND_NAME || "My Artiste Page",
        supabaseUrl: env.SUPABASE_URL || "",
        supabaseAnonKey: env.SUPABASE_ANON_KEY || "",
        dashboardUrl: env.DASHBOARD_URL || "",
        prices: { monthly: { amount: p.monthly.amount, currency: p.monthly.currency }, yearly: { amount: p.yearly.amount, currency: p.yearly.currency } },
      }, 200, { "Cache-Control": "public, max-age=300" });
    }

    if (is("POST", "/api/checkout")) {
      const b = await readJson(request);
      const r = await billing.startCheckout({ email: b.email, fullName: b.fullName, artistName: b.artistName, plan: b.plan });
      return json(r, r.error ? 400 : 200);
    }

    if (is("GET", "/api/confirm")) return json(await billing.confirmReference(url.searchParams.get("reference")));

    if (is("POST", "/api/paystack/webhook")) {
      const raw = await request.text();
      if (!(await validSignature(raw, request.headers.get("x-paystack-signature"), env.PAYSTACK_SECRET_KEY)))
        return json({ error: "bad signature" }, 401);
      const r = await billing.handleEvent(JSON.parse(raw));
      // A 500 tells Paystack to send the same news again a little later.
      return json({ ok: !r.retry, ...(r.ignored && { ignored: r.ignored }) }, r.retry ? 500 : 200);
    }

    if (is("POST", "/api/forgot")) {
      const email = cleanEmail((await readJson(request)).email);
      const acc = email && (await store.findAccount({ email }));
      if (acc) {
        try {
          const link = await store.createLoginLink(email);
          if (!acc.user_id && link.userId) await store.updateAccount(acc.id, { user_id: link.userId });
          await mail.reset(email, { name: acc.full_name, link: `${site}/set-password?type=${link.type}&token=${encodeURIComponent(link.tokenHash)}` });
        } catch (e) { console.error("forgot failed", e.message); }
      }
      // Same answer either way, so nobody can test which emails have accounts.
      return json({ ok: true });
    }

    if (is("GET", "/api/me")) {
      const { user, acc } = await signedIn(request, store);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!acc) return json({ error: "No plan found for this email." }, 404);
      return json(accountSummary(acc, env));
    }

    if (is("POST", "/api/onboarding")) {
      const { user, acc } = await signedIn(request, store);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!acc) return json({ error: "No plan found for this email." }, 404);
      const b = await readJson(request);
      const patch = { onboarded: true };
      if (b.skip !== true) {
        const ref = parseSpotify(b.spotifyUrl);
        if (!ref) return json({ error: "That doesn't look like a Spotify artist or podcast link. It should start with open.spotify.com/artist/ or open.spotify.com/show/." }, 400);
        const d = await spotifyDetails(env, ref, fetcher);
        Object.assign(patch, { spotify_url: ref.url, spotify_type: ref.type, spotify_id: ref.id, spotify_name: d.name || null, spotify_image: d.image || null });
      }
      if (b.artistName) patch.artist_name = String(b.artistName).trim().slice(0, 80);
      const name = patch.artist_name || patch.spotify_name || acc.artist_name || acc.full_name || acc.email.split("@")[0];
      if (!acc.slug) patch.slug = await uniqueSlug(store, name, acc.id);
      return json(accountSummary(await store.updateAccount(acc.id, patch), env));
    }

    if (is("POST", "/api/billing/card")) {
      const { user, acc } = await signedIn(request, store);
      if (!user || !acc) return json({ error: "Please sign in." }, 401);
      if (!acc.subscription_code) return json({ url: accountSummary(acc, env).payUrl });
      return json({ url: await paystack.manageLink(acc.subscription_code) });
    }

    if (is("GET", "/api/site-status")) {
      const acc = await store.findAccount({ slug: url.searchParams.get("slug") || "" });
      if (!acc) return json({ live: false, reason: "not found" }, 404);
      return json({ live: acc.status !== "locked", name: acc.artist_name || acc.spotify_name || "" }, 200, { "Cache-Control": "public, max-age=60" });
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error(path, e.stack || e.message);
    return json({ error: "Something went wrong on our side. Please try again in a minute." }, 500);
  }

  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
}

export default {
  fetch: (request, env) => handle(request, env),
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(services(env).billing.dailyCheck().then(log => console.log("daily check", log)));
  },
};
