import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { orpc } from "@/orpc/client";
import type { ProposalView } from "@/orpc/router/order-proposals";

import { buttonClass } from "./styles.ts";

const TITLE = "Order proposal queue";
const EMPTY = "The queue is empty.";
const DENIED = "Administrator access required.";
const LOAD_FAILED = "Could not load the proposal queue.";
const REVIEW_FAILED = "Could not apply that review. Refresh and try again.";

const isAuthDenial = (error: unknown): boolean =>
	error instanceof ORPCError &&
	(error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED");

const LABEL = {
	accept: "Accept",
	reject: "Reject",
} as const;

interface Actions {
	readonly accept: (proposalId: number) => void;
	readonly busy: boolean;
	readonly errorMessage: string | undefined;
	readonly reject: (proposalId: number) => void;
}

const useProposalActions = (
	onReviewed: (proposal: ProposalView) => void,
): Actions => {
	const queryClient = useQueryClient();
	const listKey = orpc.orderProposals.listPending.queryKey();
	const onSuccess = useCallback(
		async (proposal: ProposalView) => {
			onReviewed(proposal);
			await queryClient.invalidateQueries({ queryKey: listKey });
		},
		[listKey, onReviewed, queryClient],
	);

	const acceptMutation = useMutation(
		orpc.orderProposals.accept.mutationOptions({ onSuccess }),
	);
	const rejectMutation = useMutation(
		orpc.orderProposals.reject.mutationOptions({ onSuccess }),
	);
	const { mutate: acceptMutate } = acceptMutation;
	const { mutate: rejectMutate } = rejectMutation;

	return useMemo(
		() => ({
			accept: (proposalId: number) => {
				acceptMutate({ proposalId });
			},
			busy: acceptMutation.isPending || rejectMutation.isPending,
			errorMessage:
				acceptMutation.isError || rejectMutation.isError
					? REVIEW_FAILED
					: undefined,
			reject: (proposalId: number) => {
				rejectMutate({ proposalId });
			},
		}),
		[
			acceptMutate,
			acceptMutation.isError,
			acceptMutation.isPending,
			rejectMutate,
			rejectMutation.isError,
			rejectMutation.isPending,
		],
	);
};

function ProposalCard({
	actions,
	proposal,
}: {
	actions: Actions;
	proposal: ProposalView;
}) {
	const { id } = proposal;
	const onAccept = useCallback(() => {
		actions.accept(id);
	}, [actions, id]);
	const onReject = useCallback(() => {
		actions.reject(id);
	}, [actions, id]);

	return (
		<article className="flex flex-col gap-2 border border-neutral-300 p-4 dark:border-neutral-700">
			<div className="flex items-center justify-between gap-4">
				<span className="font-mono text-sm text-neutral-900 dark:text-neutral-50">
					{proposal.name}
				</span>
				<span className="font-mono text-xs text-neutral-400">{`#${String(id)}`}</span>
			</div>
			<p className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
				{`continuity ${String(proposal.continuityId)} · author ${proposal.authorUserId} · ${String(proposal.items.length)} segments`}
			</p>
			<p className="text-sm text-neutral-700 dark:text-neutral-300">
				{proposal.rationale}
			</p>
			<div className="flex gap-2">
				<button
					className={buttonClass}
					disabled={actions.busy}
					onClick={onAccept}
					type="button"
				>
					{LABEL.accept}
				</button>
				<button
					className={buttonClass}
					disabled={actions.busy}
					onClick={onReject}
					type="button"
				>
					{LABEL.reject}
				</button>
			</div>
		</article>
	);
}

function LastReview({ proposal }: { proposal: ProposalView }) {
	const reviewedAt =
		proposal.reviewedAt === undefined
			? undefined
			: proposal.reviewedAt.toISOString();
	return (
		<p className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
			{`Last review: ${proposal.status}`}
			{proposal.reviewedByUserId === undefined
				? ""
				: ` by ${proposal.reviewedByUserId}`}
			{reviewedAt === undefined ? "" : ` at ${reviewedAt}`}
		</p>
	);
}

export function OrderProposalsQueue() {
	const [lastReview, setLastReview] = useState<ProposalView | undefined>(
		undefined,
	);
	const onReviewed = useCallback((proposal: ProposalView) => {
		setLastReview(proposal);
	}, []);
	const actions = useProposalActions(onReviewed);
	const query = useQuery(orpc.orderProposals.listPending.queryOptions());

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
			<h1 className="font-mono text-lg font-medium text-neutral-900 dark:text-neutral-50">
				{TITLE}
			</h1>
			{query.isError ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{isAuthDenial(query.error) ? DENIED : LOAD_FAILED}
				</p>
			) : undefined}
			{actions.errorMessage === undefined ? undefined : (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{actions.errorMessage}
				</p>
			)}
			{lastReview === undefined ? undefined : (
				<LastReview proposal={lastReview} />
			)}
			{query.data?.length === 0 ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{EMPTY}
				</p>
			) : undefined}
			{query.data?.map((proposal) => (
				<ProposalCard actions={actions} key={proposal.id} proposal={proposal} />
			))}
		</main>
	);
}
