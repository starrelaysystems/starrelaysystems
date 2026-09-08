-- ============================================================================
-- Login diagnostic — run each block in Supabase → SQL Editor, one at a time,
-- and send me back what each one returns. I can't see your live project from
-- here (no DB credentials, no network access), so this is how we find the
-- exact break instead of guessing at a fix that might not match your setup.
-- ============================================================================

-- 1) Does auth.users actually have the account you're testing with, and is
--    there a matching row in profiles? If profiles comes back empty/NULL for
--    a user that exists in auth.users, that's the whole bug — the app can
--    sign the person in, then can't find them, and bounces back to login.
select
  u.id, u.email, u.created_at as auth_created_at,
  p.id as profile_id, p.role, p.business_id, p.is_site_admin
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc
limit 20;

-- 2) List every trigger on auth.users. There should be one that inserts a
--    profiles row on signup (something like handle_new_user). Paste its
--    definition back to me — that's the piece none of your uploaded files
--    included, and it's almost certainly where "Signup is missing a valid
--    product" is being raised from.
select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

-- 3) List every RLS policy currently on profiles. You need at least one
--    policy that lets a logged-in user read THEIR OWN row, e.g.
--    "using (auth.uid() = id)" — separate from the site-admin policy added
--    in site-admin-setup.sql. Without that base policy, even a correctly
--    created account can't read its own profile, which looks identical to
--    "no account found."
select polname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'profiles';

-- 4) Confirm RLS is actually turned on for profiles (if it's off, policies
--    don't matter — but leaving it off is also not what you want long-term).
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname = 'profiles' and relnamespace = 'public'::regnamespace;

-- 5) Confirm the businesses table actually has a row for each product this
--    login page expects (afterLogin() looks up businesses.product = 'meridian'
--    / 'lead_suite' / 'lead_pipeline' for site admins).
select id, product, name from public.businesses order by product;
