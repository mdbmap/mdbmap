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
		params: { continuityId: number | string };
		to: string;
	}) => (
		<a href={to.replace("$continuityId", String(params.continuityId))}>
			{children}
		</a>
	),
}));

const noCast: Credit[] = [];
const noStaff: Credit[] = [];
const noStudios: string[] = [];
const noSimilar: Similar[] = [];

const cast: Credit[] = [
	{ name: "Takuya Eguchi", ref: undefined, role: "Loid Forger" },
	{
		name: "Atsumi Tanezaki",
		ref: "https://img.test/anya.jpg",
		role: "Anya Forger",
	},
];

const staff: Credit[] = [
	{ name: "Kazuhiro Furuhashi", ref: undefined, role: "Director" },
];

const studios = ["Wit Studio", "CloverWorks"];

const ifYouLiked: Similar[] = [
	{ continuityId: "12", coverRef: undefined, title: "Frieren" },
];

const taggedLiked: Similar[] = [
	{ continuityId: "continuity:12", coverRef: undefined, title: "Frieren" },
];

const nonWorkLiked: Similar[] = [
	{ continuityId: "tmdb:tv:77", coverRef: undefined, title: "Similar Show" },
];

const renderPage = () =>
	renderToStaticMarkup(
		<Metadata
			cast={cast}
			ifYouLiked={ifYouLiked}
			staff={staff}
			studios={studios}
		/>,
	);

const renderLiked = (liked: Similar[]) =>
	renderToStaticMarkup(
		<Metadata
			cast={noCast}
			ifYouLiked={liked}
			staff={noStaff}
			studios={noStudios}
		/>,
	);

describe("Metadata", () => {
	it("renders each section's rows from work.get data", () => {
		const html = renderPage();
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
		const html = renderPage();
		expect(html).toContain("poster-340");
		expect(html).toContain("https://img.test/anya.jpg");
	});

	it("links a similar item to its work page", () => {
		const html = renderPage();
		expect(html).toContain('href="/work/12"');
	});

	it("links a tagged continuity key to the numeric path", () => {
		expect(renderLiked(taggedLiked)).toContain('href="/work/12"');
	});

	it("does not link a similar item that is not a work", () => {
		const html = renderLiked(nonWorkLiked);
		expect(html).toContain("Similar Show");
		expect(html).not.toContain("href=");
	});

	it("omits a section when its data is empty", () => {
		expect(renderLiked(noSimilar)).toBe("");
	});
});
