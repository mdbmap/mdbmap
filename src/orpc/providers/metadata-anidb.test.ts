import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolveResult } from "@/engine";

import { createAnidbProvider } from "./metadata-anidb.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { MetadataKv } from "./metadata-tmdb.ts";

const COUR1_ID = "16947";
const COUR2_ID = "16948";

const resolved: ResolveResult = {
	mediaKind: "anime",
	segments: [
		{ instalments: ["anidb:16947#1", "anidb:16947#2"], members: { anidb: COUR1_ID } },
		{ instalments: ["anidb:16948#1"], members: { anidb: COUR2_ID } },
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
		<episode id="1001"><epno type="1">1</epno><airdate>2022-04-09</airdate><title xml:lang="en">Operation Strix</title><title xml:lang="ja">ミッション1</title></episode>
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

const xmlFor = (url: string): string => (url.includes(`aid=${COUR2_ID}`) ? cour2Xml : cour1Xml);

const makeFetch = () =>
	vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
		await Promise.resolve();
		return new Response(xmlFor(urlOf(input)));
	});

const makeKv = () => {
	const store = new Map<string, string>();
	const puts: { key: string; ttl: number | undefined }[] = [];
	const kv: MetadataKv = {
		get: async (key) => {
			await Promise.resolve();
			return store.get(key);
		},
		put: async (key, value, options) => {
			await Promise.resolve();
			store.set(key, value);
			puts.push({ key, ttl: options?.expirationTtl });
		},
	};
	return { kv, puts, store };
};

const makeProvider = (fetchFn: typeof fetch, kv: MetadataKv) =>
	createAnidbProvider({
		client: "mdbmaptest",
		clientVer: "1",
		fetchFn,
		rateLimiter: createRateLimiter({ intervalMs: 0 }),
		resolveKv: () => kv,
	});

afterEach(() => {
	vi.useRealTimers();
});

describe("anidb metadata provider", () => {
	it("normalises per-cour entries into WorkMetadata aligned with the engine segments", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();

		const meta = await makeProvider(fetchFn, kv).fetchWork(resolved);

		expect(meta.title).toBe("Spy x Family");
		expect(meta.nativeTitle).toBe("SPY×FAMILY");
		expect(meta.synopsis).toBe("A spy builds a fake family & hides his work.");
		expect(meta.coverRef).toBe("anidb:270350.jpg");
		expect(meta.backdropRef).toBeUndefined();
		expect(meta.span).toBe("2022");
		expect(meta.studios).toStrictEqual(["Wit Studio", "CloverWorks"]);

		expect(meta.cast).toStrictEqual([
			{ name: "Takuya Eguchi", ref: "anidb:creator:201", role: "Loid Forger" },
			{ name: "Atsumi Tanezaki", ref: "anidb:creator:202", role: "Anya Forger" },
		]);
		expect(meta.staff).toStrictEqual([
			{ name: "Kazuhiro Furuhashi", ref: "anidb:creator:1", role: "Director" },
			{ name: "Tatsuya Endo", ref: "anidb:creator:2", role: "Original Creator" },
			{ name: "(K)NoW_NAME", ref: "anidb:creator:5", role: "Music" },
		]);
		expect(meta.ifYouLiked).toStrictEqual([
			{ continuityId: "anidb:8069", coverRef: undefined, title: "Mob Psycho 100" },
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

	it("snapshots core and volatile fields to KV under distinct TTLs", async () => {
		const fetchFn = makeFetch();
		const { kv, puts, store } = makeKv();

		await makeProvider(fetchFn, kv).fetchWork(resolved);

		const coreKey = `anidb:v1:core:${COUR1_ID}`;
		const volatileKey = `anidb:v1:volatile:${COUR1_ID}`;
		expect(store.has(coreKey)).toBe(true);
		expect(store.has(volatileKey)).toBe(true);

		const coreTtl = puts.find((entry) => entry.key === coreKey)?.ttl;
		const volatileTtl = puts.find((entry) => entry.key === volatileKey)?.ttl;
		expect(coreTtl).toBeDefined();
		expect(volatileTtl).toBeDefined();
		expect(coreTtl ?? 0).toBeGreaterThan(volatileTtl ?? 0);
	});

	it("serves a snapshot hit with zero upstream subrequests", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		const provider = makeProvider(fetchFn, kv);

		const first = await provider.fetchWork(resolved);
		expect(fetchFn.mock.calls.length).toBe(2);

		const second = await provider.fetchWork(resolved);
		expect(fetchFn.mock.calls.length).toBe(2);
		expect(second).toStrictEqual(first);
	});

	it("spaces live requests at one per two seconds via the flood gate", async () => {
		vi.useFakeTimers();
		const times: number[] = [];
		const fetchFn = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
			await Promise.resolve();
			times.push(Date.now());
			return new Response(xmlFor(urlOf(input)));
		});
		const { kv } = makeKv();
		const provider = createAnidbProvider({
			client: "mdbmaptest",
			clientVer: "1",
			fetchFn,
			resolveKv: () => kv,
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
});
