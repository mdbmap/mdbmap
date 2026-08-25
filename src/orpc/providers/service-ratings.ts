import type { MemberTitles } from "@/engine";
import type { ServiceRating } from "@/orpc/schema";

import type { ServiceRatingsProvider } from "./types.ts";

type RatedService = "anidb" | "anilist" | "mal" | "tmdb";

// Each service keeps its own published score in its own denominator; the list
// is never rescaled or merged into a single number (ADR-0007).
const scaleFor: Record<RatedService, number> = {
	anidb: 10,
	anilist: 100,
	mal: 10,
	tmdb: 10,
};

const serviceOrder: readonly RatedService[] = ["tmdb", "mal", "anilist", "anidb"];

// Fixture published ratings keyed by the exact member title id the engine
// resolves, in each service's native scale. DEFERRED: the live per-service
// fetch is engine-blocked (#4 member ids, #7) — once the mapping engine lands,
// real ids and cached upstream reads replace these Spy × Family stand-ins.
const fixtures: Record<
	RatedService,
	Record<string, { score: number; votes: number }>
> = {
	anidb: {
		"16947": { score: 8.14, votes: 3183 },
		"17061": { score: 7.98, votes: 2104 },
		"17784": { score: 7.9, votes: 1476 },
	},
	anilist: {
		"140960": { score: 86, votes: 214_500 },
		"142838": { score: 82, votes: 138_900 },
		"158927": { score: 82, votes: 96_300 },
	},
	mal: {
		"50265": { score: 8.55, votes: 1_182_000 },
		"50602": { score: 8.26, votes: 621_400 },
		"53887": { score: 8.18, votes: 432_100 },
	},
	tmdb: {
		"120089": { score: 8.4, votes: 1287 },
	},
};

const composeFrom = (members: MemberTitles): ServiceRating[] => {
	const ratings: ServiceRating[] = [];
	for (const service of serviceOrder) {
		const id = members[service];
		if (id === undefined) {
			continue;
		}
		const fixture = fixtures[service][id];
		if (fixture === undefined) {
			continue;
		}
		ratings.push({
			scale: scaleFor[service],
			score: fixture.score,
			service,
			votes: fixture.votes,
		});
	}
	return ratings;
};

const serviceRatingsProvider: ServiceRatingsProvider = {
	ratingsFor: async (unit, members) => {
		if (unit.kind !== "part") {
			return [];
		}
		// Awaits a resolved promise as the stand-in for the deferred live fetch
		// (engine-blocked); real per-service reads slot in here unchanged.
		const ratings = await Promise.resolve(composeFrom(members));
		return ratings;
	},
};

export { serviceRatingsProvider };
