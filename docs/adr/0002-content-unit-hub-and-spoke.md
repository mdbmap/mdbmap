# ADR-0002: Content-unit hub-and-spoke for title mappings

Status: accepted (2026-08-21), amended (2026-08-22) for the service-neutral
N-service model

## Decision

Title mappings persist as a hub-and-spoke graph, not service-pair rows. The
logical target schema is:

- `title_groups` — one row per materialised connected component of accepted
  title assertions. It has no global matched or unmatched status.
- `content_units` — the hub: one row per atomic, indivisible piece of story
  content. A unit is an **opaque identity** with no position of its own; it
  means "this content exists" and nothing more. A spoke's link to a unit is
  many-to-many, not a single FK: a merged instalment covers several units, and
  a split instalment shares one unit with several counterpart spokes.
- `absence_assertions` — target-specific negative evidence, scoped to a
  **content unit**, not an instalment. Each row says that a known unit has no
  counterpart in one target service for a completed coverage revision.
  Absence from one service says nothing about any other service. A merged
  instalment can cover one unit with an absence row and one without; its own
  no-counterpart state is derived only when every unit it covers has one.
- `instalment_assertions` — the evidence-bearing edges. Each accepted assertion
  says that a service instalment covers one or more content units, carrying
  its own confidence and provenance per unit covered. A regular instalment
  covers exactly one unit; a merged instalment covers several. A split
  instalment still covers exactly one unit — it is the unit, not the
  instalment, that several split instalments share.
- `service_titles` — one row per service's record of a title
  (`tmdb`/`1396`, `imdb`/`tt0903747`), unique per (service, serviceId). A
  group may hold **several titles per service**, ordered by a persisted
  `ordinal` — the curated member order responses and the admin tools use.
- `title_assertions` — the evidence-bearing edges between title records. Each
  accepted assertion says that two records have overlapping instalment content
  and carries its own confidence and provenance. Accepted assertions connect
  title records into a title group.
- `relation_assertions` — directed, evidence-bearing edges from one title to
  its immediate mainline sequel. They build continuities but do not establish
  title overlap or group membership. Mainline relations are degree-1: each
  title has at most one immediate sequel and one immediate prequel, enforced
  by unique indexes so a divergent re-coverage (upstream drift) fails at the
  database instead of silently co-persisting. An accepted relation carries
  high confidence only when both records confirm the edge; a one-sided edge
  (the far record is fetched but names nothing back) publishes low and is
  flagged for review.
- `service_coverages` — one state per baseline continuity, target service and
  revision. It records whether that service comparison is complete, open,
  pending or blocked by conflict.
- `service_instalments` — the spokes: each instalment in its own title's
  numbering. An atomic title is itself one instalment. A spoke is identified by
  its **owning title plus its instalment locator**, never by position without
  the title: two member titles of one service may both have an S1E1. The locator
  records whether the service issued a stable instalment ID or only exposes a
  title-relative position. Its content-unit coverage is materialised from
  accepted positive assertions; no covered unit alone never means no
  counterpart. A spoke covers exactly one unit as a regular instalment, or
  several as a verified merge; a unit may likewise be covered by several
  spokes from one service for a verified split. Confidence and provenance
  stay on the assertions, not on the spoke or the unit.

Positions live on spokes only. An opaque hub carries no numbering of its own,
so an override only rewires links: the one hub a plan can invalidate is one it
leaves without a two-sided pairing, and that hub retires (its remaining spokes
unlink, since a one-sided hub already reads as unlinked).

## Content units and derived mappings

The hub is a **content unit**: atomic and indivisible, never itself split or
merged. Content overlap is not transitive, so a connected component of
assertions is not a safe hub once one instalment can cover more than one piece
of content. If service B airs a double episode covering what A and C both split
into two, a component would merge A1, A2, B12, C1 and C2 into one identity and
could derive A1-C2 as readily as A1-C1. Scoping the hub to a single content
unit prevents that: a regular instalment covers exactly one unit, B12 covers
two, and two spokes answer as counterparts only when they share a covered unit,
so A1 and C1 never cross with the half of B12 that belongs with A2 and C2.

