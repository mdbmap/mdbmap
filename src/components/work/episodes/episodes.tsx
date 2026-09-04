import { useCallback } from "react";

import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import { useSelectedPart } from "@/components/work/part-state";
import { useWorkTracking } from "@/components/work/use-work-tracking";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { useRequireAuth } from "@/integrations/better-auth/require-auth";
import type { RateableUnit, WorkBlock } from "@/orpc/schema";

import { PartInstalments } from "./part-instalments";
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
	const { authDialog, requireAuth } = useRequireAuth();
	const { toggle } = useEpisodeWatched(continuityId, requireAuth, order);
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
				<PartInstalments
					onRate={rate}
					onSelectOrder={onSelectOrder}
					onSelectPart={selectPart}
					onToggle={toggle}
					order={order}
					orders={orders}
					parts={parts}
					selectedIndex={selectedIndex}
					selectedPart={selectedPart}
				/>
			)}
			{authDialog}
		</Section>
	);
}

export { Episodes };
