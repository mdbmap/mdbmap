const AUTH_ERROR_COPY = {
	INVALID_EMAIL_OR_PASSWORD: "Invalid email or password.",
	USER_ALREADY_EXISTS: "An account with this email already exists.",
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
		"An account with this email already exists.",
} as const;

type AuthErrorCode = keyof typeof AUTH_ERROR_COPY;

const isAuthErrorCode = (code: string): code is AuthErrorCode =>
	Object.hasOwn(AUTH_ERROR_COPY, code);

const messageForAuthError = (error: {
	code?: string | undefined;
	message?: string | undefined;
}): string => {
	const { code, message } = error;
	if (code !== undefined && isAuthErrorCode(code)) {
		return AUTH_ERROR_COPY[code];
	}
	if (message !== undefined && message.length > 0) {
		return message;
	}
	return "Something went wrong. Try again.";
};

export { messageForAuthError };
