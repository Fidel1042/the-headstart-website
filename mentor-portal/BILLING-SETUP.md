# Weekly Billing — Setup & How It Works

This replaces the old "charge the moment a mentor logs a session" flow with:
**mentors log all week → you charge each mentee once a week from one page → you pay mentors.**

It also fixes the bug where mentees went missing from a mentor's dropdown
(e.g. Raunaq only seeing Mary), and adds a "View as mentor" troubleshooting tool.

---

## 1. What you MUST do before this works live

### a) Add 2 fields to the Airtable **Sessions** table
The new logging function writes to these. If they don't exist, logging will fail.

| Field name         | Field type                        | Why |
|--------------------|-----------------------------------|-----|
| `Mentee Record ID` | Single line text                  | Reliable link from a session back to the mentee so the weekly charge can find their card. |
| `Amount Due`       | Number (or Currency), 2 decimals  | The price to charge for that session in the weekly run. |

Also make sure `Payment Status` is a **Single select** with these options:
`Pending`, `Charged`, `Failed`, `Package`.
(New sessions are logged as `Pending`; the weekly run flips them to `Charged` or `Failed`.)

### b) Fix the "missing mentee" data problem (the real root cause)
Mentees appear in a mentor's dropdown **only if** the Mentee table's
`Mentor Email Plain` field matches that mentor's login email. Today that field
is hand-typed, so it goes blank or gets a typo and mentees vanish.

**Permanent fix:** in the Mentee table, change `Mentor Email Plain` from a
text field into a **Lookup** field that pulls the email from the linked Mentor
record. A lookup auto-fills and can never drift. (If your mentees aren't linked
to a Mentor record yet, link them first, then add the lookup.)

Until you do that, use the **Mentee Audit** button (see below) to find and fix
every blank/mismatched mentee by hand.

### c) Add 1 environment variable in Netlify
Netlify → your site → **Site settings → Environment variables → Add**:

- **Key:** `BILLING_PASSCODE`
- **Value:** any private phrase only you know (e.g. `headstart-charge-2026`).

This is the passcode you'll type on the Billing page before charging. It stops
anyone else from triggering real charges.

---

## 2. Your new weekly routine

1. Mentors log sessions all week as normal (the button now just **logs** —
   it never charges, so a bad card can't block them).
2. **Sunday:** open `/mentor-portal/billing.html` → **Weekly Mentee Charge**.
   - You see every mentee and their combined total for the week.
   - Mentees with **"no card"** are flagged — they won't be charged.
   - Type your passcode → **Charge all now**. Each mentee gets **one** charge.
   - You get a summary email. Any **declines are listed** so you can charge
     those mentees manually in Stripe.
3. Open `/mentor-portal/payslips.html` → **Send payslip emails** to pay mentors
   (unchanged — this already works).

---

## 3. Troubleshooting tools (for you / Koko only)

- **View as mentor** (dropdown, top-right of the portal home): pick any mentor
  and the portal reloads showing *exactly* their mentee dropdown. This is how
  you reproduce "Raunaq only sees Mary" and confirm the fix.
  - You can also go straight to a URL:
    `/mentor-portal/?as=raunaqrsa@gmail.com`
- **Mentee Audit** (button on the Billing page): scans every mentee and lists:
  - `blank` — no mentor set (invisible to all mentors)
  - `unknown` — mentor email doesn't match any real mentor (typo / old email)
  - `nocard` — no card on file, so can't be charged (unless Package)
  - Plus a per-mentor count so you see "Raunaq: 1 mentee" at a glance.

---

## 4. Files in this change

New Netlify functions (`netlify/functions/`):
- `log-session.js` — logs a session, no charge (portal now calls this)
- `preview-week.js` — read-only preview of the weekly charge
- `charge-week.js` — the actual weekly charge (passcode-protected)
- `audit-mentees.js` — the Mentee Audit diagnostic

Portal:
- `billing.html` — new admin page (Weekly Charge + Mentee Audit)
- `index.html` — now logs instead of charging; adds View-as + Billing link
- `get-mentees.js` — mentor-email match is now case/space-insensitive

The old `charge-mentee.js` is left in place (no longer called) in case you ever
want to revert to per-session charging.

---

## 5. Test it safely before trusting it

- **Local visual check:** run the site locally — the portal and Billing page
  use mock data on `localhost`, so you can click through the whole flow without
  touching real cards or Airtable.
- **Live dry run:** after adding the fields + passcode, log one real session for
  a test mentee, open the Billing page, confirm the preview shows the right
  amount, then charge and check Stripe. Use a small `Session Price` to start.
