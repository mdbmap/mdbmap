import { describe, expect, it } from "vitest";

import { workDocumentHead, workMatchHead } from "./work-head";

const APP_DESCRIPTION =
	"A personal tracker for television, film and anime, built on a cross-service metadata matcher.";

const work = {
	header: {
		synopsis: "A spy builds a fake family for a mission.",
		title: "Spy × Family",
	},
};

describe("workDocumentHead", () => {
	it("titles a loaded work with the app name", () => {
		expect(workDocumentHead(work)).toEqual({
			description: "A spy builds a fake family for a mission.",
			title: "Spy × Family · mdbmap",
		});
	});

	it("falls back to the app description when the synopsis is empty", () => {
		expect(
			workDocumentHead({
				header: { synopsis: "   ", title: "Spy × Family" },
			}).description,
		).toBe(APP_DESCRIPTION);
	});

	it("truncates a long synopsis to 160 characters", () => {
		const synopsis = "x".repeat(200);
		expect(
			workDocumentHead({ header: { synopsis, title: "Long" } }).description,
		).toBe("x".repeat(160));
	});

	it("titles a missing work", () => {
		expect(workDocumentHead(undefined)).toEqual({
			description: APP_DESCRIPTION,
			title: "Work not found · mdbmap",
		});
	});
});

describe("workMatchHead", () => {
	it("overrides title and description from loader data", () => {
		expect(workMatchHead(work, "success")).toEqual({
			meta: [
				{ title: "Spy × Family · mdbmap" },
				{
					content: "A spy builds a fake family for a mission.",
					name: "description",
				},
			],
		});
	});

	it("uses the not-found title when the match is not found", () => {
		expect(workMatchHead(undefined, "notFound")).toEqual({
			meta: [
				{ title: "Work not found · mdbmap" },
				{ content: APP_DESCRIPTION, name: "description" },
			],
		});
	});

	it("leaves head empty while the work is still loading", () => {
		expect(workMatchHead(undefined, "pending")).toEqual({});
	});
});
