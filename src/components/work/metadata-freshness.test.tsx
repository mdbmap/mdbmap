import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MetadataFreshness } from "./metadata-freshness";

const renderFreshness = (
	lastUpdatedAt: string | undefined,
	userRefreshAvailableAt: string | undefined,
) =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<MetadataFreshness
				continuityId="continuity:1"
				lastUpdatedAt={lastUpdatedAt}
				userRefreshAvailableAt={userRefreshAvailableAt}
			/>
		</QueryClientProvider>,
	);

describe("MetadataFreshness", () => {
	it("shows last updated time and a refresh control", () => {
		const html = renderFreshness("2026-09-05T11:00:00.000Z", undefined);
		expect(html).toContain("Updated");
		expect(html).toContain("Refresh");
		expect(html).toContain("Refresh catalogue metadata");
	});

	it("disables refresh while the per-entry cooldown is active", () => {
		const html = renderFreshness(
			"2026-09-05T11:00:00.000Z",
			"2099-01-01T00:00:00.000Z",
		);
		expect(html).toContain("Refresh cooling down");
		expect(html).toContain("disabled");
	});
});
