import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import { useSelectedPart } from "@/components/work/part-state";
import type { PartView } from "@/orpc/schema";

import { EpisodeList } from "./episode-list";
import { PartSelector } from "./part-selector";
import { useEpisodeWatched } from "./use-episode-watched";

const HEADING = "Episodes";
const NO_PARTS = "No parts";

const watchedInPart = (part: PartView) =>
	part.episodes.reduce((count, episode) => count + (episode.watched ? 1 : 0), 0);

interface EpisodesProps {
	continuityId: string;
	parts: PartView[];
}

function Episodes({ continuityId, parts }: EpisodesProps) {
	const { selectPart, selectedIndex, selectedPart } = useSelectedPart(parts);
	const { toggle } = useEpisodeWatched(continuityId);

	return (
		<Section>
			<SectionHead>{HEADING}</SectionHead>
			{selectedPart === undefined ? (
				<p className="mt-2 font-mono text-[11px] text-ink/40">{NO_PARTS}</p>
			) : (
				<>
					<PartSelector
						episodeCount={selectedPart.episodeCount}
						onSelect={selectPart}
						parts={parts}
						selectedIndex={selectedIndex}
						watchedCount={watchedInPart(selectedPart)}
					/>
					<EpisodeList
						key={selectedPart.rateableUnit.key}
						episodes={selectedPart.episodes}
						onToggle={toggle}
					/>
				</>
			)}
		</Section>
	);
}

export { Episodes };
