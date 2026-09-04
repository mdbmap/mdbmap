const isMissingContinuity = (error: unknown): error is Error =>
	error instanceof Error && error.message.startsWith("engine: no continuity ");

export { isMissingContinuity };
