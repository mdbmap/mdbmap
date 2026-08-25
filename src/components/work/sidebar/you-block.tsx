import { useCallback, useMemo } from "react";

import { Label } from "@/components/ui/label";
import { totalEpisodes } from "@/components/work/parts";
import type { PartView, RateableUnit, ViewerTracking } from "@/orpc/schema";

import { ScoreSelect } from "./score-select";
import { StatusSelect } from "./status-select";
import { useWorkTracking } from "./use-work-tracking";

const HEADING = "You · whole series";
const OUT_OF_TEN = "/10";
const MINUS = "−";
const PLUS = "+";

function ProgressBar({ percent }: { percent: number }) {
	const style = useMemo(() => ({ width: `${percent}%` }), [percent]);
	return (
		<div className="mt-2.5 h-[3px] overflow-hidden bg-ink/15">
			<span className="block h-full bg-accent" style={style} />
		</div>
	);
}

interface RewatchStepperProps {
	count: number;
	onChange: (count: number) => void;
}

function RewatchStepper({ count, onChange }: RewatchStepperProps) {
	const decrease = useCallback(() => {
		onChange(Math.max(0, count - 1));
	}, [count, onChange]);
	const increase = useCallback(() => {
		onChange(count + 1);
	}, [count, onChange]);
	return (
		<div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-ink/50">
			<span>{`rewatch ×${count}`}</span>
			<button
				aria-label="Decrease rewatch count"
				className="cursor-pointer text-ink/60 hover:text-accent"
				onClick={decrease}
				type="button"
			>
				{MINUS}
			</button>
			<button
				aria-label="Increase rewatch count"
				className="cursor-pointer text-ink/60 hover:text-accent"
				onClick={increase}
				type="button"
			>
				{PLUS}
			</button>
		</div>
	);
}

interface YouBlockProps {
	continuityId: string;
	parts: PartView[];
	viewer: ViewerTracking | undefined;
}

function YouBlock({ continuityId, parts, viewer }: YouBlockProps) {
	const { setRating, setRewatch, setStatus } = useWorkTracking(continuityId);
	const workUnit = useMemo<RateableUnit>(
		() => ({ key: continuityId, kind: "work" }),
		[continuityId],
	);
	const rateWork = useCallback(
		(score: number | undefined) => {
			setRating(workUnit, score);
		},
		[setRating, workUnit],
	);

	const total = totalEpisodes(parts);
	const watched = viewer?.watched.length ?? 0;
	const percent = total === 0 ? 0 : Math.round((watched / total) * 100);

	return (
		<div>
			<Label>{HEADING}</Label>
			<div className="mt-2 flex items-baseline gap-1.5">
				<ScoreSelect
					label="Your score"
					onChange={rateWork}
					size="display"
					value={viewer?.personalRating}
				/>
				<span className="font-mono text-[13px] text-ink/40">{OUT_OF_TEN}</span>
			</div>
			<StatusSelect onChange={setStatus} value={viewer?.status} />
			<ProgressBar percent={percent} />
			<div className="mt-1.5 font-mono text-[11px] text-ink/50">
				{`${watched} / ${total} across ${parts.length} parts`}
			</div>
			<RewatchStepper count={viewer?.rewatchCount ?? 0} onChange={setRewatch} />
		</div>
	);
}

export { YouBlock };
