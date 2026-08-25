import { useCallback } from "react";
import { tv } from "tailwind-variants";

import type { EpisodeView } from "@/orpc/schema";

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

const metaLine = (episode: EpisodeView) =>
	[
		episode.personalRating === undefined ? undefined : `${episode.personalRating}/10`,
		episode.airDate,
	]
		.filter((part) => part !== undefined)
		.join(" · ");

function Still({ hue, watched }: { hue: string; watched: boolean }) {
	if (watched) {
		return <div className={`h-[54px] ${hue}`} />;
	}
	return (
		<div className="flex h-[54px] items-center justify-center border border-line bg-no-still font-mono text-[9px] text-ink/30">
			{NO_STILL_LABEL}
		</div>
	);
}

interface EpisodeRowProps {
	episode: EpisodeView;
	onToggle: (instalmentLocator: string, watched: boolean) => void;
}

function EpisodeRow({ episode, onToggle }: EpisodeRowProps) {
	const { instalmentLocator, number, watched } = episode;
	const handleToggle = useCallback(() => {
		onToggle(instalmentLocator, !watched);
	}, [instalmentLocator, watched, onToggle]);
	const hue = stillClass[(number - 1) % stillClass.length] ?? stillClass[0];

	return (
		<div className="grid grid-cols-[13px_96px_28px_1fr_auto] items-center gap-x-3.5 border-t border-line py-2.5 text-sm">
			<input
				aria-label={`Mark episode ${padNumber(number)} watched`}
				checked={watched}
				className="size-[13px] shrink-0 justify-self-center accent-accent"
				onChange={handleToggle}
				type="checkbox"
			/>
			<Still hue={hue} watched={watched} />
			<span className="font-mono text-xs text-ink/45">{padNumber(number)}</span>
			<span className={title({ on: watched })}>{episode.title}</span>
			<span className="justify-self-end font-mono text-[11px] text-ink/45">
				{metaLine(episode)}
			</span>
		</div>
	);
}

export { EpisodeRow };
