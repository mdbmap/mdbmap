import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProvidersPanel } from "./providers-panel";

const listKey = ["providers", "list"] as const;
const timingKey = ["providers", "timing"] as const;

const createSuccessHandlers: (() => unknown)[] = [];

const noopMutation = {
	mutationOptions: (options?: { onSuccess?: () => unknown }) => ({
		mutationFn: async () => {
			/* no-op */
		},
		...options,
	}),
};

const sampleProvider = {
	config: { kind: "openai" as const, model: "gpt-5" },
	id: "p-1",
	kind: "openai" as const,
	label: "OpenAI",
};

vi.mock("@/orpc/client", () => ({
	orpc: {
		providers: {
			create: {
				mutationOptions: (options?: { onSuccess?: () => unknown }) => {
					if (options?.onSuccess !== undefined) {
						createSuccessHandlers.push(options.onSuccess);
					}
					return {
						mutationFn: async () => {
							/* no-op */
						},
						...options,
					};
				},
			},
			getTiming: {
				queryKey: () => timingKey,
				queryOptions: () => ({
					queryFn: async () => {
						await Promise.resolve();
						return "after-residue" as const;
					},
					queryKey: timingKey,
				}),
			},
			list: {
				queryKey: () => listKey,
				queryOptions: () => ({
					queryFn: async () => {
						await Promise.resolve();
						return [sampleProvider];
					},
					queryKey: listKey,
				}),
			},
			remove: noopMutation,
			setTiming: noopMutation,
			update: noopMutation,
		},
	},
}));

const wrap = (node: ReactNode) => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(listKey, [sampleProvider]);
	client.setQueryData(timingKey, "after-residue");
	return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
};

describe("ProvidersPanel", () => {
	it("renders timing policy and provider list without api keys", () => {
		createSuccessHandlers.length = 0;
		const html = renderToStaticMarkup(wrap(<ProvidersPanel />));
		expect(html).toContain("Providers");
		expect(html).toContain("Research timing");
		expect(html).toContain("OpenAI");
		expect(html).toContain("gpt-5");
		expect(html).not.toContain("sk-");
		expect(html).toContain("never shown again");
		expect(html).toContain('type="password"');
		expect(html).toMatch(/value=""/u);
	});

	it("wires create onSuccess so the form remounts after save", () => {
		createSuccessHandlers.length = 0;
		renderToStaticMarkup(wrap(<ProvidersPanel />));
		expect(createSuccessHandlers).toHaveLength(1);
	});
});
