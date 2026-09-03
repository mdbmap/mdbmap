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

	it("maps handled auth errors", async () => {
		signInEmail.mockResolvedValue({
			data: undefined,
			error: { code: "INVALID_EMAIL_OR_PASSWORD" },
		});
		await expect(submitAuth("sign-in", fields)).resolves.toBe(
			"Invalid email or password.",
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
