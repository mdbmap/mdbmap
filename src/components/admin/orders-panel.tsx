import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeEvent, ReactNode, SubmitEvent } from "react";
import { useCallback, useState } from "react";

import { orpc } from "@/orpc/client";
import type { AdminSegment, ContinuityOrdersView } from "@/orpc/router/orders";

import { buttonClass, inputClass } from "./styles.ts";

const TITLE = "Watch order";
const DENIED = "Administrator access required.";
const LOAD_FAILED = "Could not load continuity.";
const EMPTY_WATCH = "Include at least one segment.";
const RELEASE_HINT = "No watch order yet. Showing release order.";

const LABEL = {
	continuityId: "Continuity id",
	down: "Down",
	exclude: "Exclude",
	include: "Include",
	load: "Load",
	save: "Save watch order",
	up: "Up",
} as const;

const isAuthDenial = (error: unknown): boolean =>
	error instanceof ORPCError &&
	(error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED");

const messageOf = (error: unknown): string | undefined =>
	error instanceof Error ? error.message : undefined;

const segmentLabel = (segment: AdminSegment): string =>
	`${segment.kind} ${segment.service}:${segment.serviceId}`;

const initialIncluded = (view: ContinuityOrdersView): number[] => [
	...(view.watchSegmentIds ?? view.releaseSegmentIds),
];

function LoadForm({
	draftId,
	onDraftId,
	onLoad,
}: {
	draftId: string;
	onDraftId: (event: ChangeEvent<HTMLInputElement>) => void;
	onLoad: (event: SubmitEvent<HTMLFormElement>) => void;
}) {
	return (
		<form className="flex items-end gap-2" onSubmit={onLoad}>
			<input
				aria-label={LABEL.continuityId}
				className={inputClass}
				inputMode="numeric"
				onChange={onDraftId}
				placeholder={LABEL.continuityId}
				value={draftId}
			/>
			<button className={buttonClass} type="submit">
				{LABEL.load}
			</button>
		</form>
	);
}

function IncludedRow({
	canDown,
	canUp,
	index,
	label,
	onExcludeAt,
	onMove,
}: {
	canDown: boolean;
	canUp: boolean;
	index: number;
	label: string;
	onExcludeAt: (index: number) => void;
	onMove: (index: number, delta: -1 | 1) => void;
}) {
	const onUp = useCallback(() => {
		onMove(index, -1);
	}, [index, onMove]);
	const onDown = useCallback(() => {
		onMove(index, 1);
	}, [index, onMove]);
	const onExclude = useCallback(() => {
		onExcludeAt(index);
	}, [index, onExcludeAt]);
	return (
		<article className="flex items-center justify-between gap-4 border border-neutral-300 p-4 dark:border-neutral-700">
			<span className="font-mono text-xs text-neutral-700 dark:text-neutral-300">
				{label}
			</span>
			<div className="flex gap-2">
				<button
					className={buttonClass}
					disabled={!canUp}
					onClick={onUp}
					type="button"
				>
					{LABEL.up}
				</button>
				<button
					className={buttonClass}
					disabled={!canDown}
					onClick={onDown}
					type="button"
				>
					{LABEL.down}
				</button>
				<button className={buttonClass} onClick={onExclude} type="button">
					{LABEL.exclude}
				</button>
			</div>
		</article>
	);
}

function ExcludedRow({
	label,
	onIncludeId,
	segmentId,
}: {
	label: string;
	onIncludeId: (segmentId: number) => void;
	segmentId: number;
}) {
	const onInclude = useCallback(() => {
		onIncludeId(segmentId);
	}, [onIncludeId, segmentId]);
	return (
		<article className="flex items-center justify-between gap-4 border border-neutral-300 p-4 dark:border-neutral-700">
			<span className="font-mono text-xs text-neutral-700 dark:text-neutral-300">
				{label}
			</span>
			<button className={buttonClass} onClick={onInclude} type="button">
				{LABEL.include}
			</button>
		</article>
	);
}

function WatchEditor({
	onSave,
	pending,
	view,
}: {
	onSave: (segmentIds: readonly number[]) => void;
	pending: boolean;
	view: ContinuityOrdersView;
}) {
	const [included, setIncluded] = useState(() => initialIncluded(view));
	const byId = new Map(view.segments.map((segment) => [segment.id, segment]));
	const includedSet = new Set(included);
	const excluded = view.releaseSegmentIds.filter((id) => !includedSet.has(id));

	const move = useCallback((index: number, delta: -1 | 1) => {
		setIncluded((current) => {
			const nextIndex = index + delta;
			const currentId = current[index];
			const swapped = current[nextIndex];
			if (currentId === undefined || swapped === undefined) {
				return current;
			}
			const next = [...current];
			next[index] = swapped;
			next[nextIndex] = currentId;
			return next;
		});
	}, []);

	const excludeAt = useCallback((index: number) => {
		setIncluded((current) =>
			current.filter((_id, itemIndex) => itemIndex !== index),
		);
	}, []);

	const includeId = useCallback((segmentId: number) => {
		setIncluded((current) =>
			current.includes(segmentId) ? current : [...current, segmentId],
		);
	}, []);

	const save = useCallback(() => {
		if (included.length === 0) {
			return;
		}
		onSave(included);
	}, [included, onSave]);

	return (
		<div className="flex flex-col gap-3">
			{view.watchSegmentIds === undefined ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{RELEASE_HINT}
				</p>
			) : undefined}
			{included.flatMap((segmentId, index) => {
				const segment = byId.get(segmentId);
				return segment === undefined
					? []
					: [
							<IncludedRow
								canDown={index < included.length - 1}
								canUp={index > 0}
								index={index}
								key={segmentId}
								label={segmentLabel(segment)}
								onExcludeAt={excludeAt}
								onMove={move}
							/>,
						];
			})}
			{excluded.flatMap((segmentId) => {
				const segment = byId.get(segmentId);
				return segment === undefined
					? []
					: [
							<ExcludedRow
								key={segmentId}
								label={segmentLabel(segment)}
								onIncludeId={includeId}
								segmentId={segmentId}
							/>,
						];
			})}
			{included.length === 0 ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{EMPTY_WATCH}
				</p>
			) : undefined}
			<button
				className={buttonClass}
				disabled={pending || included.length === 0}
				onClick={save}
				type="button"
			>
				{LABEL.save}
			</button>
		</div>
	);
}

