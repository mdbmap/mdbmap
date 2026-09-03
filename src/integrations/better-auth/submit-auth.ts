import { authClient } from "@/lib/auth-client";

import { messageForAuthError } from "./auth-error.ts";

type AuthMode = "sign-in" | "sign-up";

interface AuthFields {
	email: string;
	name: string;
	password: string;
}

async function submitAuth(
	mode: AuthMode,
	fields: AuthFields,
): Promise<string | undefined> {
	try {
		const result =
			mode === "sign-up"
				? await authClient.signUp.email({
						email: fields.email,
						name: fields.name,
						password: fields.password,
					})
				: await authClient.signIn.email({
						email: fields.email,
						password: fields.password,
					});
		if (result.error) {
			return messageForAuthError(result.error);
		}
		return undefined;
	} catch {
		return messageForAuthError({});
	}
}

export { submitAuth };
export type { AuthFields, AuthMode };
