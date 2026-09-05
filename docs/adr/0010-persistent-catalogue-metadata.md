# Persistent catalogue metadata in D1

Status: accepted (2026-09-05). Amends ADR-0007's persistence split for
**display** metadata only; mapping stays D1, user data stays D1, and external
service ratings stay the refreshable KV snapshot.

Display metadata from TMDB and AniDB is stored as durable D1 documents keyed by
catalogue title (one TMDB series, one TMDB movie, one AniDB entry), not as
Workers KV with a flat TTL. KV expiry recrawled completed titles as often as
airing ones and could not hold a last-updated time or a per-entry refresh
lease. The document keeps every locale the catalogue emitted; the work page
projects the viewer's locale. Freshness class (continuing, upcoming, completed)
sets how often a document is recrawled. A user refresh is a continuity-scoped
lease: any viewer may request it, at most once per twenty-four hours per work.
List surfaces read stored documents and never recrawl on a timer.