The system does not verify or store every possible service pair. If AniList and
MAL instalments are each independently asserted against the same SIMKL
instalment, their shared content unit can answer an AniList-to-MAL request as
a **derived mapping**. No AniList-to-MAL assertion is invented. The mapping's
confidence is the weakest assertion on its selected path; when more than one
path exists, the strongest valid path wins. A direct comparison is reserved
for a missing SIMKL route or conflicting evidence.

A derived mapping must resolve every unit the source instalment covers, not
stop at the first shared one. If MAL's instalment is a merge covering two
units and AniList asserts against only one of them, the derived answer is the
array of every AniList instalment covering either unit — the same array shape
already used for direct split and merge counterparts — rather than a single
instalment that silently understates what MAL actually covers.

## Title groups and membership

The group follows instalment overlap rather than any catalogue's title
boundary. Separate season or cour entries may join one longer-running title,
while franchise relationship alone does not join remakes, spin-offs or sequels.
Pairwise title assertions are the source of truth for membership; instalment
matching runs between asserted title pairs rather than every member against
every other member.

Neither a title group nor a content unit requires TMDB or IMDb. The
service-neutral model generalises a show to a **title** and an episode to an
**instalment**. An episodic title contains instalments; an atomic title, such
as a film, is itself one instalment. Those catalogues are members like any
other service, not anchors, so discovery, freshness and curation must work for
groups that contain neither. N-service mappings hang off the same shape as
extra spokes on the same hub.

A group may hold several titles per service, ordered by `ordinal`. Everything
downstream is title-qualified: corrections name the member title of both their
subject and their proposal, the admin mapper picks a title per side, and
instalment-level responses format each counterpart under the title that owns
it — so an IMDb lookup answers with the TMDB title its counterpart lives in.

Curated multi-title groups are membership plus manual mapping. The deterministic
matcher still maps a single pair — the first member title of each service in
ordinal order. Further members are enumerated as unlinked spokes, which returns
the group to `unmatched` with `ladder_complete` false: their instalments are
"not mapped yet", never a final "no counterpart", until an admin maps them by
hand or vouches for the remaining gaps (the same "mark as matched" path an
unmatched group has).

This generalisation handles catalogues that disagree about media shape. One
AniDB movie collection may contribute several instalments that each assert
against a separate atomic film title elsewhere. Atomic titles do not receive
invented segment or instalment positions. A lookup for one atomic film returns
the specific AniDB instalment it matches, identified by the collection title and
instalment locator, rather than the bare collection title. The title assertion
records partial overlap; its instalment assertions define which part. In the
other direction, a bare collection-title lookup returns every overlapping
atomic film and reports the supporting instalment coverage for each one.

Some services, including AniList, expose a stable title ID and instalment count
but no instalment entities. Their instalments use the title ID plus ordinal
position as a positional locator; the system does not invent a service-issued
instalment ID. An assertion involving such an instalment records
position-derived provenance and is accepted only after the relevant segment
range has been verified.

## Discovery

SIMKL is the primary **discovery** broker for cross-service expansion; the
stored title graph remains service-neutral. On a cache miss, SIMKL is the first
discovery attempt for any id it supports. It is a shortcut, not a dependency: no
record, missing configuration or a failed request falls through to direct
service discovery, and cached mappings never require SIMKL to be available.

SIMKL is a discovery broker, not a canonical authority. Its native alignments
may become accepted title assertions after a cheap verification: TV against
TVDB, films against TMDB and anime against AniDB. Its other external IDs remain
candidate evidence because those catalogues often split seasons and cours at
different boundaries. An ID attached to an anime's first season does not justify
attaching later seasons, and one broad AniList entry does not justify merging
several narrower SIMKL entries.

