import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import {
	seedMadokaMagica,
	seedMadeInAbyss,
	seedMonogatari,
} from "@/engine/test-continuity";
import type { ORPCContext, SessionUser } from "@/orpc/context";
import type { WorkBlock } from "@/orpc/schema";

import { router } from "./index.ts";

const clientFor = (
	db: Awaited<ReturnType<typeof freshDb>>,
	user?: SessionUser,
) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

const locatorsOf = (parts: WorkBlock[]) =>
	parts.flatMap((part) =>
		part.kind === "film"
			? [part.instalmentLocator]
			: part.episodes.map((episode) => episode.instalmentLocator),
	);

describe("work.get franchise fixtures", () => {
	it("Made in Abyss parts follow cour, film, cour locators", async () => {
		const db = await freshDb();
		const { continuityId } = await seedMadeInAbyss(db);
		const view = await clientFor(db).work.get({
			continuityId,
			order: "release",
		});

		expect(locatorsOf(view.parts)).toEqual([
			"anidb:9001#1",
			"anidb:9001#2",
			"anidb:9002#1",
			"anidb:9003#1",
			"anidb:9003#2",
		]);
	});

	it("Madoka Magica parts keep Rebellion on its own film locators", async () => {
		const db = await freshDb();
		const { continuityId } = await seedMadokaMagica(db);
		const view = await clientFor(db).work.get({
			continuityId,
			order: "release",
		});

		expect(locatorsOf(view.parts)).toEqual([
			"anidb:9101#1",
			"anidb:9101#2",
			"anidb:9102#1",
		]);
		expect(
			view.parts[0]?.episodes.map((episode) => episode.instalmentLocator),
		).toEqual(["anidb:9101#1", "anidb:9101#2"]);
		expect(
			view.parts[1]?.kind === "film" ? view.parts[1].instalmentLocator : "",
		).toBe("anidb:9102#1");
	});

	it("Monogatari watch order is Kizu then Bake then Nise", async () => {
		const db = await freshDb();
		const { continuityId } = await seedMonogatari(db);
		const client = clientFor(db);
		const release = await client.work.get({
			continuityId,
			order: "release",
		});
		const watch = await client.work.get({
			continuityId,
			order: "watch",
		});
		const fallback = await client.work.get({ continuityId });

		expect(locatorsOf(release.parts)).toEqual([
			"anidb:9201#1",
			"anidb:9201#2",
			"anidb:9202#1",
			"anidb:9202#2",
			"anidb:9203#1",
		]);
		expect(locatorsOf(watch.parts)).toEqual([
			"anidb:9203#1",
			"anidb:9201#1",
			"anidb:9201#2",
			"anidb:9202#1",
			"anidb:9202#2",
		]);
		expect(locatorsOf(watch.parts)).not.toEqual(locatorsOf(release.parts));
		expect(locatorsOf(fallback.parts)).toEqual(locatorsOf(watch.parts));
	});
});
