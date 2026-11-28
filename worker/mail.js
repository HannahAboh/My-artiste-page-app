// Sends the account emails through Resend (https://resend.com). Needs RESEND_API_KEY and EMAIL_FROM.
// Every email is short, plain and has one black button.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function emailHtml({ brand, heading, lines, button, url, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f2ece2;font-family:Helvetica,Arial,sans-serif;color:#1e1814">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2ece2;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fbf8f3;border-radius:20px;padding:36px 28px">
<tr><td style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#7a6c5f;padding-bottom:18px">${esc(brand)}</td></tr>
<tr><td style="font-size:26px;line-height:1.1;font-weight:800;text-transform:uppercase;letter-spacing:-0.5px;padding-bottom:16px">${esc(heading)}</td></tr>
${lines.map(l => `<tr><td style="font-size:15px;line-height:1.55;color:#3a2f27;padding-bottom:12px">${esc(l)}</td></tr>`).join("")}
${url ? `<tr><td style="padding:14px 0 8px"><a href="${esc(url)}" style="display:inline-block;background:#1e1814;color:#f2ece2;text-decoration:none;border-radius:99px;padding:14px 26px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase">${esc(button)}</a></td></tr>
<tr><td style="font-size:12px;line-height:1.5;color:#7a6c5f;padding-top:10px">If the button doesn't work, copy this link into your browser:<br><a href="${esc(url)}" style="color:#7a6c5f;word-break:break-all">${esc(url)}</a></td></tr>` : ""}
${footer ? `<tr><td style="font-size:12px;line-height:1.5;color:#7a6c5f;padding-top:18px">${esc(footer)}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
}

export function makeMail(env, fetcher = fetch) {
  const brand = env.BRAND_NAME || "My Artiste Page";
  const hi = name => (name ? `Hi ${String(name).split(/\s+/)[0]},` : "Hi,");
  async function send(to, subject, parts) {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) { console.warn(`email not sent (Resend not set up): ${subject} -> ${to}`); return; }
    const text = [parts.heading, ...parts.lines, parts.url ? `${parts.button}: ${parts.url}` : "", parts.footer || ""].filter(Boolean).join("\n\n");
    const r = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html: emailHtml({ brand, ...parts }), text, ...(env.EMAIL_REPLY_TO && { reply_to: env.EMAIL_REPLY_TO }) }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  }
  const help = "Questions? Just reply to this email.";
  return {
    welcome: (to, { name, link }) => send(to, `Welcome to ${brand}: set your password`, {
      heading: "You're in", button: "Set your password", url: link, footer: "This link works once and expires in 24 hours. " + help,
      lines: [hi(name), "Your payment went through and your account is ready.", "Set a password, then paste your Spotify link and we'll start building your page."],
    }),
    reset: (to, { name, link }) => send(to, `${brand}: set a new password`, {
      heading: "New password", button: "Set a new password", url: link, footer: "Didn't ask for this? You can ignore this email.",
      lines: [hi(name), "Tap the button to choose a new password."],
    }),
    paymentFailed: (to, { name, payUrl, days }) => send(to, "Your payment didn't go through", {
      heading: "Payment didn't go through", button: "Pay now", url: payUrl, footer: help,
      lines: [hi(name), "We tried to renew your plan but your card was declined.", `Your page stays live for ${days} more days. Pay now with any card to keep it up.`],
    }),
    reminder: (to, { name, payUrl, days }) => send(to, `Reminder: ${days} day${days === 1 ? "" : "s"} left to keep your page live`, {
      heading: `${days} day${days === 1 ? "" : "s"} left`, button: "Pay now", url: payUrl, footer: help,
      lines: [hi(name), "Your plan payment is still outstanding.", `If it isn't paid in ${days} day${days === 1 ? "" : "s"}, your page will be paused and fans will see a "coming back soon" page.`],
    }),
    paused: (to, { name, payUrl }) => send(to, "Your page is paused", {
      heading: "Your page is paused", button: "Pay and bring it back", url: payUrl, footer: help,
      lines: [hi(name), "We couldn't collect your payment, so your page now shows \"coming back soon\" to fans.", "Nothing is deleted. Pay any time and everything comes straight back."],
    }),
    ended: (to, { name, payUrl }) => send(to, "Your plan has ended", {
      heading: "Your plan has ended", button: "Start again", url: payUrl, footer: help,
      lines: [hi(name), "Your plan has finished, so your page now shows \"coming back soon\" to fans.", "Your page and settings are saved. Come back any time and it all returns."],
    }),
    restored: (to, { name, site }) => send(to, "Your page is back", {
      heading: "You're back", button: "Open your account", url: `${site}/account`, footer: help,
      lines: [hi(name), "Thanks, your payment went through. Your page is live again."],
    }),
    cardExpiring: (to, { name, accountUrl }) => send(to, "Your card expires soon", {
      heading: "Card expiring soon", button: "Update your card", url: accountUrl, footer: help,
      lines: [hi(name), "The card on your plan expires before your next payment.", "Update it now so your page stays live without a break."],
    }),
  };
}
