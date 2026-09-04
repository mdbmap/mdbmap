import { useCallback } from "react";
import { tv } from "tailwind-variants";

import { ScoreSelect } from "@/components/work/sidebar/score-select";
import type { FilmView, RateableUnit } from "@/orpc/schema";

const title = tv({
	base: "min-w-0 truncate",
	variants: { on: { false: "text-ink/70", true: "text-ink" } },
});

interface FilmRowProps {
	film: FilmView;
	onRate: (unit: RateableUnit, score: number | undefined) => void;
	onToggle: (instalmentLocator: string, watched: boolean) => void;
}

function FilmScore({
	airDate,
	label,
	onChange,
	value,
}: {
	airDate: string | undefined;
	label: string;
	onChange: (score: number | undefined) => void;
	value: number | undefined;
}) {
	return (
		<span className="text-ink/45 flex items-center gap-2.5 justify-self-end font-mono text-[11px]">
			<ScoreSelect
				label={`Your score for ${label}`}
				onChange={onChange}
				size="inline"
				value={value}
			/>
			{airDate}
		</span>
	);
}

function FilmRow({ film, onRate, onToggle }: FilmRowProps) {
	const { instalmentLocator, label, rateableUnit, watched } = film;
	const handleToggle = useCallback(() => {
		onToggle(instalmentLocator, !watched);
	}, [instalmentLocator, watched, onToggle]);
	const handleRate = useCallback(
		(score: number | undefined) => {
			onRate(rateableUnit, score);
		},
		[onRate, rateableUnit],
	);

	return (
		<div className="border-line mt-3.5 border-b">
			<div className="border-line grid grid-cols-[13px_1fr_auto] items-center gap-x-3.5 border-t py-2.5 text-sm">
				<input
					aria-label={`Mark ${label} watched`}
					checked={watched}
					className="accent-accent size-[13px] shrink-0 justify-self-center"
					onChange={handleToggle}
					type="checkbox"
				/>
				<span className={title({ on: watched })}>{label}</span>
				<FilmScore
					airDate={film.airDate}
					label={label}
					onChange={handleRate}
					value={film.personalRating}
				/>
			</div>
		</div>
	);
}

export { FilmRow };
