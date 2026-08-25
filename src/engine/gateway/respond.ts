import type { MappingOutcome } from "./resolve.ts";

const json = (
	body: unknown,
	status: number,
	headers: Record<string, string> = {},
): Response => Response.json(body, { headers, status });

// Map an engine decision to its HTTP response (ADR-0001). A pending build carries
// Retry-After and an opaque status URL; a conflict carries an opaque review
// reference and never a Retry-After.
const toResponse = (outcome: MappingOutcome): Response => {
	switch (outcome.kind) {
		case "conflict": {
			return json({ ...outcome.body, review: outcome.review }, 409);
		}
		case "malformed": {
			return json({ error: outcome.expected }, 400);
		}
		case "ok": {
			return json(outcome.body, 200);
		}
		case "pending": {
			return json({ ...outcome.body, statusUrl: outcome.statusUrl }, 202, {
				"retry-after": String(outcome.retryAfterSeconds),
			});
		}
		case "unknown": {
			return json({ error: "id unknown to any upstream service" }, 404);
		}
	}
};

export { toResponse };
