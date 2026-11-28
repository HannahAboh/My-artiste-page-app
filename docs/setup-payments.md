# Switching on payments: your steps

Claude has built everything: the sales page, sign-up, Paystack checkout, accounts, emails, renewals, reminders and the pause page. These are the only steps that need **you**, because they need your ID, your bank or your own login.

It takes about 30 minutes, plus Paystack's verification wait. You never touch code. **Never paste a secret key into a chat, an email or the GitHub repo.** It only goes into Cloudflare (step 5).

Keep a note open on your laptop. You'll copy 6 things into it as you go, then paste them all in step 5.

---

## 1. Paystack (takes payments)

1. Go to **paystack.com** and tap **Create a free account**. Choose **Nigeria**.
2. Fill in your business details and upload your ID. Paystack checks them in 1 to 3 working days. You can do steps 2 to 5 while you wait.
3. Want to charge in dollars ($5)? In the Paystack dashboard open **Support** and ask them to *"enable USD for my account"*. If you'd rather charge in naira, tell Claude the naira prices and Claude changes them for you.
4. Open **Settings → API Keys & Webhooks**. Copy the **Test Secret Key** (starts `sk_test_`) into your note as **PAYSTACK_SECRET_KEY**.

You don't need to create plans. The site makes the monthly and yearly plans in Paystack by itself the first time someone buys.

## 2. Supabase (stores accounts and logins)

1. Go to **supabase.com**, tap **Start your project** and sign in with GitHub.
2. Tap **New project**. Name: `my-artiste-page`. Make up a database password and save it somewhere safe. Region: **London** (closest to Nigeria). Tap **Create**.
3. When it's ready, open **SQL Editor** (left side), tap **New query**, paste everything from the file `supabase/schema.sql` in the repo, and tap **Run**. You should see "Success".
4. Open **Project Settings → API Keys** (or **Data API**). Copy into your note:
   - the **Project URL** (looks like `https://abcd.supabase.co`) as **SUPABASE_URL**
   - the **anon / publishable** key as **SUPABASE_ANON_KEY**
   - the **service_role / secret** key as **SUPABASE_SERVICE_ROLE_KEY** (this one is secret)

## 3. Resend (sends the emails)

Emails need a web address (domain) of your own, such as `myartistepage.com`. If you don't have one yet, buy it in Cloudflare (**Domain Registration → Register Domains**, about $10 a year) first.

1. Go to **resend.com** and sign up.
2. Open **Domains → Add domain**, type your domain, and follow the steps. If the domain is on Cloudflare, Resend offers a button that adds everything for you.
3. Open **API Keys → Create API key**. Copy it into your note as **RESEND_API_KEY**.
4. In your note, write **EMAIL_FROM** as `My Artiste Page <hello@yourdomain.com>` (with your real domain).

## 4. Cloudflare (puts the site online)

1. Go to **dash.cloudflare.com** and sign up (free).
2. Open **Workers & Pages → Create → Import a repository**, connect GitHub, and pick **my-artiste-page-app**. Leave every setting as it is and tap **Deploy**.
   - If GitHub doesn't show the repo, Hannah owns it, so she needs to tap **Approve** on the GitHub message Cloudflare sends her.
3. When it's done, Cloudflare shows the address, like `https://my-artiste-page.yourname.workers.dev`. Copy it into your note as **SITE_URL**. (Later you can link your own domain under **Settings → Domains & Routes**. Then change SITE_URL to it.)

## 5. Paste your keys into Cloudflare

1. In Cloudflare open **Workers & Pages → my-artiste-page → Settings → Variables and Secrets**.
2. For each line in your note tap **Add**, choose type **Secret**, type the name exactly (in capitals), paste the value, and tap **Deploy**:

| Name | What it is |
| --- | --- |
| `SITE_URL` | The site address from step 4 |
| `PAYSTACK_SECRET_KEY` | From step 1 |
| `SUPABASE_URL` | From step 2 |
| `SUPABASE_ANON_KEY` | From step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | From step 2 |
| `RESEND_API_KEY` | From step 3 |
| `EMAIL_FROM` | From step 3 |

3. Back in **Paystack → Settings → API Keys & Webhooks**, in **Test Webhook URL**, paste your SITE_URL followed by `/api/paystack/webhook`, for example `https://my-artiste-page.yourname.workers.dev/api/paystack/webhook`. Tap **Save**.

## 6. Try it with a pretend card

1. Open your SITE_URL, tap **Get started**, use your own email and pay. Paystack's test page lists pretend cards: pick the one marked **Success**. No real money moves.
2. You should land on "Check your email", get the "set your password" email, set a password, and reach "Paste your Spotify link".
3. Tell Claude it worked (or what you saw).

## 7. Go live

Once Paystack has verified you:

1. In Paystack switch the top toggle from **Test** to **Live**. Copy the **Live Secret Key** (`sk_live_`) and paste the **Live Webhook URL** (the same address as in step 5).
2. In Cloudflare, edit `PAYSTACK_SECRET_KEY` and paste the live key instead.

That's it. Renewals, failed-payment emails, the 7-day grace period and pausing pages all run by themselves every morning at 9 AM Lagos time.

---

### Optional extras

- `DASHBOARD_URL`: where artists go after the Spotify step, once the dashboard is online.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`: from developer.spotify.com (needs Spotify Premium). With these, the artist's name and photo are pulled from Spotify straight away.
- Prices, currency and grace days are in `wrangler.toml`. Ask Claude to change them.
