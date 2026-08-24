# ADR-0006: Per-key rate limiting via the Workers Rate Limiting binding

Status: accepted (2026-08-21)

## Decision

Public API requests (`/movie/*`, later `/series/*`) are rate limited per API
key with the Workers Rate Limiting binding (`ratelimits` in `wrangler.jsonc`),
keyed by the key's record id. One binding, `API_RATE_LIMIT`, at 60
requests/minute — the free tier. Exceeding it returns `429` with a
`retry-after: 60` header.

## Why the binding over D1 counters

- Counters live edge-local with async sync — no D1 read+write per request,
  no write contention on hot keys.
- `wrangler dev` simulates the binding locally, so the 429 path is testable
  in dev.
- `wrangler types` generates the `RateLimit` binding type; the gate mocks it
  trivially in unit tests.

Costs accepted: counters are best-effort (approximate near the boundary, not
strongly consistent), and periods are fixed at 10 or 60 seconds. Fine for
abuse protection; this is not billing-grade metering.

## Later: paid tiers

Binding limits are static config, so each plan gets its own binding
(`API_RATE_LIMIT_PRO`, …) with a distinct `namespace_id`, and the gate picks
the binding from the key's `plan` column. If plans ever need runtime-tunable
limits, revisit with Durable Objects.

## Related: keys are hand-rolled, not better-auth's plugin

better-auth 1.7.1 ships no api-key plugin (it moved to the separate
`@better-auth/api-key` package), and that plugin rate limits by writing
request counts to the database on every verification — the exact per-request
D1 write this ADR avoids — with the plan field only expressible as JSON
metadata. A four-file hand-roll (`api_key` table storing a SHA-256 hash,
secret shown once) fits better.
