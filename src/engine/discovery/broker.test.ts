import { describe, expect, it } from "vitest";

import { discover } from "./broker.ts";
import type { SimklClient, SimklEntry, SimklService } from "./simkl.ts";
import { anime } from "./test-fixtures.ts";

const first = anime("a", { anidb: "1", mal: "100" }, [{ kind: "sequel", toId: "b" }]);
const middle = anime("b", { anidb: "2", mal: "200", tmdb: "999" }, [
	{ kind: "prequel", toId: "a" },
	{ kind: "sequel", toId: "c" },
]);
const last = anime("c", { anidb: "3", mal: "300" }, [{ kind: "prequel", toId: "b" }]);

const clientOver = (
	entries: readonly SimklEntry[],
	overrides: Partial<SimklClient> = {},
): SimklClient => {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const byExternal = (service: SimklService, serviceId: string) =>
		entries.find((entry) => entry.externalIds[service] === serviceId);
	return {
		fetchEntry: async (simklId) => {
			await Promise.resolve();
			return byId.get(simklId);
		},
		findByExternalId: async (service, serviceId) => {
			await Promise.resolve();
			return byExternal(service, serviceId);
		},
		...overrides,
	};
};

const tmdbToMal = {
	cursor: { id: "999", service: "tmdb" },
	target: "mal",
};

describe("discovery broker", () => {
	it("walks the chain from a supported id and rebases on the earliest entry", async () => {
		const simkl = clientOver([first, middle, last]);

		const outcome = await discover(tmdbToMal, { simkl });

		if (outcome.kind !== "brokered") {
			throw new Error(`expected a brokered chain, got ${outcome.kind}`);
		}
		expect(outcome.chain.rebase.entry.id).toBe("a");
		expect(outcome.chain.segments.map((segment) => segment.entry.id)).toStrictEqual([
			"a",
			"b",
			"c",
		]);
		// The requesting service/id stays the cursor even though the chain rebased.
		expect(outcome.cursor).toStrictEqual({ id: "999", service: "tmdb" });
		// External-id fan-out: the MAL candidates are offered in chain order, ahead
		// of any title search, and stay candidates the target must verify.
		expect(outcome.candidates).toStrictEqual(["100", "200", "300"]);
	});

	it("re-fetches the full entry before walking so a relationless search hit still expands", async () => {
		// The real findByExternalId answers /search/id: relations normalise to [].
		const searchHit: SimklEntry = { ...middle, relations: [] };
		const simkl = clientOver([first, middle, last], {
			findByExternalId: async (service, serviceId) => {
				await Promise.resolve();
				return service === "tmdb" && serviceId === "999" ? searchHit : undefined;
			},
		});

		const outcome = await discover(tmdbToMal, { simkl });

		if (outcome.kind !== "brokered") {
			throw new Error(`expected a brokered chain, got ${outcome.kind}`);
		}
		// Built from the re-fetched relations, not the empty search hit.
		expect(outcome.chain.segments.map((segment) => segment.entry.id)).toStrictEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("falls through to direct discovery without rebasing when SIMKL fails", async () => {
		const simkl = clientOver([first, middle, last], {
			findByExternalId: () => {
				throw new Error("simkl: 503 upstream");
			},
		});

		const outcome = await discover(tmdbToMal, { simkl });

		expect(outcome).toStrictEqual({
			cursor: { id: "999", service: "tmdb" },
			kind: "fallthrough",
			reason: "request-failed",
			target: "mal",
		});
	});

	it("queues a continuity-conflict when a branch is ambiguous", async () => {
		const branching = anime("b", { tmdb: "999" }, [
			{ kind: "prequel", toId: "a" },
			{ kind: "sequel", toId: "c" },
			{ kind: "sequel", toId: "c2" },
		]);
		const simkl = clientOver([first, branching, last]);

		const outcome = await discover(tmdbToMal, { simkl });

		expect(outcome.kind).toBe("continuity-conflict");
		if (outcome.kind !== "continuity-conflict") {
			throw new Error("unreachable");
		}
		expect(outcome.reason).toBe("ambiguous-branch");
		expect(outcome.entryId).toBe("b");
		expect(outcome.competing).toHaveLength(2);
	});

	it("queues a continuity-conflict when the start entry is not anime-shaped", async () => {
		const film: SimklEntry = {
			externalIds: { tmdb: "999" },
			id: "film",
			relations: [{ kind: "sequel", toId: "a" }],
			title: "A Film",
			type: "movie",
		};
		const simkl = clientOver([film, first]);

		const outcome = await discover(tmdbToMal, { simkl });

		expect(outcome.kind).toBe("continuity-conflict");
		if (outcome.kind !== "continuity-conflict") {
			throw new Error("unreachable");
		}
		expect(outcome.reason).toBe("non-anime-candidate");
		expect(outcome.entryId).toBe("film");
	});

	it("falls through when SIMKL has no record for the id", async () => {
		const simkl = clientOver([first, middle, last]);

		const outcome = await discover(
			{ cursor: { id: "does-not-exist", service: "tmdb" }, target: "mal" },
			{ simkl },
		);

		expect(outcome.kind).toBe("fallthrough");
		if (outcome.kind === "fallthrough") {
			expect(outcome.reason).toBe("no-record");
		}
	});

	it("falls through unconfigured when no SIMKL client is wired", async () => {
		const outcome = await discover(tmdbToMal, {});

		expect(outcome.kind).toBe("fallthrough");
		if (outcome.kind === "fallthrough") {
			expect(outcome.reason).toBe("unconfigured");
		}
	});

	it("falls through for an id SIMKL does not broker", async () => {
		const simkl = clientOver([first, middle, last]);

		const outcome = await discover(
			{ cursor: { id: "abc", service: "letterboxd" }, target: "mal" },
			{ simkl },
		);

		expect(outcome.kind).toBe("fallthrough");
		if (outcome.kind === "fallthrough") {
			expect(outcome.reason).toBe("unsupported-id");
		}
	});
});
