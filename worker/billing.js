// The money rules for artist plans, in one place.
// Nothing in here talks to the internet directly: the store (Supabase), paystack and mail
// helpers are handed in, so the rules can be tested without real accounts.
//
// Life of an account:
//   pays on Paystack  ->  account created, "set your password" email
//   renews by itself  ->  Paystack charges the card each month or year, we push paid_until forward
//   renewal fails     ->  past_due: reminder emails, page stays live for GRACE_DAYS
//   still unpaid      ->  locked: page shows "coming back soon", dashboard shows a pay-now screen
//   pays again        ->  active, everything comes back

const DAY = 86400000;

export const PLAN_KIND = "artist-plan"; // marks our own checkouts, so fan tips and merch sales are ignored

export function planSettings(env) {
  const currency = (env.PRICE_CURRENCY || "USD").toUpperCase();
  return {
    monthly: { key: "monthly", interval: "monthly", days: 31, amount: Number(env.PRICE_MONTHLY || 500), currency, name: "Artist page, monthly" },
    yearly: { key: "yearly", interval: "annually", days: 366, amount: Number(env.PRICE_YEARLY || 5000), currency, name: "Artist page, yearly" },
  };
}

export const cleanEmail = e => String(e || "").trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function slugify(name) {
  return String(name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40).replace(/-+$/, "") || "artist";
}

