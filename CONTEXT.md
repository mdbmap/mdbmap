# Domain glossary

mdbmap is a personal media tracker built on a cross-service mapping engine. The engine relates titles and instalments across external media catalogues while preserving each catalogue's own identity and numbering; the tracker layers user watch status and ratings on top.

## Language

**Absence assertion**:
A checked claim that one content unit has no counterpart in a particular target service for a particular coverage revision. It is scoped to the unit, not the instalment, because a merged instalment can cover one unit with a counterpart and one without. An instalment-level "no counterpart" is derived only when every unit it covers has one. It carries evidence and provenance.
_Avoid_: Globally unlinked instalment, unknown mapping

**Assertion conflict**:
Two or more candidate assertions that cannot all be true because they imply incompatible content identity or continuity order. A verified split or merge is not a conflict.
_Avoid_: Low confidence, duplicate mapping

**Community score**:
mdbmap's own aggregate rating for a rateable unit: the mean, with a count, of its users' personal ratings. It is native to mdbmap and derived from user data, shown beside the service ratings and the viewer's own, never merged with them. Count is always shown; there is no minimum-N hide threshold.
_Avoid_: Average rating, overall score

**Conflict result**:
A lookup with no complete revision because contradictory candidate assertions block publication. It requires new evidence or review and is neither low confidence nor active work.
_Avoid_: Pending result, review flag

**Content unit**:
The atomic, service-neutral piece of story content that instalments cover. It has no service-native identity, numbering, confidence or provenance of its own; that evidence lives on each instalment's coverage assertion. One instalment may cover several content units (a merged episode), and one content unit may be covered by several instalments (a split episode).
_Avoid_: Canonical instalment, master episode

**Continuity**:
An ordered set of segments connected by accepted mainline prequel and sequel relations. A continuity defines the scope inspected during matching and is the unit the tracker holds watch status against. It does not imply that its titles contain overlapping content or belong to one title group.
_Avoid_: Franchise, title group, series

**Corroboration**:
Agreement between two independent sources behind a proposed assertion. Sources count only when they belong to different operators, and at least one must be a catalogue's own record rather than a page describing one; anything weaker keeps the proposal low confidence.
_Avoid_: Double confirmation, cross-check

**Derived mapping**:
An equivalence answered by following accepted instalment assertions through a shared content unit. It does not create a direct assertion between the requested services, and its confidence cannot exceed the weakest assertion on the selected path.
_Avoid_: Direct match, inferred assertion

**Instalment**:
One watchable unit addressable within a service's title. It may be an episode within an episodic title or an atomic title such as a film.
_Avoid_: Episode when referring to films

**Instalment assertion**:
A claim that a service instalment covers one or more content units. A regular instalment covers exactly one; a merged instalment covers several. A split instalment still covers exactly one unit — it is the unit, not the instalment, that several split instalments share. Each assertion carries its own evidence, confidence and provenance.
_Avoid_: Canonical link, hub confidence, same-content claim

**Instalment locator**:
The service-specific identity of an instalment within its owning title. It may be a service-issued record identifier or a title-relative position when the service has no instalment records.
_Avoid_: Episode ID when the service issued no such ID

**Main sequence**:
The ordered regular instalments used to align segments across a continuity. Embedded specials, OVAs and recaps do not change its offsets, while an atomic title participates when it is itself a verified mainline segment.
_Avoid_: Absolute order, all instalments

**Matching order**:
A service-provided alternate arrangement of instalments used to test an alignment. It is evidence only, never an instalment identity or public locator.
_Avoid_: Public numbering, canonical order

**Monotonic alignment**:
An alignment that preserves the relative order of both main sequences. It may contain gaps and split or merged instalments, but its mappings never cross.
_Avoid_: Exact numbering, equal-length sequence

**Open segment**:
A segment that its service reports as still growing. Its released instalments may be mapped, but its final boundary and future positions remain unsettled.
_Avoid_: Incomplete fetch, truncated segment

