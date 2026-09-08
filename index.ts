// supabase/functions/stripe-webhook/index.ts
// Deploy with: supabase functions deploy stripe-webhook --no-verify-jwt
// (--no-verify-jwt because Stripe calls this directly, not through a logged-
// in user's session — Stripe's own signature check below is what verifies
// the request instead.)
//
// After deploying, copy the function's URL into Stripe Dashboard →
// Developers → Webhooks → Add endpoint, and select these events:
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted, invoice.paid
// Stripe will then give you a signing secret — set it as STRIPE_WEBHOOK_SECRET.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Reverse of PRICE_IDS in create-checkout-session — keep these two in sync.
const PLAN_BY_PRICE_ID: Record<string, string> = {
  price_REPLACE_ME_STARTER: 'starter',
  price_REPLACE_ME_PRO: 'pro',
};

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!;
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    return new Response(`Signature verification failed: ${err}`, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const businessId = session.metadata?.business_id;
      const plan = session.metadata?.plan;
      if (businessId) {
        await supabaseAdmin.from('businesses').update({
          stripe_subscription_id: session.subscription as string,
          plan,
          subscription_status: 'active',
        }).eq('id', businessId);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items.data[0]?.price.id;
      await supabaseAdmin.from('businesses').update({
        plan: PLAN_BY_PRICE_ID[priceId] ?? undefined,
        subscription_status: sub.status, // 'active' | 'past_due' | 'canceled' | 'trialing' ...
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      }).eq('stripe_customer_id', sub.customer as string);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await supabaseAdmin.from('businesses').update({
        subscription_status: 'canceled',
      }).eq('stripe_customer_id', sub.customer as string);
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const { data: business } = await supabaseAdmin
        .from('businesses').select('id')
        .eq('stripe_customer_id', invoice.customer as string).single();
      if (business) {
        await supabaseAdmin.from('payments').upsert({
          business_id: business.id,
          stripe_invoice_id: invoice.id,
          amount_cents: invoice.amount_paid,
          currency: invoice.currency,
          paid_at: new Date(invoice.status_transitions.paid_at! * 1000).toISOString(),
        }, { onConflict: 'stripe_invoice_id', ignoreDuplicates: true });
      }
      break;
    }
  }

  return new Response('ok', { status: 200 });
});
