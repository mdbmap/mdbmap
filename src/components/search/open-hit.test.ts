import { describe, expect, it } from "vitest";

import { actionForOpenResult, openInputFor } from "./open-hit";

describe("openInputFor", () => {
	it("maps film catalogue hits to the movie ingest profile", () => {
		expect(
			openInputFor({ id: "603", namespace: "movie", service: "tmdb" }, "film"),
		).toEqual({
			identity: {
				kind: "title",
				title: { id: "603", namespace: "movie", service: "tmdb" },
			},
			profile: "movie",
		});
	});

	it("maps tv and anime hits to series and anime profiles", () => {
		expect(
			openInputFor({ id: "1396", namespace: "tv", service: "tmdb" }, "tv"),
		).toMatchObject({ profile: "series" });
		expect(
			openInputFor({ id: "21", service: "anilist" }, "anime"),
		).toMatchObject({ profile: "anime" });
	});
});

describe("actionForOpenResult", () => {
	it("navigates on ready and pending-with-continuity", () => {
		expect(
			actionForOpenResult({ continuityId: "continuity:12", kind: "ready" }),
		).toEqual({ continuityId: "continuity:12", kind: "navigate" });
		expect(
			actionForOpenResult({
				continuityId: "continuity:12",
				kind: "pending",
				retryAfterSeconds: 5,
				statusUrl: "/api/engine/status/pending:a",
			}),
		).toEqual({ continuityId: "continuity:12", kind: "navigate" });
	});

	it("surfaces clear errors for unknown and conflict", () => {
		expect(actionForOpenResult({ kind: "unknown" })).toMatchObject({
			kind: "error",
		});
		expect(
			actionForOpenResult({ kind: "conflict", review: "review:1" }),
		).toMatchObject({ kind: "error" });
	});
});
