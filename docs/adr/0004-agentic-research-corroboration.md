# ADR-0004: Agentic research passes publish through corroboration

An LLM research pass investigates one continuity across every mapping service
at once — via per-service API tools, SIMKL as a hint source, and official
operator domains only — and proposes assertions into the service-neutral
graph instead of replaying the deterministic pipeline pair-by-pair. The
pass's fetches _are_ the upstream requests: tool outputs are parsed by the
same validators as our server clients and persist as the spokes themselves,
so acceptance re-fetches nothing. A proposal publishes high-confidence only
with corroboration from at least two independent operators, one of which is a
validated API response; a page-scrape leg, a single source, or contradicting
sources cap the proposal at low confidence with a review flag. A sample of
published `llm-research` assertions is re-checked against live service data
when their group next revalidates.

## Considered options

- Deterministic re-verification of every claim: rejected — it duplicates
  exactly the upstream requests the pass exists to save.
- Full trust in well-formed output: rejected — hallucinated structure would
  publish unchallenged.
- Community wikis as publication evidence: rejected — moving targets;
  official operator domains only, and never counted toward the corroboration
  gate (the low-confidence exception applies when an API lacks fields or is
  unreachable mid-run).

## Consequences

- Research timing (before builds / after residue / off) is deployment policy
  set in the admin panel; deterministic fan-out remains the fallback for
  whatever a pass leaves unresolved.
- The reviewer stays a separate, cheap, tool-free structured-verdict task
  fired event-driven; heavyweight workflow runs never adjudicate batches.
