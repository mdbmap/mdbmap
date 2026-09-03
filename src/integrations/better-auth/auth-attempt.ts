import { messageForAuthError } from "./auth-error.ts";
import { submitAuth } from "./submit-auth.ts";
import type { AuthFields, AuthMode } from "./submit-auth.ts";

interface AuthAttempt {
	close: () => void;
	fields: AuthFields;
	inFlight: { current: boolean };
	mode: AuthMode;
	mounted: { current: boolean };
	resetFields: () => void;
	setError: (error: string | undefined) => void;
	setPending: (pending: boolean) => void;
}

async function runAuthSubmit(
	mode: AuthMode,
	fields: AuthFields,
): Promise<string | undefined> {
	try {
		return await submitAuth(mode, fields);
	} catch {
		return messageForAuthError({});
	}
}

function startAuthAttempt(attempt: AuthAttempt): void {
	const {
		close,
		fields,
		inFlight,
		mode,
		mounted,
		resetFields,
		setError,
		setPending,
	} = attempt;
	if (inFlight.current) {
		return;
	}
	inFlight.current = true;
	setPending(true);
	setError(undefined);
	void (async () => {
		const nextError = await runAuthSubmit(mode, fields);
		if (!mounted.current) {
			return;
		}
		inFlight.current = false;
		setPending(false);
		if (nextError !== undefined) {
			setError(nextError);
			return;
		}
		resetFields();
		close();
	})();
}

export { startAuthAttempt };
export type { AuthAttempt };
