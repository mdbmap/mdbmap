import { describe, expect, it } from "vitest";

import type { SimklExternalIds, SimklRelation, SimklService } from "./simkl.ts";
import { simklServices } from "./simkl.ts";
import { anime } from "./test-fixtures.ts";
import type { CatalogueTitle, VerificationClients } from "./verify.ts";
import { verifyChain } from "./verify.ts";
import type { ChainSegment, ContinuityChain } from "./walk.ts";

const segment = (
	id: string,
	externalIds: SimklExternalIds,
	relations: readonly SimklRelation[],
	ordinal: number,
	entryTitle: string = id,
): ChainSegment => ({
	entry: { ...anime(id, externalIds, relations), title: entryTitle },
	externalIds,
	nativeAnidbId: externalIds.anidb,
	ordinal,
});

const chainOf = (segments: readonly ChainSegment[]): ContinuityChain => {
	const [rebase] = segments;
	if (rebase === undefined) {
		throw new Error("a chain needs at least one segment");
	}
	return { kind: "chain", rebase, segments };
};

const clientsFrom = (
	catalogues: Partial<Record<SimklService, Record<string, CatalogueTitle>>>,
): VerificationClients => {
	const clients: VerificationClients = {};
	for (const service of simklServices) {
		const records = catalogues[service];
		if (records !== undefined) {
			clients[service] = { fetchTitle: (serviceId) => records[serviceId] };
		}
	}
	return clients;
};

const catalogue = (fields: Partial<CatalogueTitle>): CatalogueTitle => ({
	format: undefined,
	instalmentCount: undefined,
	releaseDate: undefined,
	title: "",
	...fields,
});

