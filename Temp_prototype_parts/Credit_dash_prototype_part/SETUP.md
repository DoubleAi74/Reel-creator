# Setup Guide — Credit Dashboard Prototype

A friendly, step-by-step walkthrough to get the two services this prototype needs
— **MongoDB Atlas** (the database) and **SumUp** (payments, in test/sandbox mode) —
set up and wired into the app. No prior experience assumed. You only need to do
this once.

> **Golden rule about secrets:** the keys you collect below are like passwords.
> They go **only** in a local file called `.env.local` (which is never committed to
> git). Never paste them into code, chat, screenshots, or a public place.

At the end you'll have a file called `.env.local` filled in, and the app will run.

---

## What you'll end up with

A `.env.local` file that looks like this (names on the left, your real values on
the right — examples shown are **placeholders**, not real):

```bash
# Database
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/credit_dash

# SumUp (sandbox / test)
SUMUP_API_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
SUMUP_MERCHANT_CODE=XXXXXXXX
SUMUP_API_BASE_URL=https://api.sumup.com
SUMUP_CURRENCY=GBP
SUMUP_WEBHOOK_URL=https://your-tunnel-url.example/api/webhooks/sumup
SUMUP_CHECKOUT_RETURN_URL=https://your-tunnel-url.example/payment/return

# App
APP_BASE_URL=http://localhost:3000

# Dev-only testing control (leave OFF unless testing)
ENABLE_TEST_CONTROLS=true
```

Don't worry about filling it in yet — the steps below tell you where each value
comes from.

---

## Part A — MongoDB Atlas (the database)

MongoDB Atlas is a free, hosted database in the cloud. It gives you one
**connection string** that the app uses to store cards and the balance.

### A1. Create a free account and cluster
1. Go to <https://www.mongodb.com/cloud/atlas/register> and sign up (free).
2. When asked, create a **free "M0" shared cluster** (the £0 tier is plenty).
3. Pick any cloud provider/region near you and click **Create**. Wait a minute or
   two for it to finish provisioning.

