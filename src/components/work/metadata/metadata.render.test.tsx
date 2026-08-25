import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Credit, Similar } from "@/orpc/schema";

import { Metadata } from "./metadata";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
	}: {
		children: ReactNode;
		params: { continuityId: string };
		to: string;
	}) => <a href={to.replace("$continuityId", params.continuityId)}>{children}</a>,
}));

const noCast: Credit[] = [];
const noStaff: Credit[] = [];
const noStudios: string[] = [];
const noSimilar: Similar[] = [];

const cast: Credit[] = [
	{ name: "Takuya Eguchi", ref: undefined, role: "Loid Forger" },
	{ name: "Atsumi Tanezaki", ref: "https://img.test/anya.jpg", role: "Anya Forger" },
];

const staff: Credit[] = [{ name: "Kazuhiro Furuhashi", ref: undefined, role: "Director" }];

const studios = ["Wit Studio", "CloverWorks"];

const ifYouLiked: Similar[] = [
	{ continuityId: "continuity:frieren", coverRef: undefined, title: "Frieren" },
];

const renderMetadata = () =>
	renderToStaticMarkup(
		<Metadata cast={cast} ifYouLiked={ifYouLiked} staff={staff} studios={studios} />,
	);

describe("Metadata", () => {
	it("renders each section's rows from work.get data", () => {
		const html = renderMetadata();
		expect(html).toContain("Cast");
		expect(html).toContain("Loid Forger");
		expect(html).toContain("Takuya Eguchi");
		expect(html).toContain("Staff");
		expect(html).toContain("Kazuhiro Furuhashi");
		expect(html).toContain("Studios");
		expect(html).toContain("Wit Studio");
		expect(html).toContain("If you liked this");
		expect(html).toContain("Frieren");
	});

	it("shows the ruled placeholder for an item without an image and an img when present", () => {
		const html = renderMetadata();
		expect(html).toContain("poster-340");
		expect(html).toContain("https://img.test/anya.jpg");
	});

	it("links a similar item to its work page", () => {
		const html = renderMetadata();
		expect(html).toContain('href="/work/continuity:frieren"');
	});

	it("omits a section when its data is empty", () => {
		const html = renderToStaticMarkup(
			<Metadata cast={noCast} ifYouLiked={noSimilar} staff={noStaff} studios={noStudios} />,
		);
		expect(html).toBe("");
	});
});
