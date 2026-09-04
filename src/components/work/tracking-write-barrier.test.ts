import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { user, watchStatus } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import { seedCrossGroupContinuity } from "@/engine/test-continuity";
import type { ORPCContext } from "@/orpc/context";
import { router } from "@/orpc/router";

import { createTrackingWriteBarrier } from "./tracking-write-barrier";

const seeded = async () => {
	const db = await freshDb();
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
	const { continuityId } = await seedCrossGroupContinuity(db);
	return { continuityId, db };
};

const clientFor = (db: Awaited<ReturnType<typeof seeded>>["db"]) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () => ({ id: "user-1" }),
		} satisfies ORPCContext,
	});

const hold = () => Promise.withResolvers<true>();

describe("blocked tracking writes", () => {
	it("does not start a write while remove is pending", async () => {
		const barrier = createTrackingWriteBarrier();
		const held = hold();
		const writes: string[] = [];
		const remove = barrier.runRemove(async () => {
			await held.promise;
		});
		const outcome = await barrier.runWrite(
			() => {
				writes.push("status");
				return "wrote";
			},
			() => {
				writes.push("compensate");
			},
		);
		held.resolve(true);
		await remove;
		expect(outcome).toEqual({ kind: "discarded" });
		expect(writes).toEqual([]);
	});

	it("rejects writes after remove is requested", async () => {
		const barrier = createTrackingWriteBarrier();
		const writes: string[] = [];
		barrier.block();
		const outcome = await barrier.runWrite(
			() => {
				writes.push("status");
				return "wrote";
			},
			() => {
				writes.push("compensate");
			},
		);
		expect(outcome).toEqual({ kind: "discarded" });
		expect(writes).toEqual([]);
	});
});

describe("failed remove", () => {
	it("allows writes after remove fails", async () => {
		const barrier = createTrackingWriteBarrier();
		await expect(
			barrier.runRemove(() => {
				throw new Error("remove failed");
			}),
		).rejects.toThrow(/remove failed/u);
		const writes: string[] = [];
		const outcome = await barrier.runWrite(
			() => {
				writes.push("status");
				return "wrote";
			},
			() => {
				writes.push("compensate");
			},
		);
		expect(outcome).toEqual({ kind: "applied", result: "wrote" });
		expect(writes).toEqual(["status"]);
	});
});

describe("late setStatus", () => {
	it("keeps the work untracked when setStatus resolves after remove", async () => {
		const { continuityId, db } = await seeded();
		const { tracking } = clientFor(db);
		await tracking.setStatus({ continuityId, status: "watching" });
		const barrier = createTrackingWriteBarrier();
		const held = hold();
		const setStatus = barrier.runWrite(
			async () => {
				await held.promise;
				return tracking.setStatus({
					continuityId,
					status: "completed",
				});
			},
			async () => tracking.remove({ continuityId }),
		);
		await barrier.runRemove(async () => tracking.remove({ continuityId }));
		held.resolve(true);
		await setStatus;
		expect(await db.select().from(watchStatus).all()).toEqual([]);
	});
});
