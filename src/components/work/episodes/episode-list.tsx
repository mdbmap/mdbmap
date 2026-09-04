import { useCallback, useState } from "react";

import type { EpisodeView, RateableUnit } from "@/orpc/schema";

import { EpisodeRow } from "./episode-row";

const COLLAPSED_LIMIT = 12;

interface EpisodeListProps {
	episodes: EpisodeView[];
	onRate: (unit: RateableUnit, score: number | undefined) => void;
	onToggle: (instalmentLocator: string, watched: boolean) => void;
}

export function EpisodeList({ episodes, onRate, onToggle }: EpisodeListProps) {
	const [expanded, setExpanded] = useState(false);
	const expand = useCallback(() => {
		setExpanded(true);
	}, []);
	const truncated = !expanded && episodes.length > COLLAPSED_LIMIT;
	const shown = truncated ? episodes.slice(0, COLLAPSED_LIMIT) : episodes;

	return (
		<div className="mt-3.5">
			<div className="border-line border-b">
				{shown.map((episode) => (
					<EpisodeRow
						key={episode.instalmentLocator}
						episode={episode}
						onRate={onRate}
						onToggle={onToggle}
					/>
				))}
			</div>
			{truncated && (
				<button
					className="text-accent mt-3 cursor-pointer font-mono text-xs"
					onClick={expand}
					type="button"
				>
					{`show all ${episodes.length}`}
				</button>
			)}
		</div>
	);
}
