import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { CandidateRow } from "@/engine/moderation";
import { orpc } from "@/orpc/client";

import { buttonClass } from "./styles.ts";

// The internal moderation console (issue #46). Deliberately plain — not the public
// design system — it lists the open queue, shows each row's evidence blob, and
// exposes the admin actions the engine's moderation module backs. Every action is
// gated on the Better-Auth admin role server-side; a non-admin sees the notice.

const TITLE = "Moderation queue";
const EMPTY = "The queue is empty.";
const DENIED = "Administrator access required.";

const LABEL = {
	accept: "Accept",
	acceptProposal: "Accept proposal",
	clear: "Clear flag",
	keep: "Keep",
	reject: "Reject",
} as const;

type Category = "conflict" | "flag" | "membership";

const categoryOf = (candidate: CandidateRow): Category => {
	if (candidate.kind === "low-confidence-flag") {
		return "flag";
	}
	return candidate.kind === "structural" || candidate.kind === "fuzzy-group"
		? "membership"
		: "conflict";
};

interface Actions {
	readonly accept: (candidateId: number) => void;
	readonly clearFlag: (candidateId: number) => void;
	readonly keepFlag: (candidateId: number) => void;
	readonly reject: (candidateId: number) => void;
	readonly settleAccept: (candidateId: number) => void;
	readonly settleReject: (candidateId: number) => void;
}

const useModerationActions = (): Actions => {
	const queryClient = useQueryClient();
	const listKey = orpc.moderation.list.queryKey();
	const onSuccess = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: listKey });
	}, [queryClient, listKey]);

	const acceptMutation = useMutation(
		orpc.moderation.accept.mutationOptions({ onSuccess }),
	);
	const rejectMutation = useMutation(
		orpc.moderation.reject.mutationOptions({ onSuccess }),
	);
	const settleMutation = useMutation(
		orpc.moderation.settle.mutationOptions({ onSuccess }),
	);
	const clearMutation = useMutation(
		orpc.moderation.clearFlag.mutationOptions({ onSuccess }),
	);
	const keepMutation = useMutation(
		orpc.moderation.keepFlag.mutationOptions({ onSuccess }),
	);

	const { mutate: acceptMutate } = acceptMutation;
	const { mutate: rejectMutate } = rejectMutation;
	const { mutate: settleMutate } = settleMutation;
	const { mutate: clearMutate } = clearMutation;
	const { mutate: keepMutate } = keepMutation;

	return useMemo(
		() => ({
			accept: (candidateId: number) => {
				acceptMutate({ candidateId });
			},
			clearFlag: (candidateId: number) => {
				clearMutate({ candidateId });
			},
			keepFlag: (candidateId: number) => {
				keepMutate({ candidateId });
			},
			reject: (candidateId: number) => {
				rejectMutate({ candidateId });
			},
			settleAccept: (candidateId: number) => {
				settleMutate({ accept: true, candidateId });
			},
			settleReject: (candidateId: number) => {
				settleMutate({ accept: false, candidateId });
			},
		}),
		[acceptMutate, clearMutate, keepMutate, rejectMutate, settleMutate],
	);
};

function ActionRow({
	actions,
	candidate,
}: {
	actions: Actions;
	candidate: CandidateRow;
}) {
	const { id } = candidate;
	const onAccept = useCallback(() => {
		actions.accept(id);
	}, [actions, id]);
	const onReject = useCallback(() => {
		actions.reject(id);
	}, [actions, id]);
	const onSettleAccept = useCallback(() => {
		actions.settleAccept(id);
	}, [actions, id]);
	const onSettleReject = useCallback(() => {
		actions.settleReject(id);
	}, [actions, id]);
	const onClear = useCallback(() => {
		actions.clearFlag(id);
	}, [actions, id]);
	const onKeep = useCallback(() => {
		actions.keepFlag(id);
	}, [actions, id]);

	const category = categoryOf(candidate);
	if (category === "membership") {
		return (
			<div className="flex gap-2">
				<button className={buttonClass} onClick={onAccept} type="button">
					{LABEL.accept}
				</button>
				<button className={buttonClass} onClick={onReject} type="button">
					{LABEL.reject}
				</button>
			</div>
		);
	}
	if (category === "conflict") {
		return (
			<div className="flex gap-2">
				<button className={buttonClass} onClick={onSettleAccept} type="button">
					{LABEL.acceptProposal}
				</button>
				<button className={buttonClass} onClick={onSettleReject} type="button">
					{LABEL.reject}
				</button>
			</div>
		);
	}
	return (
		<div className="flex gap-2">
			<button className={buttonClass} onClick={onClear} type="button">
				{LABEL.clear}
			</button>
			<button className={buttonClass} onClick={onKeep} type="button">
				{LABEL.keep}
			</button>
		</div>
	);
}

function CandidateCard({
	actions,
	candidate,
}: {
	actions: Actions;
	candidate: CandidateRow;
}) {
	return (
		<article className="flex flex-col gap-2 border border-neutral-300 p-4 dark:border-neutral-700">
			<div className="flex items-center justify-between">
				<span className="font-mono text-xs tracking-wide text-neutral-600 uppercase dark:text-neutral-400">
					{candidate.kind}
				</span>
				<span className="font-mono text-xs text-neutral-400">{`#${candidate.id}`}</span>
			</div>
			<pre className="overflow-x-auto bg-neutral-50 p-2 font-mono text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
				{JSON.stringify(
					{ evidence: candidate.evidence, subject: candidate.subject },
					undefined,
					2,
				)}
			</pre>
			<ActionRow actions={actions} candidate={candidate} />
		</article>
	);
}

export function ModerationQueue() {
	const actions = useModerationActions();
	const query = useQuery(orpc.moderation.list.queryOptions());

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
			<h1 className="font-mono text-lg font-medium text-neutral-900 dark:text-neutral-50">
				{TITLE}
			</h1>
			{query.isError ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{DENIED}
				</p>
			) : undefined}
			{query.data?.length === 0 ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{EMPTY}
				</p>
			) : undefined}
			{query.data?.map((candidate) => (
				<CandidateCard
					actions={actions}
					candidate={candidate}
					key={candidate.id}
				/>
			))}
		</main>
	);
}
