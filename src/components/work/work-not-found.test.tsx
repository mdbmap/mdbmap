import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkNotFound } from "./work-not-found";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		"data-cta": dataCta,
	}: {
		children: ReactNode;
		"data-cta"?: boolean | string;
		to: string;
	}) => (
		<a data-cta={dataCta === undefined ? undefined : ""} href={to}>
			{children}
		</a>
	),
}));

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
}));

describe("WorkNotFound", () => {
	const html = renderToStaticMarkup(<WorkNotFound />);

	it("explains the missing work and links to search", () => {
		expect(html).toContain("mdbmap");
		expect(html).toContain("This work is not in the map yet.");
		expect(html).toContain("Search catalogues");
		expect(html).toContain('href="/search"');
		expect(html).toContain("data-cta");
	});
});
