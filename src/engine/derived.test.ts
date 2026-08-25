import { describe, expect, it } from "vitest";

import { deriveInstalment, deriveLink } from "./derived.ts";
import type { InstalmentNode, UnitCoverage } from "./derived.ts";
import type { Identity, Service, TitleIdentity } from "./identity.ts";
import { serialize } from "./serializer.ts";

const anilistTitle: TitleIdentity = { id: "100", service: "anilist" };
const malTitle: TitleIdentity = { id: "200", service: "mal" };

const episode = (title: TitleIdentity, ep: number): Identity => ({
	kind: "instalment",
	locator: { episode: ep, season: 1 },
	title,
});

const node = (
	title: TitleIdentity,
	ep: number,
	coverage: readonly UnitCoverage[],
): InstalmentNode => ({ coverage, identity: episode(title, ep) });

// Narrow any status-bearing link to its matched variant, failing otherwise.
function expectMatched<LinkType extends { readonly status: string }>(
	link: LinkType | undefined,
): asserts link is Extract<LinkType, { status: "matched" }> {
	expect(link?.status).toBe("matched");
}

describe("deriveLink", () => {
	it("derives AniList->MAL through a shared SIMKL-anchored unit without a new assertion", () => {
		const source = node(anilistTitle, 1, [
			{ confidence: "high", source: "t1-structure", unitId: 7 },
		]);
		const target = node(malTitle, 1, [
			{ confidence: "low", source: "t3-episode", unitId: 7 },
		]);

		const link = deriveLink(source, [source, target], "mal");
		expectMatched(link);

		expect(link.counterparts).toHaveLength(1);
		const [counterpart] = link.counterparts;
		expect(counterpart?.identity).toStrictEqual(episode(malTitle, 1));
		// Weakest link on the path sets the confidence.
		expect(counterpart?.confidence).toBe("low");
		// The path is exactly the two accepted assertions traversed; no A->B row.
		expect(counterpart?.assertionPath).toStrictEqual([
			{ confidence: "high", source: "t1-structure" },
			{ confidence: "low", source: "t3-episode" },
		]);
	});

	it("returns every counterpart when the source instalment merges two units", () => {
		// MAL merges what AniList splits: unit 7 -> ep 1, unit 8 -> ep 2.
		const source = node(malTitle, 1, [
			{ confidence: "high", source: "t1-structure", unitId: 7 },
			{ confidence: "high", source: "t1-structure", unitId: 8 },
		]);
		const first = node(anilistTitle, 1, [
			{ confidence: "high", source: "t3-episode", unitId: 7 },
		]);
		const second = node(anilistTitle, 2, [
			{ confidence: "high", source: "t3-episode", unitId: 8 },
		]);

		const link = deriveLink(source, [source, first, second], "anilist");
		expectMatched(link);

		expect(link.counterparts.map((counterpart) => counterpart.identity)).toStrictEqual([
			episode(anilistTitle, 1),
			episode(anilistTitle, 2),
		]);
	});

	it("chooses the strongest of two valid paths to one counterpart", () => {
		// Source and target share two hub units; one route is all-high, the
		// other passes through a low assertion.
		const source = node(anilistTitle, 1, [
			{ confidence: "high", source: "t1-structure", unitId: 7 },
			{ confidence: "high", source: "t1-structure", unitId: 8 },
		]);
		const target = node(malTitle, 1, [
			{ confidence: "high", source: "t3-episode", unitId: 7 },
			{ confidence: "low", source: "t3-episode", unitId: 8 },
		]);

		const link = deriveLink(source, [source, target], "mal");
		expectMatched(link);

		const [counterpart] = link.counterparts;
		expect(counterpart?.confidence).toBe("high");
		expect(counterpart?.assertionPath).toStrictEqual([
			{ confidence: "high", source: "t1-structure" },
			{ confidence: "high", source: "t3-episode" },
		]);
	});

	it("breaks equal-confidence paths by provenance, not coverage order", () => {
		// Both hub units yield a high path; the more-curated one must win
		// regardless of the order the target lists its coverage.
		const source = node(anilistTitle, 1, [
			{ confidence: "high", source: "t1-structure", unitId: 7 },
			{ confidence: "high", source: "manual", unitId: 8 },
		]);
		const curatedFirst = node(malTitle, 1, [
			{ confidence: "high", source: "manual", unitId: 8 },
			{ confidence: "high", source: "t3-episode", unitId: 7 },
		]);
		const curatedLast = node(malTitle, 1, [
			{ confidence: "high", source: "t3-episode", unitId: 7 },
			{ confidence: "high", source: "manual", unitId: 8 },
		]);
		const curatedPath = [
			{ confidence: "high", source: "manual" },
			{ confidence: "high", source: "manual" },
		];

		for (const target of [curatedFirst, curatedLast]) {
			const link = deriveLink(source, [source, target], "mal");
			expectMatched(link);
			expect(link.counterparts[0]?.assertionPath).toStrictEqual(curatedPath);
		}
	});

	it("has no derived route to the source's own service", () => {
		// Same-service split siblings sharing a unit are direct split/merge, not
		// a hub derivation (ADR-0002).
		const source = node(anilistTitle, 1, [
			{ confidence: "high", source: "t1-structure", unitId: 7 },
		]);
		const sibling = node(anilistTitle, 2, [
			{ confidence: "high", source: "t3-episode", unitId: 7 },
		]);

		expect(deriveLink(source, [source, sibling], "anilist")).toBeUndefined();
	});

	it("has no shared-unit route when nothing overlaps", () => {
		const source = node(anilistTitle, 1, [
			{ confidence: "high", source: "t1-structure", unitId: 7 },
		]);
		const target = node(malTitle, 1, [
			{ confidence: "high", source: "t3-episode", unitId: 99 },
		]);

		expect(deriveLink(source, [source, target], "mal")).toBeUndefined();
	});
});

describe("deriveInstalment", () => {
	it("feeds the serializer a resolved answer per derived service", () => {
		const source = node(anilistTitle, 1, [
			{ confidence: "high", source: "t1-structure", unitId: 7 },
		]);
		const target = node(malTitle, 1, [
			{ confidence: "low", source: "t3-episode", unitId: 7 },
		]);

		const answer = deriveInstalment(
			source,
			[source, target],
			["mal", "tvdb"] satisfies readonly Service[],
		);

		// Only services with a shared-unit route appear.
		expect([...answer.links.keys()]).toStrictEqual(["mal"]);

		const response = serialize(answer);
		expect(response.input).toBe("anilist:100:1");
		const { mal } = response.mappings;
		expectMatched(mal);
		expect(mal.counterparts.map((counterpart) => counterpart.id)).toStrictEqual([
			"mal:200:1",
		]);
		expect(mal.confidence).toBe("low");
	});
});
