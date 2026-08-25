import { describe, expect, it } from "vitest";

import type { SimklEntry, SimklExternalIds, SimklRelation, SimklService } from "./simkl.ts";
import { simklServices } from "./simkl.ts";
import type { ChainSegment, ContinuityChain } from "./walk.ts";
import type { CatalogueTitle, VerificationClients } from "./verify.ts";
import { verifyChain } from "./verify.ts";

const segment = (
	id: string,
	externalIds: SimklExternalIds,
	relations: readonly SimklRelation[],
	ordinal: number,
): ChainSegment => {
	const entry: SimklEntry = { externalIds, id, relations, title: id, type: "anime" };
	return { entry, externalIds, nativeAnidbId: externalIds.anidb, ordinal };
};

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

const title = (fields: Partial<CatalogueTitle>): CatalogueTitle => ({
	format: undefined,
	instalmentCount: undefined,
	releaseDate: undefined,
	title: "",
	...fields,
});

describe("simkl verification", () => {
	it("splits a combined target across the segments it covers at high confidence", async () => {
		const chain = chainOf([
			segment("so2", { anidb: "d2", anilist: "al" }, [{ kind: "sequel", toId: "so3" }], 0),
			segment("so3", { anidb: "d3", anilist: "al" }, [{ kind: "prequel", toId: "so2" }], 1),
		]);
		const clients = clientsFrom({
			anidb: {
				d2: title({ instalmentCount: 12, releaseDate: "2022-01-07", title: "Stone Ocean Part 2" }),
				d3: title({ instalmentCount: 14, releaseDate: "2022-08-01", title: "Stone Ocean Part 3" }),
			},
			anilist: {
				al: title({ instalmentCount: 26, releaseDate: "2022-01-07", title: "Stone Ocean Part 2" }),
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
		expect(result.titleAssertions.every((plan) => plan.target.serviceId === "al")).toBe(true);
	});

	it("publishes a one-sided mainline edge as low and flagged", async () => {
		const chain = chainOf([
			segment("a", { anidb: "1" }, [{ kind: "sequel", toId: "b" }], 0),
			segment("b", { anidb: "2" }, [], 1),
		]);
		const clients = clientsFrom({
			anidb: { 1: title({ title: "A" }), 2: title({ title: "B" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.relationAssertions).toHaveLength(1);
		expect(result.relationAssertions[0]).toMatchObject({ confidence: "low", flagged: true });
	});

	it("keeps a two-sided mainline edge high and unflagged", async () => {
		const chain = chainOf([
			segment("a", { anidb: "1" }, [{ kind: "sequel", toId: "b" }], 0),
			segment("b", { anidb: "2" }, [{ kind: "prequel", toId: "a" }], 1),
		]);
		const clients = clientsFrom({
			anidb: { 1: title({ title: "A" }), 2: title({ title: "B" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.relationAssertions[0]).toMatchObject({ confidence: "high", flagged: false });
	});

	it("treats a failed date check as a conflict, not a low-confidence publish", async () => {
		const chain = chainOf([segment("x", { anidb: "dx", anilist: "alx" }, [], 0)]);
		const clients = clientsFrom({
			anidb: { dx: title({ instalmentCount: 12, releaseDate: "2020-01-01", title: "X" }) },
			anilist: { alx: title({ instalmentCount: 12, releaseDate: "2023-06-01", title: "X" }) },
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
		const chain = chainOf([segment("x", { anidb: "dx", anilist: "alx" }, [], 0)]);
		const clients = clientsFrom({
			anidb: { dx: title({ instalmentCount: 12, title: "X" }) },
			anilist: { alx: title({ instalmentCount: 20, title: "X" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]?.reason).toBe("count-mismatch");
	});

	it("publishes low and flags when the count fits but nothing corroborates", async () => {
		const chain = chainOf([segment("x", { anidb: "dx", anilist: "alx" }, [], 0)]);
		const clients = clientsFrom({
			anidb: { dx: title({ instalmentCount: 12, title: "Blue Lock" }) },
			anilist: { alx: title({ instalmentCount: 12, title: "Something Unrelated" }) },
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

	it("leaves an unconfigured target id as candidate evidence", async () => {
		const chain = chainOf([segment("x", { anidb: "dx", mal: "m1" }, [], 0)]);
		const clients = clientsFrom({ anidb: { dx: title({ title: "X" }) } });

		const result = await verifyChain(chain, { clients, target: "mal" });

		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.candidates).toStrictEqual([
			{ segmentOrdinal: 0, service: "mal", serviceId: "m1" },
		]);
	});

	it("leaves a target id the catalogue does not recognise as a candidate", async () => {
		const chain = chainOf([segment("x", { anidb: "dx", anilist: "gone" }, [], 0)]);
		const clients = clientsFrom({
			anidb: { dx: title({ instalmentCount: 12, title: "X" }) },
			anilist: {},
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.candidates).toStrictEqual([
			{ segmentOrdinal: 0, service: "anilist", serviceId: "gone" },
		]);
	});

	it("keeps the ids as candidates when there is no native count to split on", async () => {
		const chain = chainOf([segment("x", { anidb: "dx", anilist: "alx" }, [], 0)]);
		const clients = clientsFrom({
			anidb: { dx: title({ title: "X" }) },
			anilist: { alx: title({ instalmentCount: 12, title: "X" }) },
		});

		const result = await verifyChain(chain, { clients, target: "anilist" });

		expect(result.titleAssertions).toStrictEqual([]);
		expect(result.candidates).toStrictEqual([
			{ segmentOrdinal: 0, service: "anilist", serviceId: "alx" },
		]);
	});
});
