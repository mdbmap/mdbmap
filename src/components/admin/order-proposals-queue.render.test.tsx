import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProposalView } from "@/orpc/router/order-proposals";

import { OrderProposalsQueue } from "./order-proposals-queue";

const listKey = ["orderProposals", "listPending"] as const;

const pending: ProposalView = {
	authorUserId: "user-9",
	continuityId: 42,
	createdAt: new Date("2026-01-02T00:00:00.000Z"),
	id: 11,
	items: [
		{ position: 0, segmentId: 1 },
		{ position: 1, segmentId: 2 },
	],
	name: "Theatrical insert",
	rationale: "Place the film after cours one",
	status: "pending",
	updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

vi.mock("@/orpc/client", () => ({
	orpc: {
		orderProposals: {
			accept: {
				mutationOptions: (options?: { onSuccess?: () => unknown }) => ({
					mutationFn: async () => {
						/* no-op */
					},
					...options,
				}),
			},
			listPending: {
				queryKey: () => listKey,
				queryOptions: () => ({
					queryFn: async () => {
						await Promise.resolve();
						return [pending];
					},
					queryKey: listKey,
				}),
			},
			reject: {
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

const wrap = (node: ReactNode) => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(listKey, [pending]);
	return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
};

describe("OrderProposalsQueue", () => {
	it("renders a pending proposal row with accept control", () => {
		const html = renderToStaticMarkup(wrap(<OrderProposalsQueue />));
		expect(html).toContain("Order proposal queue");
		expect(html).toContain("Theatrical insert");
		expect(html).toContain("continuity 42");
		expect(html).toContain("author user-9");
		expect(html).toContain("2 segments");
		expect(html).toContain("Place the film after cours one");
		expect(html).toContain("Accept");
		expect(html).toContain("Reject");
	});
});
