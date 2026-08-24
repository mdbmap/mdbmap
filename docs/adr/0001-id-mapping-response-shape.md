# ADR-0001: Canonical id strings and mapping response shape

Status: accepted (2026-08-21), amended (2026-08-22) to separate internal
identity from Stremio compatibility IDs and attach evidence to each mapping

## Decision

Mapping endpoints take a canonical id string as the path param and return one
JSON shape, starting with `GET /movie/{id}`.

### Boundary IDs and internal identity

The original API used Stremio-compatible strings and let the endpoint path
provide their media type:

- TMDB: `tmdb:{numericId}` — e.g. `tmdb:603`
- IMDb: `tt{id}` — e.g. `tt0133093`

Series ids will extend the same grammar with position segments, e.g.
`tmdb:123:2:5` (season 2, episode 5) under `/series/`.

Those strings are now a boundary format, not the canonical internal identity.
Internally, a title identity contains its service, the service's namespace and
its native id. An instalment identity contains its title identity and native or
positional locator, or names the title itself when it is atomic. This keeps title and
instalment assertions unambiguous when one group crosses film and episodic
catalogue records.

Stremio-facing routes translate their incoming strings into structured
identities and translate results back. They may continue accepting bare IMDb
ids and `{id}:{season}:{episode}` video ids. A general mapping API can expose
structured references without inheriting those compatibility rules.

An atomic title lookup is also an instalment lookup. Its counterpart may
therefore be a locator inside an episodic title rather than another bare title.
For example, the second TMDB film in an AniDB movie collection maps to the
AniDB collection title plus its second-film locator. Returning only the AniDB
title would falsely imply that the TMDB film covers the whole collection.

The route names are adapter profiles, not internal media namespaces. `/movie`
and `/series` serve shape-specific clients. `/anime` supports the established
addon convention of mixed anime catalogues: it accepts atomic and episodic
titles, resolves their actual shape from the detected service and maps both
through the same internal title model.

TMDB is deliberately excluded from `/anime`. Its movie and TV ids occupy
overlapping numeric namespaces, while existing addons do not send a media
discriminator inside the id. TMDB inputs are therefore valid only under
`/movie` or `/series`, whose route selects the namespace. `/anime` rejects
every TMDB input rather than guessing.

Anime addons use two episode forms for flat-numbered catalogues: both
`kitsu:{title}:{episode}` and `kitsu:{title}:1:{episode}` exist in the wild,
with the latter pattern also used for MAL and AniList. The Stremio parser has a
`flat-or-season-one` compatibility rule for these prefixes. It accepts both
forms as the same request and rejects an explicit season other than 1. This is
only a boundary rule; it does not prescribe how upstream data or internal
instalments represent numbering.

TVDB season-and-episode inputs always use the series' default TVDB order. The
public grammar has no season-order qualifier and rejects extra qualifier
segments. TVDB's official, DVD, absolute, alternate and regional orders, like
TMDB episode groups, are matching evidence only and never appear in request or
response IDs.

### Response

```json
{
	"input": "tmdb:603",
	"mappings": { "imdb": ["tt0133093"] },
	"confidence": "exact",
	"source": "tmdb"
}
```

- `input` — the canonical id that was resolved.
- `mappings` — keyed by counterpart service; values are **always arrays**.
  `[]` means the id is known but has no counterpart (never an error). Multiple
  entries are legal (duplicate TMDB movies today; split episodes later). New
  services (SIMKL, MAL, …) add keys here without breaking clients.
- `confidence` — how the mapping was established. `"exact"` for external-id
  matches; the tier-ladder matcher adds lower grades later.
- `source` — provenance of the mapping data. `"tmdb"` today; `"manual"`,
  `"community"`, `"llm-verified"` later. Cache hits keep the original source —
  the field describes where the mapping came from, not the transport.

That compact shape remains a compatibility response for the existing
two-service and Stremio-facing routes. It cannot describe the service-neutral
graph because different counterparts in one response may have different
confidence and provenance.

The general mapping API therefore attaches `confidence` and an `assertionPath`
to each returned counterpart. The path lists the accepted assertions used to
derive that mapping, including each assertion's provenance and confidence. A
direct mapping has a one-assertion path. Stremio adapters strip this evidence
and format only the counterpart IDs. Top-level `confidence` and `source` do not
enter the internal model and may remain only while legacy callers need them.

Each title-level counterpart also reports its instalment coverage when the
titles are not coextensive. A bare AniDB movie-collection lookup can therefore
return all overlapping atomic TMDB films, with each result naming the AniDB
instalment that supports it. A title external ID attached only to the first film
is discovery evidence, not permission to omit the remaining films.

Mapping confidence is `exact`, `high` or `low`. Low-confidence mappings remain
in normal responses so each consumer can choose whether to use them, and carry
a review flag that also places their assertions in the moderation queue.
Missing evidence may lower confidence; contradictory evidence is an assertion
conflict and does not publish a mapping. Completion states such as pending or
known-no-counterpart are separate from confidence.

### Errors

- Malformed id → `400` with `{ "error": "<what was expected>" }`.
- Id unknown to the upstream service in any media type → `404`.
- Contradictory evidence with no previous complete revision → `409` with an
  opaque review reference. It has no `Retry-After`; new evidence or review must
  resolve it.

### Pending builds

When a cold lookup starts a Workflow and no complete mapping revision exists,
the route returns `202 Accepted` with a `Retry-After` header and an opaque status
URL in the response body. It never returns an empty successful mapping for
active work because clients could treat or cache that as known-no-counterpart.
Stremio addon callers may retry the mapping request after the supplied delay.
A stale complete revision continues to return normally while its replacement
build runs.

Multi-service responses report coverage independently for each requested target
service. The route returns `200` when at least one target has a complete or open
revision, including those mappings alongside pending or conflict states for the
others. It returns a whole-response `202` only when no requested target is
usable and at least one active build can produce one. If none is usable or
active and contradictory evidence blocks a target, it returns `409`. A
completed search with no counterpart remains a successful empty result, not a
pending or conflict response.

### Persistence

Resolved mappings persist to the service-neutral graph in ADR-0002, not a
service-pair table. Repeat lookups in either direction are served from D1 with
zero upstream subrequests. Negative lookups of unknown ids are not persisted.
