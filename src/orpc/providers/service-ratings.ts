import type { RateableUnit, ServiceRating } from "@/orpc/schema";

import type { ServiceRatingsProvider } from "./types.ts";

// STUB — replaced by #7. Real impl reads mapped member ids and each service's
// native rating; the list is never merged into a single number.
const partRatings: readonly ServiceRating[] = [
	{ scale: 10, score: 8.6, service: "mal", votes: 412_000 },
	{ scale: 100, score: 85, service: "anilist", votes: 220_000 },
	{ scale: 10, score: 8.1, service: "anidb", votes: 9800 },
];

const serviceRatingsProvider: ServiceRatingsProvider = {
	ratingsFor: (unit: RateableUnit) =>
		unit.kind === "part" ? partRatings : [],
};

export { serviceRatingsProvider };