From a known SIMKL anime, discovery walks explicit prequel links backwards and
sequel links forwards. It ignores side stories, spin-offs, recaps, alternatives
and generic relations; an ambiguous branch or contradiction becomes a review
candidate. Every related entry is fetched and checked separately, including its
native AniDB identity. The walk is evidence to inspect, not proof of title-group
membership. Each accepted step persists as a relation assertion with its
confidence and provenance. Continuity order is derived from those directed
edges; an ordinal may be cached for a build but is not the source of truth.

Once discovery verifies a SIMKL entry, matching rebases on the earliest
reachable entry in that mainline chain. The service and identifier that started
the request no longer determine how the chain is matched, but remain the
request cursor used to select and format the answer. A failed SIMKL lookup does
not rebase the request and falls through to direct service discovery.

Each title encountered on the chain is an ordered **segment**, not an assumed
season. Segment boundaries are soft matching evidence because catalogues may
split the same run into seasons, cours, films or combined entries. Matching
compares the ordered instalment streams across the whole discovered continuity
and may align one segment to one, several to one, or one to several. It
preserves each service's segment boundaries and never invents a shared canonical
segmentation.

The full chain is a **continuity** and one matching build may inspect it all. It
is not automatically one title group. Mainline prequel or sequel relations
establish order, not shared content. After matching, titles remain in separate
groups unless accepted title assertions connect them through actual instalment
overlap. A catalogue title spanning several segments can create that connection;
equally split catalogues cannot.

Discovery fans out through the external IDs on every SIMKL entry in the chain. A
TMDB-to-MAL lookup therefore tries TMDB → SIMKL, walks the SIMKL chain and checks
its MAL IDs before searching MAL by title. SIMKL's non-native IDs remain
candidates that the target catalogue must verify; direct catalogue search runs
only when SIMKL has no candidate or the candidate fails verification.

A repeated external ID on adjacent SIMKL entries is not automatically a conflict.
It may mean the target catalogue combines seasons or cours that SIMKL keeps
separate. Verification checks the target title against the combined SIMKL entries
before creating separate title assertions and dividing the target's instalments
between them. The repeated ID neither merges the SIMKL titles nor bypasses
verification.

An exact instalment-count fit across adjacent segments is useful structural
evidence, but does not by itself make their alignment exact or high. Discovery
also checks independent title, date, format and neighbouring-relation evidence
where the services expose it. If those checks are unavailable rather than
contradictory, the alignment may publish as low confidence and is flagged for
review. A failed check is a conflict, not merely missing evidence. When those
checks verify a complete segment range at high confidence, every ordinal
instalment assertion derived from that range is also high confidence even if the
target service has no instalment entities; its provenance remains
position-derived. For example, SIMKL's 12-instalment Stone Ocean Part 2 and
14-instalment Part 3 align with AniList's single 26-instalment Part 2 entry: the
external ID, exact combined count, release span, description and neighbouring
relations agree, so SIMKL Part 2 instalments 1–12 map to AniList 1–12 and Part 3
instalments 1–14 map to AniList 13–26 at high confidence.

### Structural group discovery

Membership is not always curated. TMDB splits some series into a title per
segment where IMDb keeps one title (Total Drama), so a cache miss also tries to
discover the group from a shared external ID: a `/find` on the shared IMDb id
lists **every** candidate TV title, and a candidate joins only when its own
`external_ids` points back at that same IMDb title. One-sided or conflicting
evidence attaches nothing.

Member order is the owning service's **live** first-air date, ascending, dateless
titles last, ties broken by service id — so every member discovers the same
group in the same order whichever one the resolve started from. Only the
resulting position is persisted, as `ordinal`; the dates themselves are never
stored and never have to be kept fresh.

