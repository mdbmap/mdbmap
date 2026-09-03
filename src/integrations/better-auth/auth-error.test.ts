import { describe, expect, it } from "vitest";

import { messageForAuthError } from "./auth-error";

describe("messageForAuthError", () => {
	it("maps invalid credentials", () => {
		expect(messageForAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
			"Invalid email or password.",
		);
	});

	it("maps duplicate email", () => {
		expect(messageForAuthError({ code: "USER_ALREADY_EXISTS" })).toBe(
			"An account with this email already exists.",
		);
	});

	it("falls back to the server message", () => {
		expect(messageForAuthError({ message: "Custom failure" })).toBe(
			"Custom failure",
		);
	});
});
