import { z } from "zod";

import { reviewVerdicts } from "./types.ts";

// The only shape a model call may return. `safeParse` (never `parse`) so a
// hallucinated shape is data for the caller to escalate on, not an exception.
const verdictSchema = z.object({
	rationale: z.string().min(1),
	verdict: z.enum(reviewVerdicts),
});

type RawVerdict = z.infer<typeof verdictSchema>;

type ParsedVerdict =
	| { readonly kind: "malformed" }
	| { readonly kind: "parsed"; readonly verdict: RawVerdict };

const parseVerdict = (raw: unknown): ParsedVerdict => {
	const result = verdictSchema.safeParse(raw);
	return result.success
		? { kind: "parsed", verdict: result.data }
		: { kind: "malformed" };
};

export { parseVerdict, verdictSchema };
export type { ParsedVerdict, RawVerdict };