export function OrdersPanel() {
	const queryClient = useQueryClient();
	const [draftId, setDraftId] = useState("");
	const [loadedId, setLoadedId] = useState<number | undefined>(undefined);

	const query = useQuery({
		...orpc.orders.get.queryOptions({
			input: { continuityId: loadedId ?? 0 },
		}),
		enabled: loadedId !== undefined,
	});
	const listKey = orpc.orders.get.queryKey({
		input: { continuityId: loadedId ?? 0 },
	});

	const saveMutation = useMutation(
		orpc.orders.saveWatch.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: listKey });
			},
		}),
	);
	const {
		error: saveError,
		isPending: saving,
		mutate: saveMutate,
	} = saveMutation;

	const onDraftId = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setDraftId(event.target.value);
	}, []);

	const onLoad = useCallback(
		(event: SubmitEvent<HTMLFormElement>) => {
			event.preventDefault();
			const parsed = Math.trunc(Number(draftId));
			if (Number.isNaN(parsed) || parsed < 1) {
				return;
			}
			setLoadedId(parsed);
		},
		[draftId],
	);

	const onSave = useCallback(
		(segmentIds: readonly number[]) => {
			if (loadedId === undefined) {
				return;
			}
			saveMutate({ continuityId: loadedId, segmentIds: [...segmentIds] });
		},
		[loadedId, saveMutate],
	);

	const denied = query.error !== null && isAuthDenial(query.error);
	const loadFailed = query.error !== null && !denied;
	const mutationMessage = messageOf(saveError);

	let body: ReactNode;
	if (denied) {
		body = (
			<p className="text-sm text-neutral-600 dark:text-neutral-400">{DENIED}</p>
		);
	} else if (loadFailed) {
		body = (
			<p className="text-sm text-neutral-600 dark:text-neutral-400">
				{messageOf(query.error) ?? LOAD_FAILED}
			</p>
		);
	} else if (query.data === undefined) {
		body = undefined;
	} else {
		body = (
			<WatchEditor
				key={`${String(query.data.continuityId)}:${query.data.watchSegmentIds?.join(",") ?? "release"}`}
				onSave={onSave}
				pending={saving}
				view={query.data}
			/>
		);
	}

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
			<h1 className="font-mono text-lg font-medium text-neutral-900 dark:text-neutral-50">
				{TITLE}
			</h1>
			<LoadForm draftId={draftId} onDraftId={onDraftId} onLoad={onLoad} />
			{body}
			{mutationMessage === undefined ? undefined : (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{mutationMessage}
				</p>
			)}
		</main>
	);
}
