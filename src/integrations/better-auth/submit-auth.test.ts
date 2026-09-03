import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitAuth } from "./submit-auth";

const { signInEmail, signUpEmail } = vi.hoisted(() => ({
	signInEmail: vi.fn(),
	signUpEmail: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: { email: signInEmail },
		signUp: { email: signUpEmail },
	},
}));

const fields = {
	email: "ada@example.com",
	name: "Ada",
	password: "secret-password",
};

describe("submitAuth", () => {
	beforeEach(() => {
		signInEmail.mockReset();
		signUpEmail.mockReset();
	});

	it("returns undefined on successful sign-in", async () => {
		signInEmail.mockResolvedValue({ data: {}, error: undefined });
		await expect(submitAuth("sign-in", fields)).resolves.toBeUndefined();
	});

	it("maps duplicate email on sign-up", async () => {
		signUpEmail.mockResolvedValue({
			data: undefined,
			error: { code: "USER_ALREADY_EXISTS" },
		});
		await expect(submitAuth("sign-up", fields)).resolves.toBe(
			"An account with this email already exists.",
		);
	});

	it("returns a fallback when sign-in rejects", async () => {
		signInEmail.mockRejectedValue(new Error("Failed to fetch"));
		await expect(submitAuth("sign-in", fields)).resolves.toBe(
			"Something went wrong. Try again.",
		);
	});

	it("returns a fallback when sign-up rejects", async () => {
		signUpEmail.mockRejectedValue(new Error("network down"));
		await expect(submitAuth("sign-up", fields)).resolves.toBe(
			"Something went wrong. Try again.",
		);
	});
});
