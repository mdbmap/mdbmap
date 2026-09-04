import { useCallback } from "react";
import { tv } from "tailwind-variants";

import { ScoreSelect } from "@/components/work/sidebar/score-select";
import type { EpisodeView, RateableUnit } from "@/orpc/schema";

// Ruled still placeholders are hue-parameterised, but Tailwind only emits classes
// it can see as literals — so the hue cycle maps to static class names here.
const stillClass = [
	"still-340",
	"still-300",
	"still-225",
	"still-150",
	"still-352",
	"still-20",
] as const;

const NO_STILL_LABEL = "no still";

const title = tv({
	base: "min-w-0 truncate",
	variants: { on: { false: "text-ink/70", true: "text-ink" } },
});

const padNumber = (value: number) => String(value).padStart(2, "0");

function Still({ hue, watched }: { hue: string; watched: boolean }) {
	if (watched) {
		return <div className={`h-[54px] ${hue}`} />;
	}
	return (
		<div className="border-line bg-no-still text-ink/30 flex h-[54px] items-center justify-center border font-mono text-[9px]">
			{NO_STILL_LABEL}
		</div>
	);
}

interface EpisodeRowProps {
	episode: EpisodeView;
	onRate: (unit: RateableUnit, score: number | undefined) => void;
	onToggle: (instalmentLocator: string, watched: boolean) => void;
}

function EpisodeRow({ episode, onRate, onToggle }: EpisodeRowProps) {
	const { instalmentLocator, number, rateableUnit, watched } = episode;
	const handleToggle = useCallback(() => {
		onToggle(instalmentLocator, !watched);
	}, [instalmentLocator, watched, onToggle]);
	const handleRate = useCallback(
		(score: number | undefined) => {
			onRate(rateableUnit, score);
		},
		[onRate, rateableUnit],
	);
	const hue = stillClass[(number - 1) % stillClass.length] ?? stillClass[0];
	const padded = padNumber(number);

	return (
		<div className="border-line grid grid-cols-[13px_96px_28px_1fr_auto] items-center gap-x-3.5 border-t py-2.5 text-sm">
			<input
				aria-label={`Mark episode ${padded} watched`}
				checked={watched}
				className="accent-accent size-[13px] shrink-0 justify-self-center"
				onChange={handleToggle}
				type="checkbox"
			/>
			<Still hue={hue} watched={watched} />
			<span className="text-ink/45 font-mono text-xs">{padded}</span>
			<span className={title({ on: watched })}>{episode.title}</span>
			<span className="text-ink/45 flex items-center gap-2.5 justify-self-end font-mono text-[11px]">
				<ScoreSelect
					label={`Your score for episode ${padded}`}
					onChange={handleRate}
					size="inline"
					value={episode.personalRating}
				/>
				{episode.airDate}
			</span>
		</div>
	);
}

export { EpisodeRow };
