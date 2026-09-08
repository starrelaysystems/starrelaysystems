-- ============================================================================
-- Billing schema — run in Supabase SQL Editor
-- ============================================================================

-- Subscription state lives on the business, since a business is what's
-- actually being billed (all its users share one plan).
alter table public.businesses
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists plan text,                      -- e.g. 'starter', 'pro'
  add column if not exists subscription_status text         -- 'trialing' | 'active' | 'past_due' | 'canceled' | null
    default null,
  add column if not exists current_period_end timestamptz;

-- One row per successful payment — this is what "total income" sums.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  stripe_invoice_id text unique,
  amount_cents integer not null,
  currency text not null default 'zar',
  paid_at timestamptz not null default now()
);

alter table public.payments enable row level security;

-- Site admins can see everything (reuses the is_site_admin() helper from
-- site-admin-setup.sql). A business can see its own payment history.
create policy "site admin full access to payments"
  on public.payments for all
  using (is_site_admin())
  with check (is_site_admin());

create policy "business can read own payments"
  on public.payments for select
  using (business_id in (select business_id from public.profiles where id = auth.uid()));

-- Only the webhook (service role) ever inserts into payments directly —
-- normal users never write here, so no insert/update policy for them.
