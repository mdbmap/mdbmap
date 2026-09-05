import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WorkView } from "@/orpc/schema";

import { Episodes } from "./episodes";
import { Metadata } from "./metadata";
import { MetadataFreshness } from "./metadata-freshness";
import { CommunityBlock, PartPanel, YouBlock } from "./sidebar";

function Synopsis({ text }: { text: string }) {
	return (
		<p className="text-ink/80 max-w-[70ch] text-[15px] leading-relaxed text-pretty">
			{text}
		</p>
	);
}

interface WorkLayoutProps {
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	onSelectProposal?: ((proposalId: number) => void) | undefined;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	selectedProposalId?: number | undefined;
	work: WorkView;
}

function MainColumn({
	onSelectOrder,
	onSelectProposal,
	order,
	orders,
	selectedProposalId,
	work,
}: WorkLayoutProps) {
	const { tagline } = work.header;
	return (
		<div className="md:border-line flex min-w-0 flex-col gap-6 px-8 pt-6 md:border-r">
			{tagline === undefined || tagline === "" ? (
				false
			) : (
				<p className="text-ink/55 max-w-[70ch] font-serif text-[15px] italic">
					{tagline}
				</p>
			)}
			<Synopsis text={work.header.synopsis} />
			<MetadataFreshness
				continuityId={work.continuityId}
				lastUpdatedAt={work.header.lastUpdatedAt}
				order={order}
				proposalId={selectedProposalId}
				userRefreshAvailableAt={work.header.userRefreshAvailableAt}
			/>
			<Episodes
				communityOrders={work.communityOrders}
				continuityId={work.continuityId}
				onSelectOrder={onSelectOrder}
				onSelectProposal={onSelectProposal}
				order={order}
				orders={orders}
				parts={work.parts}
				proposalSegments={work.proposalSegments}
				selectedProposalId={selectedProposalId}
			/>
			<Metadata
				cast={work.cast}
				ifYouLiked={work.ifYouLiked}
				staff={work.staff}
				studios={work.studios}
			/>
		</div>
	);
}

function Sidebar({ order, selectedProposalId, work }: WorkLayoutProps) {
	return (
		<div className="flex flex-col gap-6 px-8 pt-6">
			<CommunityBlock score={work.communityScore} />
			<YouBlock
				continuityId={work.continuityId}
				order={order}
				parts={work.parts}
				proposalId={selectedProposalId}
				viewer={work.viewer}
			/>
			<PartPanel
				continuityId={work.continuityId}
				order={order}
				parts={work.parts}
				proposalId={selectedProposalId}
			/>
		</div>
	);
}

export function WorkLayout({
	onSelectOrder,
	onSelectProposal,
	order,
	orders,
	selectedProposalId,
	work,
}: WorkLayoutProps) {
	return (
		<div className="grid grid-cols-1 md:grid-cols-[1fr_300px]">
			<MainColumn
				onSelectOrder={onSelectOrder}
				onSelectProposal={onSelectProposal}
				order={order}
				orders={orders}
				selectedProposalId={selectedProposalId}
				work={work}
			/>
			<Sidebar
				order={order}
				selectedProposalId={selectedProposalId}
				work={work}
			/>
		</div>
	);
}
