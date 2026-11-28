// Shared helpers for the sales and account pages: settings, sign-in, and talking to the server.
// Sign-in uses Supabase's login service directly with its public key (safe to show in a web page).

const SESSION = "map.session";
let configPromise;

export const $ = (s, el = document) => el.querySelector(s);

export function config() {
  return (configPromise ||= fetch("/api/config").then(r => r.json()));
}

export function money({ amount, currency }) {
  const n = amount / 100;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch { return `${currency} ${n}`; }
}

export function niceDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
}

function save(s) {
  if (!s?.access_token) return null;
  const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) };
  try { localStorage.setItem(SESSION, JSON.stringify(session)); } catch {}
  return session;
}
function load() {
  try { return JSON.parse(localStorage.getItem(SESSION) || "null"); } catch { return null; }
}
export function signOut() {
  try { localStorage.removeItem(SESSION); } catch {}
}

async function auth(path, body, token) {
  const c = await config();
  const r = await fetch(`${c.supabaseUrl}/auth/v1/${path}`, {
    method: body ? (path === "user" ? "PUT" : "POST") : "GET",
    headers: { apikey: c.supabaseAnonKey, "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "Something went wrong. Please try again.");
  return j;
}

export async function signIn(email, password) {
  try { return save(await auth("token?grant_type=password", { email, password })); }
  catch (e) { throw new Error(/invalid/i.test(e.message) ? "That email and password don't match." : e.message); }
}

/** Uses the one-time link from the email, then sets the password. */
export async function setPasswordWithLink(type, tokenHash, password) {
  let s;
  try { s = save(await auth("verify", { type, token_hash: tokenHash })); }
  catch { throw new Error("This link has expired or was already used. Ask for a new one below."); }
  await auth("user", { password }, s.access_token);
  return s;
}

export async function session() {
  let s = load();
  if (!s) return null;
  if (s.expires_at - 60 < Date.now() / 1000) {
    try { s = save(await auth("token?grant_type=refresh_token", { refresh_token: s.refresh_token })); }
    catch { signOut(); return null; }
  }
  return s;
}

/** Calls our own server. Signed-in calls carry the login token. */
export async function api(path, { method = "GET", body, signedIn = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (signedIn) {
    const s = await session();
    if (!s) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; throw new Error("Please sign in."); }
    headers.Authorization = `Bearer ${s.access_token}`;
  }
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && signedIn) { signOut(); location.href = "/login"; }
  if (!r.ok) { const e = new Error(j.error || "Something went wrong. Please try again."); e.data = j; throw e; }
  return j;
}

/** Where a signed-in artist should land. */
export async function homeFor(me) {
  if (me.locked) return "/account";
  if (!me.onboarded) return "/start";
  const c = await config();
  return c.dashboardUrl || "/account";
}

export function busy(btn, on) {
  btn.classList.toggle("busy", on);
  btn.disabled = on;
}

export function showMsg(el, text, ok = false) {
  el.textContent = text;
  el.classList.toggle("ok", ok);
  el.hidden = !text;
}

// Slide-up reveal for headings and cards, like the artist page.
export function reveals() {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) return els.forEach(e => e.classList.add("in"));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
  els.forEach(e => io.observe(e));
}
