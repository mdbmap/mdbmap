# ADR-0008: Continuity presentation orders for franchise films

Status: accepted (2026-08-26), amended (2026-08-28) to drop the `group:{id}`
work-page key and the `continuity:` prefix from the work URL

## Context

ADR-0007 tracks one entry per continuity and renders a work page as ordered
parts (TV seasons or anime cours) with episode lists. ADR-0002 already
separates **title groups** (instalment overlap) from **continuities** (mainline
prequel/sequel chains of segments). The tracker today collapses those: the
continuity key is a title-group id, and `resolveContinuity` builds parts only
from spine titles inside that one group.

That breaks franchises where films belong in the watch list but must stay
separate titles in the database. Made in Abyss interleaves theatrical films
between cours. Madoka Magica's Rebellion is its own atomic title, not an
episode of the TV series. Monogatari needs a curated watch order that differs
from release order. Merging those films into the series title group via title
assertions would falsely claim content overlap and corrupt mapping.

Matching orders (ADR-0002) are the wrong tool for watch order. They are
alignment evidence only and must not become public instalment identities or
UI numbering.

## Decision

### Continuity is the tracked work

The tracker keys watch status at a real **continuity**, not a title group.
A continuity is an ordered set of **segments**. Each segment points at one
service title on the metadata spine (AniDB for anime, TMDB for TV/film) and
may be episodic or atomic.

- Episodic segments contribute their main-sequence instalments as today.
- Atomic segments (films, and OVAs that are verified mainline titles) contribute
  exactly one instalment, addressed by that title's own locator.

Relation assertions remain the source of truth for adjacency. Title assertions
still decide group membership only. A film that continues a series joins the
continuity through a relation assertion and does **not** join the series title
group unless it actually shares instalment content.

Anime continuity discovery may accept movie-shaped mainline candidates as
segments. Side stories, spin-offs, recaps and non-mainline OVAs stay out of the
default chain unless a presentation order explicitly includes them.

Watch-status keys and rateable units stay `continuity:{id}`. `group:{id}` is
not a work or watch-status key. The work page is `/work/{id}` with the numeric
continuity id. Title groups remain the mapping identity; matching coverage may
still store `group:{id}` as a baseline. Watch-status aliases exist only for
retired `continuity:{id}` keys after a merge.

### Presentation orders

Each continuity carries one or more named **presentation orders**: curated
arrangements of its segments for the work page.

- **`release`** is derived from the relation chain / first-air ordinals and may
  be regenerated when discovery updates the chain.
- **`watch`** is a curated overlay. Rediscovery does not overwrite it.
- Additional named orders are allowed later; v1 only needs these two when they
  differ.

A presentation order lists segment references in display position. Instalment-
level interleaving inside a segment is deferred; segment reordering covers
Monogatari, Made in Abyss and Madoka.

Matching orders stay matcher-private. Presentation orders are the only
user-facing alternate arrangements.

### Work page projection

`work.get` resolves the continuity, applies the selected presentation order
(request override or continuity default), and returns an ordered list of
blocks:

- A **part** block for an episodic segment (existing `PartView`: label,
  episodes, part-level ratings).
- A **film** block for an atomic segment: title, air date, ratings, watched
  state, and `rateableUnit.kind: "movie"` (already reserved in the schema and
  named in ADR-0007 for grouped-movie instalments such as AniDB Madoka films).

Film progress and ratings attach to the film title's instalment locator / movie
rateable unit. They are never encoded as fake season or episode numbers on the
series title.

v1 UI: film blocks appear as their own selectable parts alongside cours/seasons
(extends the existing part selector). A single scrolling timeline that
interleaves film rows inside an episode list is a later composition on the same
payload.

### Metadata

ADR-0007 sourcing is unchanged. Each segment fetches metadata from its own
spine title. An AniDB movie collection that maps to several atomic TMDB films
still exposes those films as separate film blocks (or collection instalments
rated as `movie` units); it does not absorb them into the TV series entry.

### Curation

SIMKL mainline walks seed continuity segments, including films once discovery
allows them. Admins and research passes author `watch` orders and settle
continuity conflicts. Community proposals for watch-order diffs are out of
scope for v1.

## Consequences

- Tracker and engine contracts stop treating "continuity" as a synonym for
  title group. `resolveContinuity` walks continuity segments across groups and
  accepts only `continuity:{id}`. The work URL is `/work/{id}`.
- Franchise films show in the season/episode UI without merging titles in D1.
- Monogatari-style dual orders become data, not hard-coded UI forks.
- `rateableUnit.kind: "movie"` gains a real producer on the work page.
- Glossary gains **presentation order**, distinct from matching order.
- Build order: continuity identity and film-capable discovery, then resolve +
  film blocks, then persisted presentation orders and the UI toggle, then
  fixtures for Made in Abyss, Madoka and Monogatari.

## Rejected alternatives

- **Title-assert films into the series group.** Claims overlap that does not
  exist and breaks hub-and-spoke mapping.
- **Fake episode slots on the TV title for films.** Locators would lie; sync
  and cross-service mapping would follow the wrong title.
- **Reuse matching orders as watch order.** Matching orders are alignment
  evidence and must not appear in public IDs or tracker numbering.
- **User-personal order as the first mechanism.** Continuity-curated `release`
  / `watch` covers the known hard cases; personal overrides can layer later.
