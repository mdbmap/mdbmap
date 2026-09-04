import { useCallback } from "react";

import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import { useSelectedPart } from "@/components/work/part-state";
import { instalmentCount, watchedCount } from "@/components/work/parts";
import { useWorkTracking } from "@/components/work/sidebar/use-work-tracking";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { RateableUnit, WorkBlock } from "@/orpc/schema";

import { EpisodeList } from "./episode-list";
import { FilmRow } from "./film-row";
import { PartSelector } from "./part-selector";
import { useEpisodeWatched } from "./use-episode-watched";

const HEADING = "Episodes";
const NO_PARTS = "No parts";

interface EpisodesProps {
	continuityId: string;
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	parts: WorkBlock[];
}

function Episodes({
	continuityId,
	onSelectOrder,
	order,
	orders,
	parts,
}: EpisodesProps) {
	const { selectPart, selectedIndex, selectedPart } = useSelectedPart(parts);
	const { authDialog, requireAuth, toggle } = useEpisodeWatched(
		continuityId,
		order,
	);
	const { setRating } = useWorkTracking(continuityId, order);
	const rate = useCallback(
		(unit: RateableUnit, score: number | undefined) => {
			requireAuth(() => {
				setRating(unit, score);
			});
		},
		[requireAuth, setRating],
	);

	return (
		<Section>
			<SectionHead>{HEADING}</SectionHead>
			{selectedPart === undefined ? (
				<p className="text-ink/40 mt-2 font-mono text-[11px]">{NO_PARTS}</p>
			) : (
				<>
					<PartSelector
						episodeCount={instalmentCount(selectedPart)}
						onSelect={selectPart}
						onSelectOrder={onSelectOrder}
						order={order}
						orders={orders}
						parts={parts}
						selectedIndex={selectedIndex}
						watchedCount={watchedCount(selectedPart)}
					/>
					{selectedPart.kind === "film" ? (
						<FilmRow film={selectedPart} onRate={rate} onToggle={toggle} />
					) : (
						<EpisodeList
							key={selectedPart.rateableUnit.key}
							episodes={selectedPart.episodes}
							onRate={rate}
							onToggle={toggle}
						/>
					)}
				</>
			)}
			{authDialog}
		</Section>
	);
}

export { Episodes };
