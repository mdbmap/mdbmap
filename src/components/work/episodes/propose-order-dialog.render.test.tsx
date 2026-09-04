import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProposeOrderDialog } from "./propose-order-dialog";

const noop = () => {
	/* empty */
};

vi.mock("@/orpc/client", () => ({
	orpc: {
		orderProposals: {
			create: {
				mutationOptions: () => ({}),
			},
		},
	},
}));

const segments = [
	{ id: 1, label: "Cour 1" },
	{ id: 2, label: "Film" },
] as const;

describe("ProposeOrderDialog", () => {
	it("renders the editor with segment labels", () => {
		const html = renderToStaticMarkup(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(ProposeOrderDialog, {
					continuityId: "continuity:12",
					isOpen: true,
					onOpenChange: noop,
					segments,
				}),
			),
		);
		expect(html).toContain("Propose presentation order");
		expect(html).toContain("Cour 1");
		expect(html).toContain("Film");
		expect(html).toContain("Submit proposal");
		expect(html).toContain("Up");
	});
});
