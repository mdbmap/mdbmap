class NotEnumerableServiceError extends Error {
	public readonly service: string;

	public constructor(service: string) {
		super(`not enumerable: ${service}`);
		this.name = "NotEnumerableServiceError";
		this.service = service;
	}
}

const isNotEnumerableServiceError = (
	error: unknown,
): error is NotEnumerableServiceError =>
	error instanceof NotEnumerableServiceError;

export { isNotEnumerableServiceError, NotEnumerableServiceError };
