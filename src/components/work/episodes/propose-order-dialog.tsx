import { useMutation } from "@tanstack/react-query";
import type { ChangeEvent, SubmitEvent } from "react";
import { useCallback, useState } from "react";

import { parseContinuityKey } from "@/engine/continuity/keys";
import { orpc } from "@/orpc/client";
import type { ProposalSegmentRef } from "@/orpc/schema";

const COPY = {
	cancel: "Cancel",
	down: "Down",
	name: "Name",
	propose: "Propose order",
	rationale: "Rationale",
	submit: "Submit proposal",
	submitting: "Submitting…",
	title: "Propose presentation order",
	up: "Up",
} as const;

const moveId = (
	ids: readonly number[],
	index: number,
	delta: -1 | 1,
): number[] => {
	const next = [...ids];
	const current = next[index];
	const swap = next[index + delta];
	if (current === undefined || swap === undefined) {
		return next;
	}
	next[index] = swap;
	next[index + delta] = current;
	return next;
};

function SegmentRow({
	canDown,
	canUp,
	index,
	label,
	onMove,
}: {
	canDown: boolean;
	canUp: boolean;
	index: number;
	label: string;
	onMove: (index: number, delta: -1 | 1) => void;
}) {
	const onUp = useCallback(() => {
		onMove(index, -1);
	}, [index, onMove]);
	const onDown = useCallback(() => {
		onMove(index, 1);
	}, [index, onMove]);
	return (
		<li className="border-line flex items-center justify-between gap-3 border px-3 py-2">
			<span className="text-ink/80 font-mono text-[11px]">{label}</span>
			<div className="flex gap-2">
				<button
					className="text-ink/50 hover:text-accent cursor-pointer font-mono text-[11px] disabled:opacity-30"
					disabled={!canUp}
					onClick={onUp}
					type="button"
				>
					{COPY.up}
				</button>
				<button
					className="text-ink/50 hover:text-accent cursor-pointer font-mono text-[11px] disabled:opacity-30"
					disabled={!canDown}
					onClick={onDown}
					type="button"
				>
					{COPY.down}
				</button>
			</div>
		</li>
	);
}

function SegmentList({
	labelById,
	onMove,
	segmentIds,
}: {
	labelById: ReadonlyMap<number, string>;
	onMove: (index: number, delta: -1 | 1) => void;
	segmentIds: readonly number[];
}) {
	return (
		<ol className="flex flex-col gap-2">
			{segmentIds.map((segmentId, index) => (
				<SegmentRow
					canDown={index < segmentIds.length - 1}
					canUp={index > 0}
					index={index}
					key={segmentId}
					label={labelById.get(segmentId) ?? `Segment ${segmentId}`}
					onMove={onMove}
				/>
			))}
		</ol>
	);
}

function NameField({
	onChange,
	value,
}: {
	onChange: (event: ChangeEvent<HTMLInputElement>) => void;
	value: string;
}) {
	return (
		<label className="flex flex-col gap-1.5 font-mono text-[11px]">
			<span className="text-ink/50">{COPY.name}</span>
			<input
				className="border-line bg-surface text-ink border px-2 py-1.5"
				maxLength={120}
				onChange={onChange}
				required
				value={value}
			/>
		</label>
	);
}

function RationaleField({
	onChange,
	value,
}: {
	onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
	value: string;
}) {
	return (
		<label className="flex flex-col gap-1.5 font-mono text-[11px]">
			<span className="text-ink/50">{COPY.rationale}</span>
			<textarea
				className="border-line bg-surface text-ink min-h-20 border px-2 py-1.5"
				maxLength={2000}
				onChange={onChange}
				required
				value={value}
			/>
		</label>
	);
}

function FormActions({
	onCancel,
	pending,
}: {
	onCancel: () => void;
	pending: boolean;
}) {
	return (
		<div className="flex justify-end gap-3">
			<button
				className="text-ink/50 hover:text-accent cursor-pointer font-mono text-[11px]"
				onClick={onCancel}
				type="button"
			>
				{COPY.cancel}
			</button>
			<button
				className="bg-accent text-surface cursor-pointer px-3 py-1.5 font-mono text-[11px] disabled:opacity-50"
				disabled={pending}
				type="submit"
			>
				{pending ? COPY.submitting : COPY.submit}
			</button>
		</div>
	);
}

interface ProposeOrderFormProps {
	close: () => void;
	continuityId: string;
	segments: readonly ProposalSegmentRef[];
}

function ProposeOrderForm({
	close,
	continuityId,
	segments,
}: ProposeOrderFormProps) {
	const [name, setName] = useState("");
	const [rationale, setRationale] = useState("");
	const [segmentIds, setSegmentIds] = useState(() =>
		segments.map((segment) => segment.id),
	);
	const [error, setError] = useState<string | undefined>();
	const labelById = new Map(
		segments.map((segment) => [segment.id, segment.label]),
	);
	const numericId = parseContinuityKey(continuityId);

	const mutation = useMutation(
		orpc.orderProposals.create.mutationOptions({
			onError: (err: unknown) => {
				setError(err instanceof Error ? err.message : "Could not submit.");
			},
			onSuccess: () => {
				close();
			},
		}),
	);

	const onMove = useCallback((index: number, delta: -1 | 1) => {
		setSegmentIds((current) => moveId(current, index, delta));
	}, []);
	const onName = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setName(event.currentTarget.value);
	}, []);
	const onRationale = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
		setRationale(event.currentTarget.value);
	}, []);
	const onSubmit = useCallback(
		(event: SubmitEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (numericId === undefined) {
				setError("Continuity id is invalid.");
				return;
			}
			setError(undefined);
			mutation.mutate({
				continuityId: numericId,
				name: name.trim(),
				rationale: rationale.trim(),
				segmentIds,
			});
		},
		[mutation, name, numericId, rationale, segmentIds],
	);

	return (
		<form className="flex flex-col gap-4" onSubmit={onSubmit}>
			<NameField onChange={onName} value={name} />
			<RationaleField onChange={onRationale} value={rationale} />
			<SegmentList
				labelById={labelById}
				onMove={onMove}
				segmentIds={segmentIds}
			/>
			{error === undefined ? undefined : (
				<div className="text-accent font-mono text-[11px]" role="alert">
					{error}
				</div>
			)}
			<FormActions onCancel={close} pending={mutation.isPending} />
		</form>
	);
}

interface ProposeOrderDialogProps {
	continuityId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	segments: readonly ProposalSegmentRef[];
}

function ProposeOrderDialog({
	continuityId,
	isOpen,
	onOpenChange,
	segments,
}: ProposeOrderDialogProps) {
	const close = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);
	const onBackdrop = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);
	if (!isOpen) {
		return false;
	}
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<button
				aria-label="Close"
				className="absolute inset-0 cursor-default"
				onClick={onBackdrop}
				type="button"
			/>
			<dialog
				aria-labelledby="propose-order-title"
				className="bg-surface border-line relative z-10 m-0 max-h-[90vh] w-full max-w-md overflow-y-auto border p-5 shadow-lg"
				open
			>
				<h2
					className="text-ink mb-4 font-mono text-xs tracking-[0.08em] uppercase"
					id="propose-order-title"
				>
					{COPY.title}
				</h2>
				<ProposeOrderForm
					close={close}
					continuityId={continuityId}
					segments={segments}
				/>
			</dialog>
		</div>
	);
}

export { ProposeOrderDialog };
