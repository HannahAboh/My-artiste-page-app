// Talks to Paystack (https://paystack.com/docs/api). Needs PAYSTACK_SECRET_KEY.

const API = "https://api.paystack.co";

export function makePaystack(env, fetcher = fetch) {
  const key = env.PAYSTACK_SECRET_KEY;
  async function call(method, path, body) {
    if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
    const r = await fetcher(API + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status === false) throw new Error(`Paystack ${path}: ${j.message || r.status}`);
    return j.data;
  }
  return {
    initialize: body => call("POST", "/transaction/initialize", body),
    verify: ref => call("GET", `/transaction/verify/${encodeURIComponent(ref)}`),
    disableSubscription: (code, token) => call("POST", "/subscription/disable", { code, token }),
    manageLink: code => call("GET", `/subscription/${encodeURIComponent(code)}/manage/link`).then(d => d.link),
    /** Finds our plan by name, or makes it the first time. Returns the plan code. */
    async findOrCreatePlan(p) {
      for (let page = 1; page <= 5; page++) {
        const list = await call("GET", `/plan?perPage=100&page=${page}`);
        const hit = (list || []).find(x => x.name === p.name && x.interval === p.interval && x.amount === p.amount && x.currency === p.currency && !x.is_deleted && !x.is_archived);
        if (hit) return hit.plan_code;
        if (!list || list.length < 100) break;
      }
      const made = await call("POST", "/plan", { name: p.name, interval: p.interval, amount: p.amount, currency: p.currency, description: "My Artiste Page plan" });
      return made.plan_code;
    },
  };
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

/** True when the webhook really came from Paystack (signed with our secret key). */
export async function validSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(rawBody)));
  const sig = String(signature).toLowerCase();
  if (mac.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
