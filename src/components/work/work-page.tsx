import { SiteHeader } from "@/components/site-header";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WorkView } from "@/orpc/schema";

import { Banner } from "./banner";
import { WorkLayout } from "./layout";
import { totalEpisodes } from "./parts";

interface WorkPageProps {
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	work: WorkView;
}

export function WorkPage({
	onSelectOrder,
	order,
	orders,
	work,
}: WorkPageProps) {
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<SiteHeader />
			<Banner
				episodeTotal={totalEpisodes(work.parts)}
				header={work.header}
				mediaKind={work.mediaKind}
				partCount={work.parts.length}
			/>
			<WorkLayout
				onSelectOrder={onSelectOrder}
				order={order}
				orders={orders}
				work={work}
			/>
		</main>
	);
}
