import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AiringDay } from "@/orpc/airing";

import { CalendarPage } from "./calendar-page";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
	}: {
		children: ReactNode;
		params?: { continuityId: number | string };
		to: string;
	}) => (
		<a href={to.replace("$continuityId", String(params?.continuityId ?? ""))}>
			{children}
		</a>
	),
}));

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
}));

const NO_DAYS: AiringDay[] = [];

const days: AiringDay[] = [
	{
		date: "2026-04-09",
		episodes: [
			{
				airDate: "2026-04-09",
				continuityId: "continuity:12",
				number: 1,
				partLabel: "Cour 1",
				title: "Operation Strix",
				workTitle: "Spy × Family",
			},
		],
	},
];

describe("CalendarPage rows", () => {
	const html = renderToStaticMarkup(<CalendarPage days={days} />);

	it("lists the air date and instalment line", () => {
		expect(html).toContain("2026-04-09");
		expect(html).toContain("Spy × Family · Cour 1 · 01 · Operation Strix");
		expect(html).toContain('href="/work/12"');
	});

	it("marks the calendar nav as the current page", () => {
		expect(html).toContain('aria-current="page"');
		expect(html).toContain("Calendar");
		expect(html).toContain('href="/library"');
	});
});

describe("CalendarPage empty state", () => {
	const html = renderToStaticMarkup(<CalendarPage days={NO_DAYS} />);

	it("explains when nothing is airing", () => {
		expect(html).toContain("Nothing airing soon.");
		expect(html).not.toContain("/work/");
	});
});
