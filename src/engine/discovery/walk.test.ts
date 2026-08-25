import { describe, expect, it } from "vitest";

import type { SimklEntry } from "./simkl.ts";
import { anime } from "./test-fixtures.ts";
import { walkContinuity } from "./walk.ts";

const fetcherFor = (entries: readonly SimklEntry[]) => {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	return async (simklId: string) => {
		await Promise.resolve();
		return byId.get(simklId);
	};
};

describe("continuity walk", () => {
	it("walks prequels back and sequels forward, rebasing on the earliest entry", async () => {
		const first = anime("a", { anidb: "1" }, [{ kind: "sequel", toId: "b" }]);
		const middle = anime("b", { anidb: "2" }, [
			{ kind: "prequel", toId: "a" },
			{ kind: "sequel", toId: "c" },
		]);
		const last = anime("c", { anidb: "3" }, [{ kind: "prequel", toId: "b" }]);

		const result = await walkContinuity(middle, {
			fetchEntry: fetcherFor([first, middle, last]),
		});

		if (result.kind !== "chain") {
			throw new Error(`expected a chain, got ${result.kind}`);
		}
		expect(result.segments.map((segment) => segment.entry.id)).toStrictEqual([
			"a",
			"b",
			"c",
		]);
		expect(result.segments.map((segment) => segment.ordinal)).toStrictEqual([0, 1, 2]);
		expect(result.rebase.entry.id).toBe("a");
		expect(result.rebase.ordinal).toBe(0);
		expect(result.segments.map((segment) => segment.nativeAnidbId)).toStrictEqual([
			"1",
			"2",
			"3",
		]);
	});

	it("refuses an ambiguous same-direction branch", async () => {
		const branching = anime("b", {}, [
			{ kind: "prequel", toId: "a" },
			{ kind: "sequel", toId: "c" },
			{ kind: "sequel", toId: "c2" },
		]);

		const result = await walkContinuity(branching, { fetchEntry: fetcherFor([]) });

		expect(result.kind).toBe("continuity-conflict");
		if (result.kind !== "continuity-conflict") {
			throw new Error("unreachable");
		}
		expect(result.reason).toBe("ambiguous-branch");
		expect(result.entryId).toBe("b");
		expect(result.competing).toHaveLength(2);
	});

	it("refuses a cycle-closing link", async () => {
		const first = anime("a", {}, [{ kind: "sequel", toId: "b" }]);
		const second = anime("b", {}, [{ kind: "sequel", toId: "a" }]);

		const result = await walkContinuity(first, {
			fetchEntry: fetcherFor([first, second]),
		});

		expect(result.kind).toBe("continuity-conflict");
		if (result.kind !== "continuity-conflict") {
			throw new Error("unreachable");
		}
		expect(result.reason).toBe("cycle-closing-link");
		expect(result.entryId).toBe("b");
	});

	it("refuses a candidate whose record is not anime-shaped", async () => {
		const first = anime("a", {}, [{ kind: "sequel", toId: "film" }]);
		const film: SimklEntry = {
			externalIds: { tmdb: "42" },
			id: "film",
			relations: [],
			title: "A Film",
			type: "movie",
		};

		const result = await walkContinuity(first, {
			fetchEntry: fetcherFor([first, film]),
		});

		expect(result.kind).toBe("continuity-conflict");
		if (result.kind !== "continuity-conflict") {
			throw new Error("unreachable");
		}
		expect(result.reason).toBe("non-anime-candidate");
		expect(result.entryId).toBe("film");
	});
});
