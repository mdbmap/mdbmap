import { beforeEach, describe, expect, it, vi } from "vitest";

import { startAuthAttempt } from "./auth-attempt";
import type { AuthAttempt } from "./auth-attempt";

const { signInEmail } = vi.hoisted(() => ({
	signInEmail: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: { email: signInEmail },
		signUp: { email: vi.fn() },
	},
}));

const fields = {
	email: "ada@example.com",
	name: "Ada",
	password: "secret-password",
};

const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

const mockAttempt = () => {
	const close = vi.fn();
	const resetFields = vi.fn();
	const setError = vi.fn();
	const setPending = vi.fn();
	const attempt: AuthAttempt = {
		close: () => {
			close();
		},
		fields,
		inFlight: { current: false },
		mode: "sign-in",
		mounted: { current: true },
		resetFields: () => {
			resetFields();
		},
		setError: (error) => {
			setError(error);
		},
		setPending: (pending) => {
			setPending(pending);
		},
	};
	return { attempt, close, resetFields, setError, setPending };
};

describe("startAuthAttempt results", () => {
	beforeEach(() => {
		signInEmail.mockReset();
	});

	it("closes on successful sign-in", async () => {
		signInEmail.mockResolvedValue({ data: {}, error: undefined });
		const { attempt, close, setPending } = mockAttempt();
		startAuthAttempt(attempt);
		await flush();
		expect(close).toHaveBeenCalledOnce();
		expect(setPending).toHaveBeenLastCalledWith(false);
	});

	it("surfaces mapped errors and re-enables submit", async () => {
		signInEmail.mockResolvedValue({
			data: undefined,
			error: { code: "INVALID_EMAIL_OR_PASSWORD" },
		});
		const { attempt, close, setError } = mockAttempt();
		startAuthAttempt(attempt);
		await flush();
		expect(setError).toHaveBeenLastCalledWith("Invalid email or password.");
		expect(close).not.toHaveBeenCalled();
		expect(attempt.inFlight.current).toBe(false);
	});

	it("returns a fallback when sign-in rejects", async () => {
		signInEmail.mockRejectedValue(new Error("Failed to fetch"));
		const { attempt, setError, setPending } = mockAttempt();
		startAuthAttempt(attempt);
		await flush();
		expect(setError).toHaveBeenLastCalledWith(
			"Something went wrong. Try again.",
		);
		expect(attempt.inFlight.current).toBe(false);
		expect(setPending).toHaveBeenLastCalledWith(false);
	});
});

describe("startAuthAttempt lifecycle", () => {
	beforeEach(() => {
		signInEmail.mockReset();
	});

	it("ignores a completed request after the dialog unmounts", async () => {
		const deferred = Promise.withResolvers<{
			data: object;
			error: undefined;
		}>();
		signInEmail.mockReturnValue(deferred.promise);
		const { attempt, close, setError, setPending } = mockAttempt();
		startAuthAttempt(attempt);
		attempt.mounted.current = false;
		deferred.resolve({ data: {}, error: undefined });
		await flush();
		expect(close).not.toHaveBeenCalled();
		expect(setError).toHaveBeenCalledTimes(1);
		expect(setError).toHaveBeenCalledWith(undefined);
		expect(setPending).toHaveBeenCalledTimes(1);
		expect(setPending).toHaveBeenCalledWith(true);
	});

	it("ignores a second submit while a request is in flight", async () => {
		signInEmail.mockReturnValue(Promise.withResolvers().promise);
		const { attempt } = mockAttempt();
		startAuthAttempt(attempt);
		startAuthAttempt(attempt);
		await flush();
		expect(signInEmail).toHaveBeenCalledOnce();
	});
});
