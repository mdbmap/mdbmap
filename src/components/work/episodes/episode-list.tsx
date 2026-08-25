import { useCallback, useState } from "react";

import type { EpisodeView } from "@/orpc/schema";

import { EpisodeRow } from "./episode-row";

const COLLAPSED_LIMIT = 12;

interface EpisodeListProps {
	episodes: EpisodeView[];
	onToggle: (instalmentLocator: string, watched: boolean) => void;
}

export function EpisodeList({ episodes, onToggle }: EpisodeListProps) {
	const [expanded, setExpanded] = useState(false);
	const expand = useCallback(() => {
		setExpanded(true);
	}, []);
	const truncated = !expanded && episodes.length > COLLAPSED_LIMIT;
	const shown = truncated ? episodes.slice(0, COLLAPSED_LIMIT) : episodes;

	return (
		<div className="mt-3.5">
			<div className="border-b border-line">
				{shown.map((episode) => (
					<EpisodeRow
						key={episode.instalmentLocator}
						episode={episode}
						onToggle={onToggle}
					/>
				))}
			</div>
			{truncated && (
				<button
					className="mt-3 cursor-pointer font-mono text-xs text-accent"
					onClick={expand}
					type="button"
				>
					{`show all ${episodes.length}`}
				</button>
			)}
		</div>
	);
}
