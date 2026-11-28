// Safety checks for plans and payments, run with: npm test
// Uses pretend versions of Supabase, Paystack and email, so no real accounts are touched.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { makeBilling, parseSpotify, slugify, accountSummary } from "../worker/billing.js";
import { validSignature } from "../worker/paystack.js";
import { handle } from "../worker/index.js";

let n = 0;
const ok = msg => { n++; console.log(`ok ${n} - ${msg}`); };
const DAY = 86400000;

function world(start = "2026-12-01T09:00:00Z") {
  let clock = new Date(start).getTime();
  const accounts = [], payments = new Map(), sent = [], disabled = [], users = new Set();
  let id = 0;
  const store = {
    async findAccount(f) { const [[k, v]] = Object.entries(f); return v == null || v === "" ? null : accounts.find(a => a[k] === v) || null; },
    async accountsByStatus(s) { return accounts.filter(a => a.status === s).map(a => ({ ...a })); },
    async createAccount(row) { const a = { id: `acc${++id}`, user_id: null, reminders_sent: 0, cancel_at_period_end: false, onboarded: false, ...row }; accounts.push(a); return { ...a }; },
    async updateAccount(aid, patch) { const a = accounts.find(x => x.id === aid); Object.assign(a, patch); return { ...a }; },
    async addPayment(row) { if (payments.has(row.reference)) return false; payments.set(row.reference, row); return true; },
    async linkPayment(ref, aid) { payments.get(ref).account_id = aid; },
    async createLoginLink(email) { const type = users.has(email) ? "recovery" : "invite"; users.add(email); return { type, tokenHash: `hash-${email}`, userId: `user-${email}` }; },
  };
  const paystack = {
    async findOrCreatePlan(p) { return `PLN_${p.key}`; },
    async initialize(body) { return { authorization_url: `https://checkout.paystack.com/x?plan=${body.plan}`, reference: "ref-init", body }; },
    async verify(ref) { return payments.has(ref) || ref === "ref-paid" ? { status: "success", reference: ref, amount: 500, currency: "USD", paid_at: new Date(clock).toISOString(), plan: "PLN_monthly", customer: { email: "ada@example.com" }, metadata: { kind: "artist-plan", plan: "monthly" } } : { status: "abandoned" }; },
    async disableSubscription(code) { disabled.push(code); },
  };
  const mail = new Proxy({}, { get: (_, kind) => async (to, data) => { sent.push({ kind, to, ...data }); } });
  const env = { SITE_URL: "https://myartistepage.com", PRICE_CURRENCY: "USD", PRICE_MONTHLY: "500", PRICE_YEARLY: "5000", GRACE_DAYS: "7" };
  const billing = makeBilling({ store, paystack, mail, env, now: () => new Date(clock) });
  return { billing, accounts, payments, sent, disabled, env, tick: days => { clock += days * DAY; }, now: () => clock };
}

const charge = (over = {}) => ({
  event: "charge.success",
  data: { status: "success", reference: "ref1", amount: 500, currency: "USD", paid_at: "2026-12-01T09:00:00Z",
    customer: { email: "Ada@Example.com", customer_code: "CUS_1" }, plan: { plan_code: "PLN_monthly" },
    metadata: { kind: "artist-plan", plan: "monthly", full_name: "Ada Okafor", artist_name: "Ada" }, ...over },
});
const subCreate = (code = "SUB_1", email = "ada@example.com") => ({
  event: "subscription.create",
  data: { subscription_code: code, email_token: `tok-${code}`, next_payment_date: "2027-01-01T09:00:00Z", plan: { plan_code: "PLN_monthly" }, customer: { email } },
});

// --- checkout ---
{
  const w = world();
  const r = await w.billing.startCheckout({ email: " Ada@Example.com ", fullName: "Ada", plan: "monthly" });
  assert.match(r.url, /PLN_monthly/);
  assert.equal((await w.billing.startCheckout({ email: "nope", plan: "monthly" })).error, "Please check your email address.");
  assert.ok((await w.billing.startCheckout({ email: "a@b.co", plan: "weekly" })).error);
  ok("checkout sends the artist to Paystack with the right plan, and rejects bad input");
}

