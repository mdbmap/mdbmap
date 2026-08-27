import { useCallback } from "react";
import { tv } from "tailwind-variants";

import type { FilmView } from "@/orpc/schema";

const title = tv({
	base: "min-w-0 truncate",
	variants: { on: { false: "text-ink/70", true: "text-ink" } },
});

const metaLine = (film: FilmView) =>
	[
		film.personalRating === undefined ? undefined : `${film.personalRating}/10`,
		film.airDate,
	]
		.filter((part) => part !== undefined)
		.join(" · ");

interface FilmRowProps {
	film: FilmView;
	onToggle: (instalmentLocator: string, watched: boolean) => void;
}

function FilmRow({ film, onToggle }: FilmRowProps) {
	const { instalmentLocator, label, watched } = film;
	const handleToggle = useCallback(() => {
		onToggle(instalmentLocator, !watched);
	}, [instalmentLocator, watched, onToggle]);

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
				<span className="text-ink/45 justify-self-end font-mono text-[11px]">
					{metaLine(film)}
				</span>
			</div>
		</div>
	);
}

export { FilmRow };