**Pending result**:
A lookup with no complete revision while an active build is expected to produce one. It is temporary and does not mean no counterpart or unresolved conflict.
_Avoid_: Empty mapping, assertion conflict

**Personal rating**:
A user's own score for a rateable unit, an integer from 1 to 10. It is durable user data, feeds the community score, and maps directly onto a sync target's scale.
_Avoid_: Vote, review score

**Presentation order**:
A named arrangement of a continuity's segments for the work page, such as release or watch. It may reorder episodic cours and atomic film segments without changing title-group membership or instalment locators. It is not a matching order.
_Avoid_: Watch order list, franchise playlist, matching order

**Rateable unit**:
Any level a rating attaches to: the work, a TV season or anime cour, an episode, or a single grouped-movie instalment such as an AniDB Madoka film.
_Avoid_: Title-only rating

**Service rating**:
An external service's own published score for a title or instalment, kept in that service's native scale with its kind (user or critic), vote count, granularity and fetch time. Service ratings are shown as a per-service list, never merged into one number. Most services score only titles; only a few carry instalment scores. A service's sort or popularity value, such as TVDB's `score`, is not a rating.
_Avoid_: Aggregate score, normalised rating, TVDB rating

**Relation assertion**:
A claim that one title directly precedes another in the same mainline continuity. It carries evidence, confidence and provenance, but does not claim overlapping content or title-group membership.
_Avoid_: Title assertion, franchise relation

**Research pass**:
A bounded investigation of one continuity that gathers evidence from the services and official pages and returns proposed assertions for every target service together, rather than one pairing at a time.
_Avoid_: Auto-mapping, agent crawl

**Review flag**:
A marker on a published low-confidence assertion that places it in the review queue without hiding its mapping from consumers.
_Avoid_: Pending mapping, assertion conflict

**Service coverage**:
The extent to which one service has been inspected across a continuity. It is tracked independently for each service and may be complete, open, pending or blocked by conflict.
_Avoid_: Title-group status, all-service completion

**Segment**:
One title boundary within a service's ordered continuity. It may represent a season, cour, film or combined run and is not assumed to align one-to-one with another service's segments.
_Avoid_: Season when the boundary is catalogue-specific

**Service**:
An external media catalogue whose title and instalment identifiers can both be mapping inputs and counterparts.
_Avoid_: Provider, source, title-level alias

**Title**:
One service's record for a work. An episodic title contains instalments; an atomic title, such as a film, is itself one instalment.
_Avoid_: Show when referring to films

**Title assertion**:
A claim that two service titles have overlapping instalment content. It does not imply that either title covers all of the other; instalment assertions record the actual coverage. Each title assertion carries its own evidence, confidence and provenance.
_Avoid_: Group source, title match

**Title group**:
A service-neutral collection of titles whose instalments belong to the same connected mapping component. Catalogue segmentation may put several titles from one service in a group, but franchise relationship alone does not.
_Avoid_: Series group, TMDB group, IMDb group

**Verdict**:
A reviewer's advisory judgement on one assertion under question: supporting, disputing, or unable to tell. Only a supporting verdict ever acts on its own; any other escalates the item to human review.
_Avoid_: Opinion, score

**Watch status**:
A user's state for a tracked work: watching, plan to watch, on hold, completed, dropped or rewatching, with a rewatch count. It is held once per continuity at the work level; sync fans it out to the correct per-entry record on each target service through the instalment mappings.
_Avoid_: Per-season status, list state

**Catalogue metadata**:
The durable snapshot of one TMDB or AniDB title's display fields, including every stored locale. Losing it is recoverable by refetch, but the record is kept so completed titles are not recrawled on a timer.
_Avoid_: Metadata cache, KV snapshot

**Freshness class**:
The update cadence of one catalogue metadata record: continuing, upcoming, or completed. Continuing titles are recrawled often; completed titles rarely.
_Avoid_: TTL, cache expiry, stale time

**User refresh**:
A viewer-requested recrawl of a work's catalogue metadata. It is admitted at most once per twenty-four hours per continuity, not per viewer.
_Avoid_: Cache bust, force sync, per-user refresh