### A2. Create a database user (a login for the app)
1. In the left menu, open **Database Access** → **Add New Database User**.
2. Choose **Password** authentication.
3. Enter a **username** and a **strong password**. **Write both down** — you'll
   need them in a moment. (Avoid special characters like `@ : / #` in the password,
   or you'll have to URL-encode them later.)
4. Give the user the **"Read and write to any database"** role. Click **Add User**.

### A3. Allow your computer to connect
1. In the left menu, open **Network Access** → **Add IP Address**.
2. For local development, click **Allow Access from Anywhere** (`0.0.0.0/0`) — this
   is fine for a prototype. (For production you'd lock this down.)
3. Click **Confirm**.

### A4. Copy the connection string
1. In the left menu, open **Database** → click **Connect** on your cluster.
2. Choose **Drivers** (Node.js).
3. Copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<username>` and `<password>` with the ones from step A2.
5. Add a database name after the `/` — use `credit_dash`. Final result:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/credit_dash?retryWrites=true&w=majority
   ```
6. Paste this as the value of **`MONGODB_URI`** in `.env.local`.

✅ **MongoDB is done.** You don't need to create any tables/collections — the app
creates them automatically on first run and seeds the balance to £5.00.

---

## Part B — SumUp (payments, in sandbox/test mode)

SumUp handles the real payment page. We use its **sandbox** first, which behaves
like the real thing but **moves no real money** — perfect for building and testing.

### B1. Create / sign in to a SumUp account
1. Go to <https://me.sumup.com/> and sign in (or create an account).

### B2. Create a sandbox merchant (the test business)
1. Open **Developer Settings**: <https://me.sumup.com/settings/developer>
2. Open the **Sandboxes** tab.
3. Click to **create a sandbox merchant account**.
4. **Switch into** that sandbox account (important — the next steps must be done
   while you're inside the sandbox, not your live account).

### B3. Record the sandbox merchant code
1. Still in the sandbox account, find the **merchant code** (shown in the
   sandbox/merchant profile).
2. Copy it into **`SUMUP_MERCHANT_CODE`** in `.env.local`.
   > Sandbox and live have **different** merchant codes — make sure this is the
   > **sandbox** one.

### B4. Create a secret API key
1. Go to **For Developers → Toolkit → API Keys** (while in the sandbox account).
2. Click **Create**. Give it a clear name like `credit-dash-sandbox-server`.
3. **Copy the secret key immediately** — it starts with `sk_test_…`. You may not be
   able to see it again.
   > ⚠️ There may be a **public** key shown too. Do **not** use that. You want the
   > **secret** `sk_test_…` key.
4. Paste it into **`SUMUP_API_KEY`** in `.env.local`.

### B5. Fill in the remaining SumUp settings
In `.env.local`, set these fixed values:
```bash
SUMUP_API_BASE_URL=https://api.sumup.com
SUMUP_CURRENCY=GBP
```
The two **URL** settings (`SUMUP_WEBHOOK_URL` and `SUMUP_CHECKOUT_RETURN_URL`) need
a public web address — set them in Part C next.

✅ **SumUp credentials are done.** You now have the merchant code and the secret key.

---

## Part C — The webhook tunnel (so SumUp can reach your computer)

When a payment succeeds, SumUp sends a **webhook** (a small "it's paid" message) to
your app. SumUp lives on the internet, but your app runs on `localhost`, which the
internet can't reach. A **tunnel** gives you a temporary public HTTPS address that
forwards to your local app.

You only need this for the **payment** stage (Stage 3). You can skip it until then.

### C1. Start a tunnel (pick one)
- **cloudflared** (free, no signup):
  ```bash
  cloudflared tunnel --url http://localhost:3000
  ```
- **ngrok** (free account):
  ```bash
  ngrok http 3000
  ```

Either one prints a public HTTPS URL, e.g. `https://random-words.trycloudflare.com`.

### C2. Put the tunnel URL into `.env.local`
Using your tunnel URL (replace the example), set:
```bash
SUMUP_WEBHOOK_URL=https://random-words.trycloudflare.com/api/webhooks/sumup
SUMUP_CHECKOUT_RETURN_URL=https://random-words.trycloudflare.com/payment/return
```
> The tunnel URL usually **changes each time you restart** the tunnel. If it
> changes, update these two lines and restart the app.

---

## Part D — Create `.env.local` and run the app

### D1. Create the file
In the prototype's app folder, copy the example file to a real one:
```bash
cp .env.example .env.local
```
Then open `.env.local` and paste in all the values you collected above.

> The build agent generates `.env.example` (names only, no values) as it builds.
> If it doesn't exist yet, just create `.env.local` by hand using the template at
> the top of this guide.

### D2. Install and run
```bash
npm install
npm run dev
```
Open <http://localhost:3000>. You should see the dashboard with a **£5.00** balance.

### D3. Try it
- **Add / remove cards** — they should persist if you refresh (that confirms
  MongoDB works).
- **🔥 Fire button** — the header flashes red, a random card appears, and the
  balance drops by 2p.
- **Add money** — enter an amount between **£1 and £100**, and you'll be sent to
  SumUp's hosted checkout.

---

## Part E — Testing SumUp safely (sandbox facts)

- **Use test cards only.** Never type a real card number. SumUp provides dedicated
  online-payment **test cards** — see
  <https://developer.sumup.com/online-payments/testing/>.
- **To test a failed payment on purpose**, use an amount of **£11.00** — SumUp's
  sandbox is designed to make `11.00` fail. Your balance should **not** change.
- A successful sandbox payment should **credit your balance exactly once**, even if
  the webhook arrives twice.

---

## Quick checklist

- [ ] MongoDB Atlas: cluster created, DB user made, network access allowed
- [ ] `MONGODB_URI` filled in (with username, password, and `/credit_dash`)
- [ ] SumUp: sandbox merchant created and **switched into**
- [ ] `SUMUP_MERCHANT_CODE` (sandbox) filled in
- [ ] `SUMUP_API_KEY` (secret `sk_test_…`) filled in
- [ ] `SUMUP_API_BASE_URL`, `SUMUP_CURRENCY` set
- [ ] Tunnel running; `SUMUP_WEBHOOK_URL` + `SUMUP_CHECKOUT_RETURN_URL` set (Stage 3)
- [ ] `APP_BASE_URL=http://localhost:3000`
- [ ] `.env.local` created (never committed to git)
- [ ] `npm install` then `npm run dev` → dashboard shows £5.00

---

## Troubleshooting

- **App can't connect to the database** — check `MONGODB_URI` has the right
  username/password, that you added a database name (`/credit_dash`), and that
  **Network Access** allows your IP. Special characters in the password must be
  URL-encoded.
- **SumUp returns 401 (unauthorized)** — you're probably using the **public** key
  or a **live** key. Use the **secret sandbox** key (`sk_test_…`), created while
  **inside** the sandbox account.
- **Payment succeeds but the balance doesn't update** — the webhook can't reach you.
  Make sure the tunnel is running and `SUMUP_WEBHOOK_URL` matches the **current**
  tunnel URL, then restart the app. The return page also verifies, so give it a few
  seconds.
- **Merchant mismatch errors** — you likely mixed a **live** merchant code with a
  **sandbox** key (or vice versa). Both must be from the **sandbox**.

---

## Where the source-of-truth docs are

- **Short setup for this prototype:** `plan.md` §8 (this guide expands on it).
- **Full authoritative SumUp guide:**
  `Current .md docs/sumup-payments-api-hosted-checkout-integration-guide.md`
  (§4 account/sandbox, §5 API keys, §6 merchant code & env vars).
