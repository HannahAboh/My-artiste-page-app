// Reads and writes accounts in Supabase. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// This key can see everything, so it only ever lives in Cloudflare's secret settings, never in the website code.

export function makeStore(env, fetcher = fetch) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  async function call(path, { method = "GET", body, headers = {} } = {}) {
    if (!base || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
    const r = await fetcher(base + path, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) { const e = new Error(`Supabase ${r.status}: ${data?.msg || data?.message || text}`); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  const where = filter => Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join("&");
  const one = rows => (Array.isArray(rows) ? rows[0] || null : rows);

  return {
    async findAccount(filter) {
      if (Object.values(filter).some(v => v == null || v === "")) return null;
      return one(await call(`/rest/v1/accounts?${where(filter)}&limit=1`));
    },
    async accountsByStatus(status) {
      return call(`/rest/v1/accounts?status=eq.${status}&limit=1000`);
    },
    async createAccount(row) {
      return one(await call("/rest/v1/accounts", { method: "POST", body: row, headers: { Prefer: "return=representation" } }));
    },
    async updateAccount(id, patch) {
      return one(await call(`/rest/v1/accounts?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=representation" } }));
    },
    /** Returns false when this payment was already recorded. */
    async addPayment(row) {
      const rows = await call("/rest/v1/payments?on_conflict=reference", {
        method: "POST", body: row, headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
      });
      return Array.isArray(rows) && rows.length > 0;
    },
    async linkPayment(reference, accountId) {
      await call(`/rest/v1/payments?reference=eq.${encodeURIComponent(reference)}`, { method: "PATCH", body: { account_id: accountId } });
    },
    /** Makes the login (if new) and a one-time link to set a password. */
    async createLoginLink(email) {
      const make = type => call("/auth/v1/admin/generate_link", { method: "POST", body: { type, email } });
      let res, type = "invite";
      try { res = await make("invite"); }
      catch (e) {
        if (e.status !== 422 && e.status !== 400) throw e;
        type = "recovery"; // they already have a login: send a "set a new password" link instead
        res = await make("recovery");
      }
      const tokenHash = res.hashed_token || res.properties?.hashed_token;
      const userId = res.id || res.user?.id;
      if (!tokenHash) throw new Error("Supabase did not return a login link");
      return { type, tokenHash, userId };
    },
    /** The signed-in person behind a login token, or null. */
    async userFromToken(jwt) {
      if (!jwt) return null;
      try {
        const r = await fetcher(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } });
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    },
  };
}
