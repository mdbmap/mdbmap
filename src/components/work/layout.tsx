import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WorkView } from "@/orpc/schema";

import { Episodes } from "./episodes";
import { Metadata } from "./metadata";
import { Catalogues, CommunityBlock, PartPanel, YouBlock } from "./sidebar";

function Synopsis({ text }: { text: string }) {
	return (
		<p className="text-ink/80 max-w-[70ch] text-[15px] leading-relaxed text-pretty">
			{text}
		</p>
	);
}

interface WorkLayoutProps {
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	work: WorkView;
}

function MainColumn({ onSelectOrder, order, orders, work }: WorkLayoutProps) {
	return (
		<div className="md:border-line flex min-w-0 flex-col gap-6 px-8 pt-6 md:border-r">
			<Synopsis text={work.header.synopsis} />
			<Episodes
				continuityId={work.continuityId}
				onSelectOrder={onSelectOrder}
				order={order}
				orders={orders}
				parts={work.parts}
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

function Sidebar({ order, work }: WorkLayoutProps) {
	return (
		<div className="flex flex-col gap-6 px-8 pt-6">
			<CommunityBlock score={work.communityScore} />
			<YouBlock
				continuityId={work.continuityId}
				order={order}
				parts={work.parts}
				viewer={work.viewer}
			/>
			<Catalogues catalogues={work.catalogues} />
			<PartPanel
				continuityId={work.continuityId}
				order={order}
				parts={work.parts}
			/>
		</div>
	);
}

export function WorkLayout({
	onSelectOrder,
	order,
	orders,
	work,
}: WorkLayoutProps) {
	return (
		<div className="grid grid-cols-1 md:grid-cols-[1fr_300px]">
			<MainColumn
				onSelectOrder={onSelectOrder}
				order={order}
				orders={orders}
				work={work}
			/>
			<Sidebar order={order} work={work} />
		</div>
	);
}