/** Reads a Spotify artist or podcast link. Returns { type, id, url } or null. */
export function parseSpotify(input) {
  const s = String(input || "").trim();
  let m = s.match(/^spotify:(artist|show):([A-Za-z0-9]{22})$/);
  if (!m) m = s.match(/^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(artist|show)\/([A-Za-z0-9]{22})(?:[/?#].*)?$/i);
  if (!m) return null;
  const type = m[1].toLowerCase();
  return { type, id: m[2], url: `https://open.spotify.com/${type}/${m[2]}` };
}

export function makeBilling({ store, paystack, mail, env, now = () => new Date() }) {
  const plans = planSettings(env);
  const site = String(env.SITE_URL || "").replace(/\/$/, "");
  const graceDays = Number(env.GRACE_DAYS || 7);
  const iso = d => new Date(d).toISOString();
  const later = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b);

  const renewUrl = acc => `${site}/join?plan=${acc.plan}&email=${encodeURIComponent(acc.email)}&renew=1`;
  const loginUrl = link => `${site}/set-password?type=${link.type}&token=${encodeURIComponent(link.tokenHash)}`;

  // Paystack plan codes: made once in Paystack by this code, then remembered.
  let planCodes = null;
  async function codes() {
    if (planCodes) return planCodes;
    const found = {};
    for (const p of Object.values(plans)) {
      const fromEnv = env[`PAYSTACK_PLAN_${p.key.toUpperCase()}`];
      found[p.key] = fromEnv || (await paystack.findOrCreatePlan(p));
    }
    return (planCodes = found);
  }
  async function planFromCode(code) {
    const c = await codes();
    return Object.keys(c).find(k => c[k] === code) || null;
  }

  async function sendLogin(acc, kind) {
    try {
      const link = await store.createLoginLink(acc.email);
      if (link.userId && link.userId !== acc.user_id) acc = await store.updateAccount(acc.id, { user_id: link.userId });
      await mail[kind](acc.email, { name: acc.full_name, link: loginUrl(link), site });
    } catch (e) {
      console.error("could not send login email", acc.email, e.message);
    }
    return acc;
  }

  /** Step 1: the artist picks a plan and is sent to Paystack's secure payment page. */
  async function startCheckout({ email, fullName, artistName, plan }) {
    email = cleanEmail(email);
    if (!validEmail(email)) return { error: "Please check your email address." };
    if (!plans[plan]) return { error: "Please pick monthly or yearly." };
    const existing = await store.findAccount({ email });
    if (existing && existing.status === "active" && !existing.cancel_at_period_end && new Date(existing.paid_until) > now())
      return { error: "This email already has an active plan. Sign in instead.", signIn: true };
    const code = (await codes())[plan];
    const init = await paystack.initialize({
      email,
      amount: plans[plan].amount,
      currency: plans[plan].currency,
      plan: code,
      callback_url: `${site}/welcome`,
      channels: ["card"],
      metadata: { kind: PLAN_KIND, plan, full_name: String(fullName || "").slice(0, 80), artist_name: String(artistName || "").slice(0, 80) },
    });
    return { url: init.authorization_url, reference: init.reference };
  }

  /** A payment Paystack has confirmed. Creates or revives the account. Safe to run twice. */
  async function paymentConfirmed(data) {
    if (data.status && data.status !== "success") return { ignored: "not successful" };
    const meta = typeof data.metadata === "object" && data.metadata ? data.metadata : {};
    const planCode = typeof data.plan === "string" ? data.plan : data.plan?.plan_code || data.plan_object?.plan_code;
    const plan = (await planFromCode(planCode)) || (meta.kind === PLAN_KIND ? meta.plan : null);
    if (!plans[plan]) return { ignored: "not an artist plan payment" };
    const email = cleanEmail(data.customer?.email);
    const paidAt = data.paid_at || data.paidAt || data.transaction_date || iso(now());
    const until = iso(new Date(paidAt).getTime() + plans[plan].days * DAY);

    let acc = await store.findAccount({ email });
    const fresh = await store.addPayment({ reference: data.reference, account_id: acc?.id || null, email, plan, amount: data.amount, currency: data.currency, paid_at: paidAt });
    if (!fresh && acc) return { account: acc, duplicate: true };

    if (!acc) {
      acc = await store.createAccount({
        email, plan, status: "active", paid_until: until,
        full_name: meta.full_name || null, artist_name: meta.artist_name || null,
        paystack_customer: data.customer?.customer_code || null,
      });
      await store.linkPayment(data.reference, acc.id);
      acc = await sendLogin(acc, "welcome");
      return { account: acc, created: true };
    }

    const wasDown = acc.status !== "active";
    acc = await store.updateAccount(acc.id, {
      plan, status: "active", paid_until: later(acc.paid_until && new Date(acc.paid_until) > now() ? acc.paid_until : null, until),
      grace_until: null, reminders_sent: 0, last_reminder_at: null,
      paystack_customer: data.customer?.customer_code || acc.paystack_customer,
    });
    await store.linkPayment(data.reference, acc.id);
    if (!acc.user_id) acc = await sendLogin(acc, "welcome");
    else if (wasDown) await mail.restored(acc.email, { name: acc.full_name, site });
    return { account: acc, revived: wasDown };
  }

  async function findBySubscription(data) {
    const code = data.subscription_code || data.subscription?.subscription_code;
    return (code && (await store.findAccount({ subscription_code: code }))) ||
      (await store.findAccount({ email: cleanEmail(data.customer?.email) }));
  }

  async function subscriptionCreated(data) {
    if (!(await planFromCode(data.plan?.plan_code))) return { ignored: "not an artist plan" };
    const acc = await store.findAccount({ email: cleanEmail(data.customer?.email) });
    // Paystack sometimes sends this before the payment news. Say "try again" so Paystack resends it.
    if (!acc) return { retry: true };
    if (acc.subscription_code && acc.subscription_code !== data.subscription_code) {
      // They paid again with a new card (for example from a reminder email): stop the old plan so it never charges twice.
      try { await paystack.disableSubscription(acc.subscription_code, acc.subscription_token); }
      catch (e) { console.error("could not stop old subscription", acc.subscription_code, e.message); }
    }
    const updated = await store.updateAccount(acc.id, {
      subscription_code: data.subscription_code,
      subscription_token: data.email_token,
      plan: (await planFromCode(data.plan?.plan_code)) || acc.plan,
      cancel_at_period_end: false,
      paid_until: later(acc.paid_until, data.next_payment_date || null),
    });
    return { account: updated };
  }

  async function paymentFailed(data) {
    const acc = await findBySubscription(data);
    if (!acc) return { ignored: "unknown account" };
    if (acc.status !== "active") return { account: acc };
    const updated = await store.updateAccount(acc.id, {
      status: "past_due", grace_until: iso(now().getTime() + graceDays * DAY),
      reminders_sent: 1, last_reminder_at: iso(now()),
    });
    await mail.paymentFailed(acc.email, { name: acc.full_name, payUrl: renewUrl(acc), days: graceDays, site });
    return { account: updated };
  }

  async function subscriptionStopped(data, why) {
    const acc = await findBySubscription(data);
    if (!acc || acc.subscription_code !== (data.subscription_code || data.subscription?.subscription_code)) return { ignored: "not the current plan" };
    // The page stays live until the time already paid for runs out; the daily check locks it after that.
    return { account: await store.updateAccount(acc.id, { cancel_at_period_end: true }), why };
  }

  /** A renewal Paystack has collected (sent alongside, or instead of, the payment news). */
  async function invoicePaid(data) {
    if (!(data.paid === true || data.status === "success")) return { ignored: "invoice not paid" };
    const acc = await findBySubscription(data);
    if (!acc) return { ignored: "unknown account" };
    const wasDown = acc.status !== "active";
    const updated = await store.updateAccount(acc.id, {
      status: "active", grace_until: null, reminders_sent: 0, last_reminder_at: null,
      paid_until: later(acc.paid_until, data.subscription?.next_payment_date || null),
    });
    if (wasDown) await mail.restored(acc.email, { name: acc.full_name, site });
    return { account: updated };
  }

  async function cardsExpiring(list) {
    for (const item of Array.isArray(list) ? list : []) {
      const acc = await findBySubscription(item);
      if (acc && acc.status === "active") await mail.cardExpiring(acc.email, { name: acc.full_name, site, accountUrl: `${site}/account` });
    }
    return { ok: true };
  }

  /** Paystack's news, sent to /api/paystack/webhook (the signature is checked before this). */
  async function handleEvent(evt) {
    const d = evt?.data || {};
    switch (evt?.event) {
      case "charge.success": return paymentConfirmed(d);
      case "subscription.create": return subscriptionCreated(d);
      case "invoice.payment_failed": return paymentFailed(d);
      case "invoice.update": return invoicePaid(d);
      case "subscription.not_renew": return subscriptionStopped(d, "not_renew");
      case "subscription.disable": return subscriptionStopped(d, "disabled");
      case "subscription.expiring_cards": return cardsExpiring(d);
      default: return { ignored: evt?.event || "no event" };
    }
  }

  /** The welcome page asks this right after payment, so the artist doesn't wait for the webhook. */
  async function confirmReference(reference) {
    if (!/^[A-Za-z0-9._=-]{3,100}$/.test(String(reference || ""))) return { status: "unknown" };
    const tx = await paystack.verify(reference);
    if (!tx || tx.status !== "success") return { status: tx?.status === "abandoned" || tx?.status === "failed" ? "failed" : "pending" };
    const r = await paymentConfirmed(tx);
    if (r.ignored) return { status: "unknown" };
    return { status: "paid", email: r.account.email };
  }

  /** Runs once a day: reminders, grace periods and locking. */
  async function dailyCheck() {
    const t = now().getTime();
    const log = [];
    for (const acc of await store.accountsByStatus("past_due")) {
      if (acc.grace_until && t >= new Date(acc.grace_until).getTime()) {
        await store.updateAccount(acc.id, { status: "locked" });
        await mail.paused(acc.email, { name: acc.full_name, payUrl: renewUrl(acc), site });
        log.push(`locked ${acc.email}`);
      } else if (acc.reminders_sent < 3 && (!acc.last_reminder_at || t - new Date(acc.last_reminder_at).getTime() >= 2 * DAY)) {
        const days = Math.max(1, Math.ceil((new Date(acc.grace_until).getTime() - t) / DAY));
        await store.updateAccount(acc.id, { reminders_sent: acc.reminders_sent + 1, last_reminder_at: iso(t) });
        await mail.reminder(acc.email, { name: acc.full_name, payUrl: renewUrl(acc), days, site });
        log.push(`reminded ${acc.email}`);
      }
    }
    for (const acc of await store.accountsByStatus("active")) {
      if (!acc.paid_until) continue;
      const over = t - new Date(acc.paid_until).getTime();
      if (acc.cancel_at_period_end && over >= 0) {
        await store.updateAccount(acc.id, { status: "locked" });
        await mail.ended(acc.email, { name: acc.full_name, payUrl: renewUrl(acc), site });
        log.push(`ended ${acc.email}`);
      } else if (!acc.cancel_at_period_end && over >= 2 * DAY) {
        // The renewal never came through (and no failure news either): treat it as a failed payment.
        log.push(`overdue ${acc.email}`);
        await paymentFailed({ subscription_code: acc.subscription_code, customer: { email: acc.email } });
      }
    }
    return log;
  }

  return { plans, startCheckout, handleEvent, confirmReference, dailyCheck, paymentConfirmed, renewUrl };
}

/** What the artist's own pages and dashboard need to know about their account. */
export function accountSummary(acc, env) {
  if (!acc) return null;
  const site = String(env.SITE_URL || "").replace(/\/$/, "");
  return {
    email: acc.email,
    fullName: acc.full_name,
    artistName: acc.artist_name || acc.spotify_name,
    slug: acc.slug,
    plan: acc.plan,
    status: acc.status,
    locked: acc.status === "locked",
    paidUntil: acc.paid_until,
    graceUntil: acc.grace_until,
    endsAtPeriodEnd: !!acc.cancel_at_period_end,
    onboarded: !!acc.onboarded,
    spotifyUrl: acc.spotify_url,
    payUrl: `${site}/join?plan=${acc.plan}&email=${encodeURIComponent(acc.email)}&renew=1`,
  };
}
