import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { disarmIfTargetChanged, isArmedFor } from "./confirming-remove";
import type { ConfirmTarget } from "./confirming-remove";

const CONFIRM_REMOVE = "confirm remove";
const REMOVE_FROM_LIBRARY = "remove from library";

const watchingA: ConfirmTarget = {
	continuityId: "continuity:a",
	status: "watching",
};
const watchingB: ConfirmTarget = {
	continuityId: "continuity:b",
	status: "watching",
};
const completedA: ConfirmTarget = {
	continuityId: "continuity:a",
	status: "completed",
};

function ConfirmLabel({
	armed,
	target,
}: {
	armed: ConfirmTarget | undefined;
	target: ConfirmTarget;
}) {
	return isArmedFor(armed, target) ? CONFIRM_REMOVE : REMOVE_FROM_LIBRARY;
}

describe("isArmedFor", () => {
	it("requires a fresh confirmation after continuityId changes", () => {
		expect(
			renderToStaticMarkup(
				<ConfirmLabel armed={watchingA} target={watchingA} />,
			),
		).toBe(CONFIRM_REMOVE);
		expect(
			renderToStaticMarkup(
				<ConfirmLabel armed={watchingA} target={watchingB} />,
			),
		).toBe(REMOVE_FROM_LIBRARY);
	});

	it("requires a fresh confirmation after watch status changes", () => {
		expect(isArmedFor(watchingA, completedA)).toBe(false);
		expect(isArmedFor(undefined, watchingA)).toBe(false);
		expect(isArmedFor(watchingA, watchingA)).toBe(true);
	});

	it("requires a fresh confirmation after the target changes and returns", () => {
		let armed: ConfirmTarget | undefined = watchingA;
		let previous = watchingA;
		const apply = (next: ConfirmTarget) => {
			armed = disarmIfTargetChanged(armed, previous, next);
			previous = next;
		};
		apply(watchingB);
		expect(isArmedFor(armed, watchingB)).toBe(false);
		apply(watchingA);
		expect(
			renderToStaticMarkup(<ConfirmLabel armed={armed} target={watchingA} />),
		).toBe(REMOVE_FROM_LIBRARY);
		expect(isArmedFor(armed, watchingA)).toBe(false);
	});
});
