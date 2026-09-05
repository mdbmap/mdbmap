# ADR-0007: Media tracking over the mapping engine

Status: accepted (2026-08-25)

## Context

mdbmap becomes a personal media tracker in the shape of MAL, AniList and Trakt,
built on top of the cross-service ID mapping engine (ADR-0001, ADR-0002). The
roadmap starts with TV and film, then music via MusicBrainz, then books far
later. The mapping engine is unchanged and still maps ids across every service.
This ADR covers the two layers above it: what metadata the site displays, and
how users track and rate what they watch.

It supersedes an earlier draft that aggregated display metadata from eight
services behind switchable presentation profiles and a field-precedence table.
That design is dropped in full.

## Decision

### Metadata sourcing

Display metadata comes from exactly two services, chosen by the work's media
kind, never by the user.

- **TV and film** use TMDB, in its season structure.
- **Anime** use AniDB, in its split per-entry (season/cour) structure.

Media kind is decided by the existing anime-shape detection that drives
discovery (ADR-0002). There is no user-facing view toggle. Every other service
contributes ratings only and no other display metadata.

TMDB and AniDB metadata snapshot in Workers KV, split by volatility, with images
stored by reference only and refreshed in the background past expiry. AniDB's
caching rules are honoured (client registration, one-request-per-two-seconds
flood limit). D1 stays the mapping source of truth with its zero-subrequest
cache-hit guarantee.

### Ratings

Ratings are never merged into a single number. A rateable unit shows up to three
distinct layers side by side.

1. **Service rating.** Each mapped service's own published score in its native
   scale, with kind (user or critic) and vote count, shown as a list. External
   and read-only. IMDb and Metacritic come from the vendored IMDb GraphQL schema
   (`schemas/schema.graphql`), the same source the matcher uses. Rotten Tomatoes
   has no source and is out of scope. TVDB's `score` is popularity, not a rating.
2. **Community score.** The mean, with a count, of this site's own users'
   personal ratings for the unit. Native to mdbmap and derived from user data.
3. **Personal rating.** The viewing user's own score, an integer 1 to 10, the
   same grain MAL and AniList use so it maps cleanly on sync.

A **rateable unit** is any of: the work (title), a TV season or an anime cour,
an individual episode, or an individual grouped-movie instalment such as AniDB's
Madoka Magica films.

### User tracking

- A user tracks one entry per **continuity** (ADR-0002), the whole work, not the
  per-service entry.
- **Watch status** per work is one of watching, plan to watch, on hold,
  completed, dropped or rewatching. A rewatch count is kept per work.
- **Progress** is per episode. Marking episodes watched is what drives the
  watching and completed states and what sync reads. Status sits at the work
  level but is backed by per-episode progress.
- Personal ratings attach at any rateable unit above.

### Sync

After metadata and mapping are solid, users can push watch history, status and
ratings out to other services (MAL, AniList, Trakt, Simkl). This is deferred
until those layers are done.

The work is tracked once, at continuity level. Sync uses the instalment mappings
to update the correct per-entry record on each target, because those services
store status per season or cour entry. One local "completed" fans out to exactly
the entries the mapping says it covers. This is the whole reason work-level
tracking is safe: the engine already knows which entries a work spans.

Sync is expected to be paid. The mechanism is Stripe Checkout (ADR-0009), and is
not Ko-fi. ADR-0003 (Ko-fi email ownership) is superseded.

### Persistence split

- **User data** (status, per-episode progress, personal ratings) is durable
  first-class D1 data. It is user-owned and never a cache. Losing it is data
  loss.
- **Community scores** derive from that user data.
- **Service metadata and external service ratings** stay the refreshable KV and
  short-TTL cache above. Losing them is harmless; a refetch restores them.

## Consequences

- The multi-source aggregation, switchable presentation profiles and
  field-precedence table are gone. Metadata sourcing collapses to one source per
  media kind, far less to build and keep correct.
- The mapping engine gains a first real consumer beyond lookup: sync fans a
  single work-level state out to per-entry records through instalment mappings.
- Monetisation and the sync mechanism are deferred, and Ko-fi drops out of the
  design entirely (ADR-0003 superseded). ADR-0006 (per-key rate limiting) is
  unaffected and stays.
- Music (MusicBrainz) and books will reuse the tracking, status and ratings
  shape, but each needs its own metadata source and unit vocabulary. Only TV,
  film and anime are modelled now.