A discovered group is mapped, not merely enumerated: the shared title's
instalment list is fetched once and the matcher runs per member title, in member
order, over whatever earlier members left unclaimed. That is what lets a late
member own a late segment, and why an assertion records the member title each
side belongs to rather than assuming the group's first.

One deliberate refusal, falling back to single-title behaviour without writing
anything: a **shared request budget that can't finish**. Every member's
enumeration is charged against one budget, and a group that doesn't fit is
refused whole. A partial group is a wrong group, not a smaller one.

### Converging with stored groups

A discovery whose members are already stored converges them rather than creating
a second group for the same series. Exact evidence may rewrite the matcher's own
work: the overlapping **algorithmic** groups merge into the lowest of their ids,
chosen from the stored ids alone so every member converges on the same survivor
whichever one the resolve started from, and so a retry after a failure picks it
again. Membership, instalment ownership and member ordinals are written as one
atomic batch — a compare-and-set on every involved group's stamp and membership,
and on none of them having become curated since the plan was read. A concurrent
discovery that got there first therefore lands nothing at all, and the next
request converges on what won.

The losing group rows survive the merge, emptied of members: their id is
recorded in `title_group_aliases` as an alias of the survivor, so an id this
service already served still opens the group its members now live in, and the
correction rows that reference it stay valid. Those corrections move to the
survivor with their subject title — a merge only unions membership, so every
subject keeps its title and its position. Aliases are flattened as they are
written: one hop always reaches a group that holds members.

Two collisions are never merged, and leave every stored group untouched:

- **Curated or corrected membership.** An admin's vouch, an approved correction,
  a manual pairing — exact evidence alone does not outrank a human. The collision
  is queued as a `pending_group_candidates` row instead, carrying the competing
  groups and the evidence that spans them.
- **A member the evidence says nothing about.** A stored group holding a title
  this discovery never named is a contradiction, not an expansion, and narrowing
  it is curation's call. It queues the same candidate.

The resolve then answers exactly as it would have without any stored group,
since a candidate is a question, not a mapping. Revalidation never rediscovers:
a stored multi-member group is remapped against exactly its stored membership, in
its stored ordinal order. An index hiccup must not narrow a group, and a
corrected first-air date must not reshuffle ids that are already public.

### Fuzzy candidates

Exact evidence leaves titles unpaired when a service lists no cross-service ID,
or lists one the other service doesn't recognise. Only then — and only in the
`background` closure a cache miss returns alongside `persist`, which callers
chain after the write so neither the response nor the write waits on a search —
both services are searched by the title and year that compute already paid for.
The search costs one request per service and the result sets are capped. Hits
score on normalised title similarity weighted with year agreement, where a year
one apart still agrees (services date a title from different events) and a
missing year is absent evidence rather than disagreement — so a title that
matches perfectly but a year that doesn't falls below the bar on the year alone.

**Fuzzy evidence never changes membership.** Whatever clears the bar is queued as
a `fuzzy-group` row in `pending_group_candidates`, carrying the whole case an
admin reviews — the queries, and every hit's title, year and score in one of
three buckets: the proposed members, hits that cleared the bar but fell past the
member cap ("over the cap"), and hits the score dropped ("also considered"). The
resolve answers exactly as it would have without any search. Accepting is what
makes it real: the proposed titles join the subject's group through the same
curated attach path an admin's own edit takes, so the recompute persists their
ordinals (the stored members first, then the proposal in scored order). A
proposed title already stored under another group is refused rather than moved.

Rejecting records the verdict, and the row's `evidence_hash` is the proposed
membership as a canonical set of service/id pairs. The candidate row already
scopes that fingerprint by kind and subject; query outcomes, titles, years and
scores remain review context rather than reasons to reopen the same membership
question. A later resolve producing the same proposal finds the rejection and
queues nothing. Adding or removing a proposed member hashes differently and
reopens the question. Repeat and concurrent discoveries of the same subject
coalesce into the one open row the partial unique index allows.

