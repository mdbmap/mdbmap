import { describe, expect, it } from "vitest";

import { authGateFor } from "./require-auth";

describe("authGateFor", () => {
	it("waits while the session is pending", () => {
		expect(authGateFor(true, false)).toBe("wait");
		expect(authGateFor(true, true)).toBe("wait");
	});

	it("prompts when signed out after the session resolves", () => {
		expect(authGateFor(false, false)).toBe("prompt");
	});

	it("runs when signed in after the session resolves", () => {
		expect(authGateFor(false, true)).toBe("run");
	});
});
