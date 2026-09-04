import { useCallback, useMemo } from "react";

import { Label } from "@/components/ui/label";
import { totalEpisodes } from "@/components/work/parts";
import { ScoreSelect } from "@/components/work/score-select";
import { useWorkTracking } from "@/components/work/use-work-tracking";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WatchStatus } from "@/db/schema";
import { useRequireAuth } from "@/integrations/better-auth/require-auth";
import type { RateableUnit, ViewerTracking, WorkBlock } from "@/orpc/schema";

import { useArmedConfirm } from "./confirming-remove";
import type { ConfirmTarget } from "./confirming-remove";
import { StatusSelect } from "./status-select";

const HEADING = "You · whole series";
const OUT_OF_TEN = "/10";
const MINUS = "−";
const PLUS = "+";
const REMOVE_FROM_LIBRARY = "remove from library";
const CONFIRM_REMOVE = "confirm remove";

function ProgressBar({ percent }: { percent: number }) {
	const style = useMemo(() => ({ width: `${percent}%` }), [percent]);
	return (
		<div className="bg-ink/15 mt-2.5 h-[3px] overflow-hidden">
			<span className="bg-accent block h-full" style={style} />
		</div>
	);
}

interface RewatchStepperProps {
	count: number;
	disabled?: boolean;
	onChange: (count: number) => void;
}

function RewatchStepper({ count, disabled, onChange }: RewatchStepperProps) {
	const decrease = useCallback(() => {
		onChange(Math.max(0, count - 1));
	}, [count, onChange]);
	const increase = useCallback(() => {
		onChange(count + 1);
	}, [count, onChange]);
	return (
		<div className="text-ink/50 mt-1.5 flex items-center gap-2 font-mono text-[11px]">
			<span>{`rewatch ×${count}`}</span>
			<button
				aria-label="Decrease rewatch count"
				className="text-ink/60 hover:text-accent cursor-pointer disabled:cursor-not-allowed"
				disabled={disabled}
				onClick={decrease}
				type="button"
			>
				{MINUS}
			</button>
			<button
				aria-label="Increase rewatch count"
				className="text-ink/60 hover:text-accent cursor-pointer disabled:cursor-not-allowed"
				disabled={disabled}
				onClick={increase}
				type="button"
			>
				{PLUS}
			</button>
		</div>
	);
}

interface RemoveFromLibraryButtonProps {
	confirming: boolean;
	disabled?: boolean;
	onClick: () => void;
}

function RemoveFromLibraryButton({
	confirming,
	disabled,
	onClick,
}: RemoveFromLibraryButtonProps) {
	return (
		<div className="text-ink/50 mt-1.5 font-mono text-[11px]">
			<button
				aria-label={confirming ? CONFIRM_REMOVE : REMOVE_FROM_LIBRARY}
				className="text-ink/60 hover:text-accent cursor-pointer disabled:cursor-not-allowed"
				disabled={disabled}
				onClick={onClick}
				type="button"
			>
				{confirming ? CONFIRM_REMOVE : REMOVE_FROM_LIBRARY}
			</button>
		</div>
	);
}

interface YouBlockProps {
	continuityId: string;
	order?: PresentationOrderSlug | undefined;
	parts: WorkBlock[];
	viewer: ViewerTracking | undefined;
}

function YouBlock({ continuityId, order, parts, viewer }: YouBlockProps) {
	const { authDialog, requireAuth } = useRequireAuth();
	const { remove, removing, setRating, setRewatch, setStatus } =
		useWorkTracking(continuityId, order);
	const target = useMemo<ConfirmTarget>(
		() => ({ continuityId, status: viewer?.status }),
		[continuityId, viewer?.status],
	);
	const { confirming: confirmingRemove, requestConfirm } =
		useArmedConfirm(target);
	const workUnit = useMemo<RateableUnit>(
		() => ({ key: continuityId, kind: "work" }),
		[continuityId],
	);

	const rateWork = useCallback(
		(score: number | undefined) => {
			requireAuth(() => {
				setRating(workUnit, score);
			});
		},
		[requireAuth, setRating, workUnit],
	);
	const changeStatus = useCallback(
		(status: WatchStatus) => {
			requireAuth(() => {
				setStatus(status);
			});
		},
		[requireAuth, setStatus],
	);
	const requestRemove = useCallback(() => {
		requireAuth(() => {
			if (confirmingRemove) {
				remove();
				return;
			}
			requestConfirm();
		});
	}, [confirmingRemove, remove, requestConfirm, requireAuth]);
	const changeRewatch = useCallback(
		(count: number) => {
			requireAuth(() => {
				setRewatch(count);
			});
		},
		[requireAuth, setRewatch],
	);

	const total = totalEpisodes(parts);
	const watched = viewer?.watched.length ?? 0;
	const percent = total === 0 ? 0 : Math.round((watched / total) * 100);

	return (
		<div>
			<Label>{HEADING}</Label>
			<div className="mt-3 flex items-baseline gap-1.5">
				<ScoreSelect
					label="Your score"
					onChange={rateWork}
					size="display"
					value={viewer?.personalRating}
				/>
				<span className="text-ink/40 font-mono text-[13px]">{OUT_OF_TEN}</span>
			</div>
			<StatusSelect
				disabled={removing}
				onChange={changeStatus}
				value={viewer?.status}
			/>
			<ProgressBar percent={percent} />
			<div className="text-ink/50 mt-1.5 font-mono text-[11px]">
				{`${watched} / ${total} across ${parts.length} parts`}
			</div>
			<RewatchStepper
				count={viewer?.rewatchCount ?? 0}
				disabled={removing}
				onChange={changeRewatch}
			/>
			{viewer?.status === undefined ? undefined : (
				<RemoveFromLibraryButton
					confirming={confirmingRemove}
					disabled={removing}
					onClick={requestRemove}
				/>
			)}
			{authDialog}
		</div>
	);
}

export { YouBlock };