## Deterministic matcher

The deterministic matcher aligns instalment streams between asserted title pairs.
It runs as the fallback for whatever an agentic research pass leaves unresolved
(see ADR-0004) and as the sole matcher where no pass is configured. It is a
tiered ladder: cheap structural agreement first, then whole-title pattern
transforms, then per-instalment scoring.

Alignment uses the continuity's **main sequence**. Only regular instalments
contribute to cumulative offsets. Embedded specials, OVAs and recaps are matched
separately and cannot shift every later assertion. An atomic film or OVA still
participates when it is a separately verified mainline segment, because the title
itself is then a regular instalment in that continuity rather than an extra
inside another title.

A service's non-default orderings — TVDB's official, DVD, absolute, alternate and
regional season types, TMDB episode groups — are **matching orders**. The matcher
may compare them with another service's sequence, but it never stores one as a
separate instalment or exposes its qualifier in a public ID. TVDB instalments use
their stable episode IDs internally and the series' default season-and-episode
order at the boundary.

Every accepted main-sequence comparison is a **monotonic alignment** after the
matcher selects any matching order. Gaps and split or merged instalments are
legal, but mappings cannot cross. If no available ordering produces a monotonic
result, the proposals conflict and remain outside the published graph.

A currently airing title is an **open segment**. The matcher may publish its
released prefix when both services expose the positions and the evidence supports
the alignment. It revalidates that segment as instalments arrive and does not
treat its current count as a final boundary. Unknown future positions remain
pending and can never receive a known-no-counterpart result. This differs from a
truncated fetch, which cannot publish because the service claims more data exists
than the matcher retrieved.

### Tier 1 — structure

T1 aligns a title pair only when the segments demonstrably agree: same segment
numbers, same instalment numbers per segment, air-date spot checks pass on
regular segments. A service's specials section (TMDB season 0, IMDb's
non-numeric seasons) is always a later tier's problem. Anything else persists an
`unmatched` group — an explicit "not mapped yet" that later tiers upgrade —
never a best-effort guess. Instalment fetches are budgeted (25 TMDB season
requests, 6 IMDb pages) to stay inside Workers' per-invocation subrequest limit.
A title over budget persists a bare unmatched group with no spokes: every
position 404s until a later tier enumerates it.

### Tier 2 — pattern

When T1's structure check fails, T2 tries whole-title pattern transforms:
continuous↔segmented renumbering via cumulative instalment counts (both
directions), constant segment offsets, and TMDB episode groups as candidate
alternate orderings. A transform only proposes a pairing — acceptance
additionally requires air-date (or, where dates are missing, title) agreement
across every proposed pair, with a minimum of comparable evidence. Only full-title
fits are accepted; partial fits persist the same explicit unmatched group T1
would. Specials stay excluded. Episode-group fetches are budgeted too: one
listing plus at most 3 group-detail requests, spent only when the free
arithmetic transforms don't fit.

### Tier 3 — scoring