// --- payment creates the account once, sends one welcome email ---
{
  const w = world();
  const r = await w.billing.handleEvent(charge());
  assert.ok(r.created);
  assert.equal(w.accounts.length, 1);
  const a = w.accounts[0];
  assert.equal(a.email, "ada@example.com");
  assert.equal(a.status, "active");
  assert.equal(a.user_id, "user-ada@example.com");
  assert.equal(a.full_name, "Ada Okafor");
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].kind, "welcome");
  assert.equal(w.sent[0].link, "https://myartistepage.com/set-password?type=invite&token=hash-ada%40example.com");
  await w.billing.handleEvent(charge()); // Paystack sends the same news twice
  assert.equal(w.accounts.length, 1);
  assert.equal(w.sent.length, 1);
  // the welcome page confirming the same payment changes nothing either
  assert.deepEqual(await w.billing.confirmReference("ref1"), { status: "paid", email: "ada@example.com" });
  assert.equal(w.sent.length, 1);
  ok("a confirmed payment creates the account and one set-password email, even if reported twice");
}

// --- fan tips and merch on the same Paystack account are ignored ---
{
  const w = world();
  const r = await w.billing.handleEvent(charge({ plan: {}, metadata: { kind: "tip" }, reference: "tip1" }));
  assert.ok(r.ignored);
  assert.equal(w.accounts.length, 0);
  assert.ok((await w.billing.handleEvent(charge({ status: "failed" }))).ignored);
  ok("payments that aren't artist plans never create accounts");
}

// --- subscription news, and the order Paystack sends it in ---
{
  const w = world();
  const early = await w.billing.handleEvent(subCreate());
  assert.ok(early.retry, "subscription before payment asks Paystack to resend");
  await w.billing.handleEvent(charge());
  await w.billing.handleEvent(subCreate());
  assert.equal(w.accounts[0].subscription_code, "SUB_1");
  assert.equal(w.accounts[0].paid_until, "2027-01-01T09:00:00Z");
  ok("the subscription is saved, even when Paystack's news arrives out of order");
}

// --- renewal fails: reminders, grace period, lock, then payment brings it back ---
{
  const w = world();
  await w.billing.handleEvent(charge());
  await w.billing.handleEvent(subCreate());
  w.tick(31);
  await w.billing.handleEvent({ event: "invoice.payment_failed", data: { subscription: { subscription_code: "SUB_1" }, customer: { email: "ada@example.com" } } });
  const a = w.accounts[0];
  assert.equal(a.status, "past_due");
  assert.equal(w.sent.at(-1).kind, "paymentFailed");
  assert.equal(w.sent.at(-1).payUrl, "https://myartistepage.com/join?plan=monthly&email=ada%40example.com&renew=1");
  assert.equal(accountSummary(a, w.env).locked, false, "page stays live during the grace period");

  w.tick(1); await w.billing.dailyCheck();
  assert.equal(w.sent.filter(s => s.kind === "reminder").length, 0, "no reminder the very next day");
  w.tick(1); await w.billing.dailyCheck();
  assert.equal(w.sent.at(-1).kind, "reminder");
  assert.equal(w.sent.at(-1).days, 5);
  w.tick(2); await w.billing.dailyCheck();
  assert.equal(w.sent.filter(s => s.kind === "reminder").length, 2);
  w.tick(2); await w.billing.dailyCheck();
  assert.equal(w.sent.filter(s => s.kind === "reminder").length, 2, "at most three emails before the lock");
  w.tick(1); await w.billing.dailyCheck();
  assert.equal(a.status, "locked");
  assert.equal(w.sent.at(-1).kind, "paused");
  assert.equal(accountSummary(a, w.env).locked, true);

  // they pay again with a new card from the email
  await w.billing.handleEvent(charge({ reference: "ref2", paid_at: new Date(w.now()).toISOString() }));
  assert.equal(a.status, "active");
  assert.equal(a.grace_until, null);
  assert.equal(w.sent.at(-1).kind, "restored");
  await w.billing.handleEvent(subCreate("SUB_2"));
  assert.deepEqual(w.disabled, ["SUB_1"], "the old plan is stopped so it never charges twice");
  assert.equal(a.subscription_code, "SUB_2");
  ok("failed renewal: email, page live for 7 days, reminders, lock, and paying brings it back");
}

// --- a renewal reported only as a paid invoice still counts ---
{
  const w = world();
  await w.billing.handleEvent(charge());
  await w.billing.handleEvent(subCreate());
  w.tick(31);
  await w.billing.handleEvent({ event: "invoice.payment_failed", data: { subscription: { subscription_code: "SUB_1" }, customer: { email: "ada@example.com" } } });
  await w.billing.handleEvent({ event: "invoice.update", data: { paid: true, status: "success", subscription: { subscription_code: "SUB_1", next_payment_date: "2027-02-01T09:00:00Z" }, customer: { email: "ada@example.com" } } });
  assert.equal(w.accounts[0].status, "active");
  assert.equal(w.accounts[0].paid_until, "2027-02-01T09:00:00Z");
  w.tick(10); await w.billing.dailyCheck();
  assert.equal(w.accounts[0].status, "active");
  ok("a renewal paid on a retry clears the reminders and keeps the page live");
}

