import { instalmentCount, watchedCount } from "@/components/work/parts";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { CommunityOrderRef, RateableUnit, WorkBlock } from "@/orpc/schema";

import { EpisodeList } from "./episode-list";
import { FilmRow } from "./film-row";
import { PartSelector } from "./part-selector";

interface PartInstalmentsProps {
	communityOrders?: readonly CommunityOrderRef[] | undefined;
	onMarkPart: (locators: string[], watched: boolean) => void;
	onPropose?: (() => void) | undefined;
	onRate: (unit: RateableUnit, score: number | undefined) => void;
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	onSelectPart: (index: number) => void;
	onSelectProposal?: ((proposalId: number) => void) | undefined;
	onToggle: (instalmentLocator: string, watched: boolean) => void;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	parts: WorkBlock[];
	selectedIndex: number;
	selectedPart: WorkBlock;
	selectedProposalId?: number | undefined;
}

function PartInstalments({
	communityOrders,
	onMarkPart,
	onPropose,
	onRate,
	onSelectOrder,
	onSelectPart,
	onSelectProposal,
	onToggle,
	order,
	orders,
	parts,
	selectedIndex,
	selectedPart,
	selectedProposalId,
}: PartInstalmentsProps) {
	return (
		<>
			<PartSelector
				communityOrders={communityOrders}
				episodeCount={instalmentCount(selectedPart)}
				onMarkPart={onMarkPart}
				onPropose={onPropose}
				onSelect={onSelectPart}
				onSelectOrder={onSelectOrder}
				onSelectProposal={onSelectProposal}
				order={order}
				orders={orders}
				parts={parts}
				selectedIndex={selectedIndex}
				selectedProposalId={selectedProposalId}
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
