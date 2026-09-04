import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { progressMutationScope } from "./progress-mutation-scope.ts";

const hold = () => Promise.withResolvers<true>();

describe("progress mutation scope", () => {
	it("finishes the latest write after a delayed earlier write", async () => {
		const client = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		const held = hold();
		const committed: string[] = [];
		const options = {
			mutationFn: async (locator: string) => {
				if (locator === "first") {
					await held.promise;
				}
				committed.push(locator);
				return locator;
			},
			scope: progressMutationScope("continuity:1"),
		};
		const earlier = new MutationObserver<string, Error, string>(
			client,
			options,
		);
		const later = new MutationObserver<string, Error, string>(client, options);
		const first = earlier.mutate("first");
		const second = later.mutate("second");
		held.resolve(true);
		await Promise.all([first, second]);
		expect(committed).toEqual(["first", "second"]);
	});
});
