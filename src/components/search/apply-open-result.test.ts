import { describe, expect, it, vi } from "vitest";

import { applyOpenResult } from "./apply-open-result";
import type { OpenHitState } from "./open-hit";

describe("applyOpenResult", () => {
	it("navigates to the work page for a stubbed ready open client", () => {
		const navigate = vi.fn<(...args: unknown[]) => void>();
		const setState = vi.fn<(state: OpenHitState) => void>();
		applyOpenResult(
			{ continuityId: "continuity:42", kind: "ready" },
			navigate,
			setState,
		);
		expect(navigate).toHaveBeenCalledWith({
			params: { continuityId: 42 },
			to: "/work/$continuityId",
		});
		expect(setState).not.toHaveBeenCalled();
	});

	it("navigates for pending-with-continuity from a stubbed open client", () => {
		const navigate = vi.fn<(...args: unknown[]) => void>();
		applyOpenResult(
			{
				continuityId: "continuity:7",
				kind: "pending",
				retryAfterSeconds: 5,
			},
			navigate,
			vi.fn<(state: OpenHitState) => void>(),
		);
		expect(navigate).toHaveBeenCalledWith({
			params: { continuityId: 7 },
			to: "/work/$continuityId",
		});
	});

	it("records an error state when the stubbed client returns unknown", () => {
		const setState = vi.fn<(state: OpenHitState) => void>();
		applyOpenResult(
			{ kind: "unknown" },
			vi.fn<(...args: unknown[]) => void>(),
			setState,
		);
		expect(setState).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "error" }),
		);
	});
});
