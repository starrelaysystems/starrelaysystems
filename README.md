# Star Relay Systems — CRM Suite

Connecting businesses to their next customer. Three CRM tiers, one shared backend, self-serve signup.

## Live pages (once GitHub Pages is enabled)

- **Marketing site:** `index.html`
- **Lead Pipeline** (single-user): `lead-pipeline.html`
- **Lead Suite** (up to 21 seats): `lead-suite.html`
- **Meridian** (up to 25 seats): `meridian.html`

## What's in this repo

| File | Purpose |
|---|---|
| `index.html` | Marketing/demo site — describes all three tiers and links to each live product |
| `lead-pipeline.html` | Starter tier: single-user lead tracker |
| `lead-suite.html` | Standard tier: team CRM with roles and an admin portal |
| `meridian.html` | Flagship tier: adds analytics and a follow-up calendar |
| `crm-core.js` | Shared logic (login, leads, roles, invites) used by all three CRM pages |
| `assets/logo.png` | Star Relay Systems logo |
| `schema.sql` | Supabase database schema — run this first, once, in a new project |
| `schema_platform_admin_addon.sql` | Adds Star Relay's cross-business support access — run second |

## Setup order

1. Create a free Supabase project
2. Supabase → SQL Editor → run `schema.sql`
3. Run `schema_platform_admin_addon.sql`
4. Open each HTML file and confirm the `SUPABASE_URL` / anon key block near the bottom matches your project's Settings → API page
5. Upload everything in this repo to GitHub, enable Pages on the `main` branch

## Status

Working demo. Pricing, copy, and payment integration are still being finalized before this goes live for real customers.
