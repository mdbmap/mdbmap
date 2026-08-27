import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ContinuityOrdersView } from "@/orpc/router/orders";

import { OrdersPanel } from "./orders-panel";

const getKey = ["orders", "get"] as const;

const view: ContinuityOrdersView = {
	continuityId: 7,
	releaseSegmentIds: [1, 2],
	segments: [
		{
			id: 1,
			kind: "episodic",
			releaseOrdinal: 0,
			service: "tmdb",
			serviceId: "tv:1",
			titleId: 10,
		},
		{
			id: 2,
			kind: "atomic",
			releaseOrdinal: 1,
			service: "tmdb",
			serviceId: "movie:2",
			titleId: 11,
		},
	],
	watchSegmentIds: [2, 1],
};

vi.mock("@/orpc/client", () => ({
	orpc: {
		orders: {
			get: {
				queryKey: () => getKey,
				queryOptions: () => ({
					queryFn: async () => {
						await Promise.resolve();
						return view;
					},
					queryKey: getKey,
				}),
			},
			saveWatch: {
				mutationOptions: (options?: { onSuccess?: () => unknown }) => ({
					mutationFn: async () => {
						/* no-op */
					},
					...options,
				}),
			},
		},
	},
}));

const wrap = (node: ReactNode, data?: ContinuityOrdersView) => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	if (data !== undefined) {
		client.setQueryData(getKey, data);
	}
	return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
};

describe("OrdersPanel", () => {
	it("renders the load form before a continuity is selected", () => {
		const html = renderToStaticMarkup(wrap(<OrdersPanel />));
		expect(html).toContain("Watch order");
		expect(html).toContain("Continuity id");
		expect(html).toContain("Load");
		expect(html).not.toContain("Save watch order");
	});

	it("renders segments and save when a watch view is cached", () => {
		const html = renderToStaticMarkup(wrap(<OrdersPanel />, view));
		expect(html).toContain("episodic tmdb:tv:1");
		expect(html).toContain("atomic tmdb:movie:2");
		expect(html).toContain("Save watch order");
		expect(html).toContain("Exclude");
	});
});