When T1/T2 leave instalments unplaced, T3 scores individual candidate pairs:
air-date proximity (±1 day tolerance; further apart disqualifies), fuzzy title
similarity (edit distance + token overlap, normalised), runtime, and segment
position, greedily linking the best-scoring disjoint candidates. At least one
identifying signal (air date or title) must be comparable — runtime and position
only ever support a match, so structure is never assumed. T3 always runs, even
after a T1/T2 match, because specials never follow the title's structural
pattern (AoT: TMDB's season-0 specials are late IMDb season-4 episodes) — their
positions carry no scoring weight, and the specials section is fetched and
persisted as spokes. Consecutive same-day instalments also compete as combined
candidates, letting summed runtimes resolve split/merged instalments (Paw
Patrol: two ~11-minute TMDB halves link to one ~22-minute IMDb episode — one
content unit, three spokes, so one side's mapping is an array). High scores
auto-accept (`confidence: "high"`); mid-band scores link with `confidence:
"low"`, flagged for review; below that nothing links and the instalment persists
as an unlinked spoke — an explicit no-counterpart `[]`.

## Provenance

Provenance is a property of an assertion, not of a title. Every instalment
assertion carries a `source`: temporary claim scaffolding (`bootstrap`, retired
once real tier evidence replaces it), the tier that derived it (`t1-structure`,
`t2-pattern`, `t3-episode`), the research pass that proposed it (`llm-research`,
`llm-verified` once the review model confirms it), or the curation that vouched
for it (`community` for an approved correction, `manual` for an admin edit).
Recompute re-derives the algorithmic links and merges around the curated ones —
updated pairings, new instalments appended, curated hubs and their spokes
untouched. A recomputed pairing that wants a position a curated link already
holds loses: its surviving side joins the group as an unlinked spoke rather than
contradicting the curation.

The group row's `source` does not gate recompute. It records the highest tier
the matcher tried, or `manual` when an admin vouched for the group _itself_ (the
"mark as matched" fiat, curated membership): that vouch keeps the group's
`status`, `ladder_complete`, membership and source across a recompute, which
still re-derives its links. `release` hands both the group and every one of its
links back to the matcher. Gating recompute on group-level source protected too
much — one approved correction, or an LLM review confirming the last flagged
link of an airing title with no human in the loop, would freeze the whole group
so new instalments stopped being mapped.

Responses serve a **derived** group source: the most curated provenance any of
the group's links carries, or the group row's own when that outranks them
(precedence: `manual` > `community` > `llm-verified` > `llm-research` >
`t3-episode` > `t2-pattern` > `t1-structure` > `bootstrap`). A curated instalment
is therefore still visible in a title-level answer, while instalment-level
answers carry the link's own source. A `"mixed"` value was considered and
rejected: it adds a value every client must learn for information the
per-instalment sources already carry precisely.

"No counterpart" is a curated decision with no hub to carry it, so it rides on
the spoke instead: an approved report or an admin edit that leaves an instalment
unlinked stamps that spoke, and the recompute neither deletes it nor pairs the
position up again. Such an instalment answers `confidence: "none"` whatever the
group's `ladder_complete` says — the verdict is final for that instalment even
while the rest of the title is still the matcher's. A rewire clears the stamp, so
it never outlives the decision that made it.

Because the merge plan is made from reads taken before the write, the recompute's
batch is a compare-and-set on exactly what it assumed — the group's stamp and
source, its membership, and the set of spokes curation owns. A correction
approved in that window would otherwise have its position written twice, once
preserved and once re-derived; instead the batch aborts untouched and a later
request recomputes against the new state.

## Conflicts and review

Exact, high and low assertions may all be published. A low assertion remains
visible to mapping consumers and carries a review flag; the moderation queue does
not make it pending. Consumers decide whether their use case accepts low
confidence. A derived mapping is low when any assertion on its selected path is
low.

Competing algorithmic paths do not resolve an **assertion conflict** by score.
The proposed assertions remain outside the published graph and the conflict is
queued for review. A prior manual assertion may reject the competing proposal
because manual evidence already outranks algorithmic evidence; otherwise even a
nominally high-confidence path cannot erase the contradiction. Readers continue
to receive the previous complete revision, or a conflict result when no complete
revision exists. Verified split and merge mappings remain legal and are not
conflicts merely because one instalment has several counterparts.

Assertion conflicts and low-confidence review flags queue in the same
`pending_group_candidates` table as membership candidates: the shape (a subject,
a JSON evidence blob, a status, coalescing on repeat discovery) already fits, at
a finer subject grain. `kind` gains `title-assertion-conflict`,
`instalment-assertion-conflict`, `absence-assertion-conflict`,
`continuity-conflict` and `low-confidence-flag`, with `subject` naming the
specific title or instalment pair rather than a whole title. Each kind pairs with
exactly one evidence shape — an instalment-coverage contradiction carries the
proposal/published instalments, an absence contradiction carries the checked
absences and the coverage they clash with. A `continuity-conflict` carries one
case the SIMKL walk refused to resolve — competing same-direction continuations
of a branch, a cycle-closing link, a disputed adjacency between two records, an
uncoverable candidate-ID span, or a candidate ID whose record is not anime-shaped
— naming the entry and the competing/contradicting relations. Nothing is
published on either side until a moderator settles it. One moderation queue and
one admin UI serve every group.

## Overflow builds

Production assumes the Workers Paid limits, but their platform ceiling is not the
matching budget. Before fetching full instalment lists, discovery estimates the
work from the chain and candidate counts. Work that fits a conservative request
budget runs synchronously. Work that does not fit becomes one idempotent
background build; an unexpected budget overrun or retryable upstream failure
takes the same path.

A background build may persist private progress, but readers never observe it as
a smaller title group or a partly matched continuity. Concurrent requests join
the same logical build. The completed result is published as one mapping revision
for that target service; until then, a reader receives either the previous
complete revision or a pending result when none exists. A partial group is wrong
rather than merely smaller.

The overflow path uses Cloudflare Workflows rather than a raw Queue. One Workflow
instance owns one SIMKL continuity, target service and baseline revision. Its
deterministic instance ID deduplicates concurrent requests for the same work.
Discovery, target fetching, alignment and publication are separate durable steps
with service-specific retry and timeout policies. D1 remains the source of
published mappings and service coverage; Workflow state coordinates execution,
and large private intermediate results may stage in D1. Queues are not part of
the initial design.

Publication is atomic per target service across the continuity, not across the
whole fan-out. If Kitsu is unavailable after AniList and MAL have each completed
their comparisons, the AniList and MAL assertions publish while Kitsu service
coverage remains pending and retries independently. One upstream outage cannot
hide other services' verified mappings. This does not permit a truncated
continuity within any one service comparison.

## Response shape

Extends the response of ADR-0001:

- `confidence` is `"high"`, `"low"` (a link awaiting review), `"none"` (the whole
  matcher evaluated the instalment and found no counterpart — the empty array is
  final), or `"unmatched"` (still awaiting a tier — empty arrays mean "not mapped
  yet"). Instalment-level lookups serve their link's confidence; unlinked spokes
  serve `"none"` in groups whose stored `ladder_complete` flag is set (the whole
  ladder, through an untruncated T3 run, evaluated every instalment) and
  `"unmatched"` elsewhere (over-budget enumeration, truncated lists or T3 runs,
  missing counterpart title).
- `source` is per link (see Provenance): an instalment-level lookup serves its own
  link's, a title-level lookup the group's derived one, and each entry of the
  `instalments` array carries its own — an unlinked position falls back to the
  group's, which is what speaks for it.
- Instalment mappings are arrays: a split/merged instalment maps to every
  counterpart spoke on its content unit (both halves, or the one containing
  instalment).
- Title-level lookups (`/series/tmdb:1396`) map to every counterpart-service
  member title, in curated order, and add an `instalments` array — the requested
  title's own instalments, each entry `{ input, mappings, source }` in the
  request's direction. Instalment-level lookups (`/series/tmdb:1396:2:5`) omit it.
- Instalment ids in responses are always title id + position in that service's own
  numbering (`tt0903747:2:5`), so every returned id is itself a valid `/series`
  input — and in a multi-title group the id names the member title the
  counterpart belongs to.

## Compute path

A cache miss discovers the group's membership, fetches every member's full
instalment list inline (TMDB per-segment endpoints, specials included; IMDb
unofficial GraphQL), runs the deterministic matcher (T1, T2, then always T3), and
persists via `waitUntil`; work over the synchronous budget runs as an overflow
build instead. Cache hits are pure D1 reads — zero external subrequests,
discovery included.
