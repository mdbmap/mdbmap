# ADR-0003: Ko-fi supporter email ownership, uniqueness and webhook matching

Status: superseded (2026-08-25) by ADR-0007 — Ko-fi is dropped; monetisation is
deferred and will not use Ko-fi.

## Decision

`user.kofi_email` is the single source of truth for where a Ko-fi tip is
attributed. It is stored canonicalised (`parseEmail`: trimmed, NFC-composed,
lowercased local part, punycode domain) and protected by a unique index and
cross-column ownership triggers. When it is null — several accounts may have
null — tips follow the account's sign-in email.

`user.email` is canonicalised by the same parser before Better Auth looks an
account up (`mapProfileToUser`), so the column itself is the indexed canonical
key used by webhook fallback matching.

Better Auth does not rewrite a stored email when the provider's changes:
that needs `overrideUserInfoOnSignIn`, which stays off because it would also
overwrite name and image, and would move an address the Ko-fi ownership
triggers guard. A user whose provider email changes therefore keeps signing in
to the same row — the account it links by is unchanged — and their fallback
address stays the one they registered with until they save a `kofi_email`.

An address can belong to only one account across both forms, and a
provider-verified sign-in address outranks an unverified claim. A stored
`kofi_email` cannot be saved when it equals another account's sign-in `email`
or stored claim. In the other direction the claim yields: creating an account,
or changing a sign-in email, releases any other account's `kofi_email` that
equals it, so an unverified claim can never block registration. Saving the same
account's own email explicitly is allowed because both forms resolve to that
account.

Webhooks will match by **lookup then manual review**, not verified ownership:
a payload email is looked up against `kofi_email = ?` and, only if that
misses, against `kofi_email IS NULL AND email = ?`; a miss on both lands in a
review queue instead of bouncing. The fallback
arm is deliberate and documented here rather than replaced by a backfill: a
backfill would copy every account email into `kofi_email`, destroying the
distinction between "explicitly tips from this address" and "happens to match",
and re-pinning addresses users deliberately cleared.

## Why not proof-of-ownership before storing

Verified ownership (confirmation mail per address) is the stronger guarantee,
but this field only decides tip attribution on an opt-in feature — a wrong
attribution costs a thank-you note, not money or access. The unique index plus
canonicalised equality closes the real risks (two accounts claiming one
tip-jar identity, silent mismatch between typed and paid-from address) without
a verification flow. If payouts ever depend on the address, revisit.

## Query shape and indexing

The lookup path stays two-cased so the unique index serves the common case:

1. `WHERE kofi_email = ?` — hits `user_kofi_email_unique`.
2. Only if that misses, `WHERE kofi_email IS NULL AND email = ?` — rare (only
   accounts that never saved an address), bounded by `email`'s existing unique
   index.

Both arms are equality lookups on indexed columns; no new index is needed for
the fallback. The compound shape is kept out of the hot path because the OR
form prevents SQLite from choosing one clean index plan.
