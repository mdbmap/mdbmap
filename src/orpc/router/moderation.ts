import {
	acceptMembership,
	clearReviewFlag,
	keepReviewFlag,
	listOpenCandidates,
	manualPairing,
	markAsMatched,
	rejectMembership,
	settleConflict,
} from "@/engine/moderation";
import type { CandidateRow } from "@/engine/moderation";
import { admin } from "@/orpc/base";
import {
	CandidateIdInput,
	ManualPairInput,
	MarkMatchedInput,
	SettleConflictInput,
} from "@/orpc/schema";

// The admin-only moderation surface (issue #46). Every procedure is gated on the
// Better-Auth `admin` role and delegates to the engine's moderation module, which
// owns the curated attach + CAS-batch reuse. This is an internal tool: the router
// stays a thin, typed pass-through over those actions.

const list = admin.handler(
	async ({ context }): Promise<readonly CandidateRow[]> =>
		listOpenCandidates(context.db),
);

const accept = admin
	.input(CandidateIdInput)
	.handler(async ({ context, input }) =>
		acceptMembership(context.db, input.candidateId),
	);

const reject = admin
	.input(CandidateIdInput)
	.handler(async ({ context, input }) =>
		rejectMembership(context.db, input.candidateId),
	);

const settle = admin
	.input(SettleConflictInput)
	.handler(async ({ context, input }) => settleConflict(context.db, input));

const clearFlag = admin
	.input(CandidateIdInput)
	.handler(async ({ context, input }) =>
		clearReviewFlag(context.db, input.candidateId),
	);

const keepFlag = admin
	.input(CandidateIdInput)
	.handler(async ({ context, input }) =>
		keepReviewFlag(context.db, input.candidateId),
	);

const markMatched = admin
	.input(MarkMatchedInput)
	.handler(async ({ context, input }) =>
		markAsMatched(context.db, input.groupId),
	);

const pair = admin
	.input(ManualPairInput)
	.handler(async ({ context, input }) => manualPairing(context.db, input));

const moderation = {
	accept,
	clearFlag,
	keepFlag,
	list,
	markMatched,
	pair,
	reject,
	settle,
};

export { moderation };
