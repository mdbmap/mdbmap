import { useCallback, useState } from "react";

import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import { useSelectedPart } from "@/components/work/part-state";
import { useWorkTracking } from "@/components/work/use-work-tracking";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { useRequireAuth } from "@/integrations/better-auth/require-auth";
import type {
	CommunityOrderRef,
	ProposalSegmentRef,
	RateableUnit,
	WorkBlock,
} from "@/orpc/schema";

import { PartInstalments } from "./part-instalments";
import { ProposeOrderDialog } from "./propose-order-dialog";
import { useEpisodeWatched } from "./use-episode-watched";

const HEADING = "Episodes";
const NO_PARTS = "No parts";

const EMPTY_COMMUNITY_ORDERS: readonly CommunityOrderRef[] = [];
const EMPTY_PROPOSAL_SEGMENTS: readonly ProposalSegmentRef[] = [];

interface EpisodesProps {
	communityOrders?: readonly CommunityOrderRef[] | undefined;
	continuityId: string;
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	onSelectProposal?: ((proposalId: number) => void) | undefined;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	parts: WorkBlock[];
	proposalSegments?: readonly ProposalSegmentRef[] | undefined;
	selectedProposalId?: number | undefined;
}

function Episodes({
	communityOrders = EMPTY_COMMUNITY_ORDERS,
	continuityId,
	onSelectOrder,
	onSelectProposal,
	order,
	orders,
	parts,
	proposalSegments = EMPTY_PROPOSAL_SEGMENTS,
	selectedProposalId,
}: EpisodesProps) {
	const { selectPart, selectedIndex, selectedPart } = useSelectedPart(parts);
	const { authDialog, requireAuth } = useRequireAuth();
	const { toggle } = useEpisodeWatched(
		continuityId,
		requireAuth,
		order,
		selectedProposalId,
	);
	const { setRating } = useWorkTracking(
		continuityId,
		order,
		selectedProposalId,
	);
	const [proposeOpen, setProposeOpen] = useState(false);
	const rate = useCallback(
		(unit: RateableUnit, score: number | undefined) => {
			requireAuth(() => {
				setRating(unit, score);
			});
		},
		[requireAuth, setRating],
	);
	const openPropose = useCallback(() => {
		requireAuth(() => {
			setProposeOpen(true);
		});
	}, [requireAuth]);

	return (
		<Section>
			<SectionHead>{HEADING}</SectionHead>
			{selectedPart === undefined ? (
				<p className="text-ink/40 mt-2 font-mono text-[11px]">{NO_PARTS}</p>
			) : (
				<PartInstalments
					communityOrders={communityOrders}
					onPropose={proposalSegments.length > 0 ? openPropose : undefined}
					onRate={rate}
					onSelectOrder={onSelectOrder}
					onSelectPart={selectPart}
					onSelectProposal={onSelectProposal}
					onToggle={toggle}
					order={order}
					orders={orders}
					parts={parts}
					selectedIndex={selectedIndex}
					selectedPart={selectedPart}
					selectedProposalId={selectedProposalId}
				/>
			)}
			{authDialog}
			{proposalSegments.length > 0 ? (
				<ProposeOrderDialog
					continuityId={continuityId}
					isOpen={proposeOpen}
					onOpenChange={setProposeOpen}
					segments={proposalSegments}
				/>
			) : undefined}
		</Section>
	);
}

export { Episodes };
