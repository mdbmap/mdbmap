# ADR-0009: Paid sync billing via Stripe Checkout

Status: accepted (2026-09-04)

## Context

ADR-0007 defers the paid sync mechanism and rejects Ko-fi. Sync (#172) must not
ship to production users without a durable “may sync” entitlement checked on
the server. Epic #171 needs a provider choice before entitlement schema (#185)
and checkout/webhook work (#186).

Constraints:

- Cloudflare Workers + D1 + Better Auth (session user id is the gate key)
- One paid sync tier is enough for v1 of monetisation
- Ko-fi is out (ADR-0007 supersedes ADR-0003)
- Mapping-API key metering (ADR-0006) stays separate from sync entitlements

## Decision

**Provider:** Stripe Checkout (hosted) + Customer Portal + webhook events.

**Entitlement storage:** a D1 row keyed by Better Auth `user.id`, with at least
`status` (`active` | `inactive`), Stripe `customer_id` / `subscription_id`, and
`updated_at`. This row is the source of truth the sync gate reads — not Stripe
API calls on the hot path.

**Sync-gate rule:** outbound sync routes refuse the request unless the signed-in
user’s entitlement row is `active`. Missing row means inactive. The gate is a
small server helper shared by sync procedures; it does not trust client flags.

**Webhook trust boundary:** only Stripe-signed webhook requests
(`Stripe-Signature` verified with the endpoint secret) may create or flip
entitlement rows. Checkout success URLs are UX only; they do not grant access.
Handlers are idempotent on Stripe event id.

**Not Ko-fi.** Tips, supporter emails, and Ko-fi webhooks are not part of sync
billing. ADR-0003 remains superseded.

## Why Stripe over lighter SaaS checkouts

- Hosted Checkout and Customer Portal cover pay + manage/cancel without a
  custom card UI on Workers.
- Webhook signing and subscription lifecycle events are well documented for
  idempotent entitlement updates.
- Fits a single “sync” product price; no need for Lemon/Paddle/Polar until we
  want merchant-of-record tax handling as a product requirement.

Costs accepted: we operate a Stripe account, rotate webhook secrets, and map
subscription states onto a coarse `active`/`inactive` entitlement.

## Open questions (must not block #185)

These can land with checkout (#186) or a follow-up note:

1. Exact price, currency, and billing interval (monthly vs yearly).
2. Whether cancelled-but-paid-through period stays `active` until period end.
3. Soft grace on webhook delivery failure vs hard deny (prefer hard deny for
   sync; UX can show “billing sync pending”).
4. Whether Better Auth’s Stripe plugin is used or a thin hand-rolled webhook
   worker — either is fine if the D1 entitlement row remains the gate.

## Consequences

- #185 can ship the entitlement table and `assertSyncEntitled(userId)` helper
  against this shape without waiting on Checkout UI.
- #186 implements Checkout Session creation, portal link, and signed webhooks
  that upsert the entitlement row.
- Sync epic (#172) depends on the gate helper, not on Stripe SDK calls inside
  push jobs.
