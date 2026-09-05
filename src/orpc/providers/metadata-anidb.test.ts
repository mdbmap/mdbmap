import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolveResult } from "@/engine";

import { createAnidbProvider } from "./metadata-anidb.ts";
import { createMemoryMetadataStore } from "./metadata-store.ts";
import type { MetadataStore } from "./metadata-store.ts";
import { createRateLimiter } from "./rate-limit.ts";

const COUR1_ID = "16947";
const COUR2_ID = "16948";

const resolved: ResolveResult = {
	continuityId: "continuity:1",
	mediaKind: "anime",
	segments: [
		{
			instalments: ["anidb:16947#1", "anidb:16947#2"],
			kind: "episodic",
			members: { anidb: COUR1_ID },
		},
		{
			instalments: ["anidb:16948#1"],
			kind: "episodic",
			members: { anidb: COUR2_ID },
		},
	],
};

const cour1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<anime id="16947" restricted="false">
	<type>TV Series</type>
	<startdate>2022-04-09</startdate>
	<enddate>2022-06-25</enddate>
	<titles>
		<title xml:lang="x-jat" type="main">Spy x Family</title>
		<title xml:lang="ja" type="official">SPY&#215;FAMILY</title>
		<title xml:lang="en" type="official">Spy x Family</title>
	</titles>
	<description>A spy builds a fake family &amp; hides his work.</description>
	<picture>270350.jpg</picture>
	<ratings><permanent count="1234">8.50</permanent></ratings>
	<similaranime>
		<anime id="8069" approval="50" total="60">Mob Psycho 100</anime>
	</similaranime>
	<creators>
		<name id="1" type="Direction">Kazuhiro Furuhashi</name>
		<name id="2" type="Original Work">Tatsuya Endo</name>
		<name id="3" type="Animation Work">Wit Studio</name>
		<name id="4" type="Animation Work">CloverWorks</name>
		<name id="5" type="Music">(K)NoW_NAME</name>
	</creators>
	<tags>
		<tag id="30" infobox="true" weight="400"><name>Comedy</name></tag>
		<tag id="31" infobox="true" weight="300"><name>Action</name></tag>
		<tag id="99" weight="0"><name>Internal Tag</name></tag>
	</tags>
	<characters>
		<character id="101" type="main character in">
			<name>Loid Forger</name>
			<seiyuu id="201">Takuya Eguchi</seiyuu>
		</character>
		<character id="102" type="main character in">
			<name>Anya Forger</name>
			<seiyuu id="202">Atsumi Tanezaki</seiyuu>
		</character>
		<character id="103" type="secondary cast in">
			<name>Narrator</name>
		</character>
	</characters>
	<episodes>
		<episode id="1002"><epno type="1">2</epno><airdate>2022-04-16</airdate><title xml:lang="en">Secure a Wife</title></episode>
		<episode id="1001"><epno type="1">1</epno><length>24</length><airdate>2022-04-09</airdate><title xml:lang="en">Operation Strix</title><title xml:lang="ja">ミッション1</title></episode>
		<episode id="1099"><epno type="2">1</epno><airdate>2022-04-01</airdate><title xml:lang="en">A Special</title></episode>
	</episodes>
</anime>`;

const cour2Xml = `<anime id="16948">
	<startdate>2022-10-01</startdate>
	<enddate>2022-12-24</enddate>
	<titles>
		<title xml:lang="x-jat" type="main">Spy x Family Part 2</title>
		<title xml:lang="ja" type="official">SPY&#215;FAMILY 2</title>
	</titles>
	<description>The second cour.</description>
	<picture>280000.jpg</picture>
	<episodes>
		<episode id="2001"><epno type="1">1</epno><airdate>2022-10-01</airdate><title xml:lang="en">Follow the Dog</title></episode>
	</episodes>