describe("simkl verification", () => {
	it("splits a combined target across the segments it covers at high confidence", async () => {
		const chain = chainOf([
			segment(
				"so2",
				{ anidb: "d2", anilist: "al" },
				[{ kind: "sequel", toId: "so3" }],
				0,
				"Stone Ocean Part 2",
			),
			segment(
				"so3",
				{ anidb: "d3", anilist: "al" },
				[{ kind: "prequel", toId: "so2" }],
				1,
				"Stone Ocean Part 3",
			),
		]);
		const clients = clientsFrom({
			anidb: {
				d2: catalogue({
					instalmentCount: 12,
					releaseDate: "2022-01-07",
					title: "Stone Ocean Part 2",
				}),
				d3: catalogue({
					instalmentCount: 14,
					releaseDate: "2022-08-01",
					title: "Stone Ocean Part 3",
				}),
			},
			anilist: {
				al: catalogue({
					instalmentCount: 26,
					releaseDate: "2022-01-07",
					title: "Stone Ocean Part 2",
				}),
			},
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.conflicts).toStrictEqual([]);
		expect(result.titleAssertions).toHaveLength(2);
		expect(
			result.titleAssertions.map((plan) => ({
				anchor: plan.anchor.serviceId,
				confidence: plan.confidence,
				range: plan.targetRange,
			})),
		).toStrictEqual([
			{ anchor: "d2", confidence: "high", range: { from: 1, to: 12 } },
			{ anchor: "d3", confidence: "high", range: { from: 13, to: 26 } },
		]);
		expect(
			result.titleAssertions.every((plan) => plan.target.serviceId === "al"),
		).toBe(true);
	});

	it("publishes a one-sided mainline edge as low and flagged", async () => {
		const chain = chainOf([
			segment("a", { anidb: "1" }, [{ kind: "sequel", toId: "b" }], 0),
			segment("b", { anidb: "2" }, [], 1),
		]);
		const clients = clientsFrom({
			anidb: { 1: catalogue({ title: "A" }), 2: catalogue({ title: "B" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.relationAssertions).toHaveLength(1);
		expect(result.relationAssertions[0]).toMatchObject({
			confidence: "low",
			flagged: true,
		});
	});

	it("keeps a two-sided mainline edge high and unflagged", async () => {
		const chain = chainOf([
			segment("a", { anidb: "1" }, [{ kind: "sequel", toId: "b" }], 0),
			segment("b", { anidb: "2" }, [{ kind: "prequel", toId: "a" }], 1),
		]);
		const clients = clientsFrom({
			anidb: { 1: catalogue({ title: "A" }), 2: catalogue({ title: "B" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.relationAssertions[0]).toMatchObject({
			confidence: "high",
			flagged: false,
		});
	});

	it("treats a failed date check as a conflict, not a low-confidence publish", async () => {
		const chain = chainOf([
			segment("x", { anidb: "dx", anilist: "alx" }, [], 0),
		]);
		const clients = clientsFrom({
			anidb: {
				dx: catalogue({
					instalmentCount: 12,
					releaseDate: "2020-01-01",
					title: "X",
				}),
			},
			anilist: {
				alx: catalogue({
					instalmentCount: 12,
					releaseDate: "2023-06-01",
					title: "X",
				}),
			},
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.conflicts).toStrictEqual([
			{
				kind: "verification-conflict",
				reason: "date-mismatch",
				segmentOrdinals: [0],
				target: { service: "anilist", serviceId: "alx" },
			},
		]);
	});

	it("treats a mismatched combined count as a conflict", async () => {
		const chain = chainOf([
			segment("x", { anidb: "dx", anilist: "alx" }, [], 0),
		]);
		const clients = clientsFrom({
			anidb: { dx: catalogue({ instalmentCount: 12, title: "X" }) },
			anilist: { alx: catalogue({ instalmentCount: 20, title: "X" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]?.reason).toBe("count-mismatch");
	});

	it("publishes low and flags when the count fits but nothing corroborates", async () => {
		const chain = chainOf([
			segment("x", { anidb: "dx", anilist: "alx" }, [], 0, "Blue Lock"),
		]);
		const clients = clientsFrom({
			anidb: { dx: catalogue({ instalmentCount: 12, title: "Blue Lock" }) },
			anilist: {
				alx: catalogue({ instalmentCount: 12, title: "Something Unrelated" }),
			},
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.conflicts).toStrictEqual([]);
		expect(result.titleAssertions).toHaveLength(1);
		expect(result.titleAssertions[0]).toMatchObject({
			confidence: "low",
			flagged: true,
			targetRange: { from: 1, to: 12 },
		});
	});

	it("refuses to anchor when the native record is not the SIMKL entry's title", async () => {
		const chain = chainOf([
			segment("x", { anidb: "dx", anilist: "alx" }, [], 0, "Real Show"),
		]);
		const clients = clientsFrom({
			anidb: {
				dx: catalogue({
					instalmentCount: 12,
					title: "Totally Different Anime",
				}),
			},
			anilist: { alx: catalogue({ instalmentCount: 12, title: "Real Show" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		// No anchor means no verified pairing — the target id stays candidate
		// evidence rather than reaching a title assertion off a bad native id.
		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.candidates).toStrictEqual([
			{ segmentOrdinal: 0, service: "anilist", serviceId: "alx" },
		]);
	});

	it("leaves an unconfigured target id as candidate evidence", async () => {
		const chain = chainOf([segment("x", { anidb: "dx", mal: "m1" }, [], 0)]);
		const clients = clientsFrom({ anidb: { dx: catalogue({ title: "X" }) } });

		const result = await verifyChain(chain, { clients, target: "mal" });

		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.candidates).toStrictEqual([
			{ segmentOrdinal: 0, service: "mal", serviceId: "m1" },
		]);
	});

	it("leaves a target id the catalogue does not recognise as a candidate", async () => {
		const chain = chainOf([
			segment("x", { anidb: "dx", anilist: "gone" }, [], 0),
		]);
		const clients = clientsFrom({
			anidb: { dx: catalogue({ instalmentCount: 12, title: "X" }) },
			anilist: {},
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.candidates).toStrictEqual([
			{ segmentOrdinal: 0, service: "anilist", serviceId: "gone" },
		]);
	});

	it("reaches high on format agreement when the title does not corroborate", async () => {
		const chain = chainOf([
			segment("x", { anidb: "dx", anilist: "alx" }, [], 0, "Blue Lock"),
		]);
		const clients = clientsFrom({
			anidb: {
				dx: catalogue({
					format: "ONA",
					instalmentCount: 12,
					title: "Blue Lock",
				}),
			},
			anilist: {
				alx: catalogue({
					format: "ona",
					instalmentCount: 12,
					title: "Different Name",
				}),
			},
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.conflicts).toStrictEqual([]);
		expect(result.titleAssertions[0]).toMatchObject({
			confidence: "high",
			flagged: false,
		});
	});

	it("reaches high on a two-sided mainline edge when nothing else corroborates", async () => {
		const chain = chainOf([
			segment(
				"p2",
				{ anidb: "d2", anilist: "al" },
				[{ kind: "sequel", toId: "p3" }],
				0,
				"Part 2",
			),
			segment(
				"p3",
				{ anidb: "d3", anilist: "al" },
				[{ kind: "prequel", toId: "p2" }],
				1,
				"Part 3",
			),
		]);
		const clients = clientsFrom({
			anidb: {
				d2: catalogue({ instalmentCount: 12, title: "Part 2" }),
				d3: catalogue({ instalmentCount: 14, title: "Part 3" }),
			},
			anilist: {
				al: catalogue({ instalmentCount: 26, title: "Wholly Different Name" }),
			},
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.conflicts).toStrictEqual([]);
		expect(
			result.titleAssertions.every((plan) => plan.confidence === "high"),
		).toBe(true);
		expect(result.titleAssertions).toHaveLength(2);
	});

	it("does not bridge a repeated id across a segment that lacks it", async () => {
		const chain = chainOf([
			segment("a", { anidb: "d0", anilist: "al" }, [], 0),
			segment("b", { anidb: "d1" }, [], 1),
			segment("c", { anidb: "d2", anilist: "al" }, [], 2),
		]);
		const clients = clientsFrom({
			anidb: {
				d0: catalogue({ instalmentCount: 12, title: "A" }),
				d1: catalogue({ instalmentCount: 12, title: "B" }),
				d2: catalogue({ instalmentCount: 14, title: "C" }),
			},
			anilist: {
				al: catalogue({
					instalmentCount: 26,
					releaseDate: "2022-01-07",
					title: "A",
				}),
			},
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		// Two independent runs, each verified against the whole 26-ep target on its
		// own count — 12 and 14 both miss 26, so neither combines into a split.
		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.conflicts.map((conflict) => conflict.reason)).toStrictEqual([
			"count-mismatch",
			"count-mismatch",
		]);
	});

	it("keeps the ids as candidates when there is no native count to split on", async () => {
		const chain = chainOf([
			segment("x", { anidb: "dx", anilist: "alx" }, [], 0),
		]);
		const clients = clientsFrom({
			anidb: { dx: catalogue({ title: "X" }) },
			anilist: { alx: catalogue({ instalmentCount: 12, title: "X" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.candidates).toStrictEqual([
			{ segmentOrdinal: 0, service: "anilist", serviceId: "alx" },
		]);
	});

	it("joins a mainline film by relation only", async () => {
		const film: ChainSegment = {
			entry: {
				externalIds: { anilist: "al", tmdb: "42" },
				id: "film",
				relations: [{ kind: "prequel", toId: "series" }],
				title: "Code White",
				type: "movie",
			},
			externalIds: { anilist: "al", tmdb: "42" },
			nativeAnidbId: undefined,
			ordinal: 1,
		};
		const chain = chainOf([
			segment(
				"series",
				{ anidb: "1", anilist: "al" },
				[{ kind: "sequel", toId: "film" }],
				0,
				"Spy Family",
			),
			film,
		]);
		const clients = clientsFrom({
			anidb: { 1: catalogue({ instalmentCount: 12, title: "Spy Family" }) },
			anilist: { al: catalogue({ instalmentCount: 12, title: "Spy Family" }) },
			tmdb: { 42: catalogue({ instalmentCount: 1, title: "Code White" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.conflicts).toStrictEqual([]);
		expect(result.relationAssertions).toStrictEqual([
			{
				confidence: "high",
				flagged: false,
				from: { service: "anidb", serviceId: "1" },
				to: { service: "tmdb", serviceId: "42" },
			},
		]);
		expect(result.titleAssertions.map((plan) => plan.anchor)).toStrictEqual([
			{ service: "anidb", serviceId: "1" },
		]);
		expect(
			result.titleAssertions.every((plan) => plan.target.serviceId === "al"),
		).toBe(true);
	});
});