// --- a missing renewal (no news at all from Paystack) is caught by the daily check ---
{
  const w = world();
  await w.billing.handleEvent(charge());
  await w.billing.handleEvent(subCreate());
  w.tick(33); await w.billing.dailyCheck();
  assert.equal(w.accounts[0].status, "past_due");
  ok("if a renewal silently never arrives, the daily check starts the grace period");
}

// --- cancelling: live until the paid time runs out, then locked ---
{
  const w = world();
  await w.billing.handleEvent(charge());
  await w.billing.handleEvent(subCreate());
  await w.billing.handleEvent({ event: "subscription.not_renew", data: { subscription_code: "SUB_1", customer: { email: "ada@example.com" } } });
  w.tick(20); await w.billing.dailyCheck();
  assert.equal(w.accounts[0].status, "active");
  w.tick(12); await w.billing.dailyCheck();
  assert.equal(w.accounts[0].status, "locked");
  assert.equal(w.sent.at(-1).kind, "ended");
  ok("a cancelled plan stays live until the end of the paid month, then pauses");
}

// --- yearly renewal moves the date a year on ---
{
  const w = world();
  await w.billing.handleEvent(charge({ plan: { plan_code: "PLN_yearly" }, metadata: { kind: "artist-plan", plan: "yearly" } }));
  const until = new Date(w.accounts[0].paid_until).getTime() - new Date("2026-12-01T09:00:00Z").getTime();
  assert.equal(until / DAY, 366);
  assert.equal(w.accounts[0].plan, "yearly");
  ok("yearly plans are paid up for a year");
}

// --- webhook signature ---
{
  const body = JSON.stringify({ event: "charge.success", data: {} });
  const sig = createHmac("sha512", "sk_test_abc").update(body).digest("hex");
  assert.equal(await validSignature(body, sig, "sk_test_abc"), true);
  assert.equal(await validSignature(body, sig, "sk_test_other"), false);
  assert.equal(await validSignature(body + " ", sig, "sk_test_abc"), false);
  assert.equal(await validSignature(body, "", "sk_test_abc"), false);
  const res = await handle(new Request("https://x.test/api/paystack/webhook", { method: "POST", body, headers: { "x-paystack-signature": "nope" } }), { PAYSTACK_SECRET_KEY: "sk_test_abc" }, () => { throw new Error("no network in tests"); });
  assert.equal(res.status, 401);
  ok("only messages really signed by Paystack are accepted");
}

// --- Spotify links and web names ---
{
  assert.deepEqual(parseSpotify("https://open.spotify.com/artist/5YKklNWFgD4II8iXeaXGjf?si=abc"), { type: "artist", id: "5YKklNWFgD4II8iXeaXGjf", url: "https://open.spotify.com/artist/5YKklNWFgD4II8iXeaXGjf" });
  assert.equal(parseSpotify("open.spotify.com/intl-fr/show/4rOoJ6Egrf8K2IrywzwOMk").type, "show");
  assert.equal(parseSpotify("spotify:artist:5YKklNWFgD4II8iXeaXGjf").id, "5YKklNWFgD4II8iXeaXGjf");
  assert.equal(parseSpotify("https://open.spotify.com/track/5YKklNWFgD4II8iXeaXGjf"), null);
  assert.equal(parseSpotify("https://evil.com/open.spotify.com/artist/5YKklNWFgD4II8iXeaXGjf"), null);
  assert.equal(slugify("Hannah Aboh"), "hannah-aboh");
  assert.equal(slugify("Beyoncé & Jay"), "beyonce-and-jay");
  assert.equal(slugify("!!!"), "artist");
  ok("Spotify artist and podcast links are read correctly; web names are clean");
}

// --- public settings never include secret keys ---
{
  const env = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "SECRET1", PAYSTACK_SECRET_KEY: "SECRET2", RESEND_API_KEY: "SECRET3" };
  const res = await handle(new Request("https://x.test/api/config"), env, () => { throw new Error("no network"); });
  const text = await res.text();
  assert.ok(!/SECRET/.test(text));
  assert.equal(JSON.parse(text).prices.monthly.amount, 500);
  ok("the public settings never reveal a secret key");
}

console.log(`\nAll ${n} billing checks passed.`);