</anime>`;

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
};

const xmlFor = (url: string): string =>
	url.includes(`aid=${COUR2_ID}`) ? cour2Xml : cour1Xml;

const makeFetch = () =>
	vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
		await Promise.resolve();
		return new Response(xmlFor(urlOf(input)));
	});

const makeStore = (): MetadataStore => createMemoryMetadataStore();

const makeProvider = (
	fetchFn: typeof fetch,
	store: MetadataStore = makeStore(),
) =>
	createAnidbProvider({
		client: "mdbmaptest",
		clientVer: "1",
		fetchFn,
		rateLimiter: createRateLimiter({ intervalMs: 0 }),
		resolveStore: () => store,
	});

afterEach(() => {
	vi.useRealTimers();
});

describe("anidb metadata provider", () => {
	it("normalises per-cour entries into WorkMetadata aligned with the engine segments", async () => {
		const fetchFn = makeFetch();
		const now = new Date("2026-09-05T00:00:00.000Z");
		const meta = await makeProvider(fetchFn).fetchWork(resolved, { now });

		expect(meta.title).toBe("Spy x Family");
		expect(meta.nativeTitle).toBe("SPY×FAMILY");
		expect(meta.synopsis).toBe("A spy builds a fake family & hides his work.");
		expect(meta.coverRef).toBe("anidb:270350.jpg");
		expect(meta.backdropRef).toBeUndefined();
		expect(meta.span).toBe("2022");
		expect(meta.studios).toStrictEqual(["Wit Studio", "CloverWorks"]);
		expect(meta.genres).toStrictEqual(["Comedy", "Action"]);
		expect(meta.runtimeMinutes).toBe(24);
		expect(meta.productionStatus).toBe("Finished");

		expect(meta.cast).toStrictEqual([
			{ name: "Takuya Eguchi", ref: "anidb:creator:201", role: "Loid Forger" },
			{
				name: "Atsumi Tanezaki",
				ref: "anidb:creator:202",
				role: "Anya Forger",
			},
		]);
		expect(meta.staff).toStrictEqual([
			{ name: "Kazuhiro Furuhashi", ref: "anidb:creator:1", role: "Director" },
			{
				name: "Tatsuya Endo",
				ref: "anidb:creator:2",
				role: "Original Creator",
			},
			{ name: "(K)NoW_NAME", ref: "anidb:creator:5", role: "Music" },
		]);
		expect(meta.ifYouLiked).toStrictEqual([
			{
				continuityId: "anidb:8069",
				coverRef: undefined,
				title: "Mob Psycho 100",
			},
		]);

		expect(meta.segments).toHaveLength(2);
		expect(meta.segments[0]?.label).toBe("Spy x Family");
		expect(meta.segments[0]?.year).toBe(2022);
		expect(meta.segments[0]?.airedFrom).toBe("2022-04-09");
		expect(meta.segments[0]?.airedTo).toBe("2022-06-25");
		expect(meta.segments[0]?.episodes).toStrictEqual([
			{ airDate: "2022-04-09", number: 1, title: "Operation Strix" },
			{ airDate: "2022-04-16", number: 2, title: "Secure a Wife" },
		]);
		expect(meta.segments[1]?.label).toBe("Spy x Family Part 2");
		expect(meta.segments[1]?.episodes).toStrictEqual([
			{ airDate: "2022-10-01", number: 1, title: "Follow the Dog" },
		]);
	});

	it("persists one catalogue document per AniDB entry", async () => {
		const fetchFn = makeFetch();
		const store = makeStore();
		await makeProvider(fetchFn, store).fetchWork(resolved);

		expect(await store.get("anidb", COUR1_ID)).toBeDefined();
		expect(await store.get("anidb", COUR2_ID)).toBeDefined();
	});

	it("serves a snapshot hit with zero upstream subrequests", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const first = await provider.fetchWork(resolved);
		expect(fetchFn.mock.calls.length).toBe(2);

		const second = await provider.fetchWork(resolved);
		expect(fetchFn.mock.calls.length).toBe(2);
		expect(second).toStrictEqual(first);
	});

	it("spaces live requests at one per two seconds via the flood gate", async () => {
		vi.useFakeTimers();
		const times: number[] = [];
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				times.push(Date.now());
				return new Response(xmlFor(urlOf(input)));
			},
		);
		const provider = createAnidbProvider({
			client: "mdbmaptest",
			clientVer: "1",
			fetchFn,
			resolveStore: () => makeStore(),
		});

		const work = provider.fetchWork(resolved);

		await vi.advanceTimersByTimeAsync(0);
		expect(fetchFn.mock.calls.length).toBe(1);

		await vi.advanceTimersByTimeAsync(1999);
		expect(fetchFn.mock.calls.length).toBe(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(fetchFn.mock.calls.length).toBe(2);

		await work;
		expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(2000);
	});

	it("projects a Japanese title from stored AniDB locales", async () => {
		const meta = await makeProvider(makeFetch()).fetchWork(resolved, {
			locale: "ja",
			now: new Date("2026-09-05T00:00:00.000Z"),
		});
		expect(meta.title).toBe("SPY×FAMILY");
		expect(meta.segments[0]?.episodes[0]?.title).toBe("ミッション1");
	});
});
