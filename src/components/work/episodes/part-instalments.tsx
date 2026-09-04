import { instalmentCount, watchedCount } from "@/components/work/parts";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { RateableUnit, WorkBlock } from "@/orpc/schema";

import { EpisodeList } from "./episode-list";
import { FilmRow } from "./film-row";
import { PartSelector } from "./part-selector";

interface PartInstalmentsProps {
	onMarkPart: (locators: string[], watched: boolean) => void;
	onRate: (unit: RateableUnit, score: number | undefined) => void;
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	onSelectPart: (index: number) => void;
	onToggle: (instalmentLocator: string, watched: boolean) => void;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	parts: WorkBlock[];
	selectedIndex: number;
	selectedPart: WorkBlock;
}

function PartInstalments({
	onMarkPart,
	onRate,
	onSelectOrder,
	onSelectPart,
	onToggle,
	order,
	orders,
	parts,
	selectedIndex,
	selectedPart,
}: PartInstalmentsProps) {
	return (
		<>
			<PartSelector
				episodeCount={instalmentCount(selectedPart)}
				onMarkPart={onMarkPart}
				onSelect={onSelectPart}
				onSelectOrder={onSelectOrder}
				order={order}
				orders={orders}
				parts={parts}
				selectedIndex={selectedIndex}
				watchedCount={watchedCount(selectedPart)}
			/>
			{selectedPart.kind === "film" ? (
				<FilmRow film={selectedPart} onRate={onRate} onToggle={onToggle} />
			) : (
				<EpisodeList
					key={selectedPart.rateableUnit.key}
					episodes={selectedPart.episodes}
					onRate={onRate}
					onToggle={onToggle}
				/>
			)}
		</>
	);
}

export { PartInstalments };
