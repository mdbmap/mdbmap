import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import type { WorkView } from "@/orpc/schema";

import { Banner } from "./banner";
import { WorkLayout } from "./layout";
import { totalEpisodes } from "./parts";

const BRAND = "mdbmap";

function WorkHeader() {
	return (
		<header className="flex items-center justify-between px-8 py-3.5">
			<span className="text-accent font-mono text-xs font-medium tracking-[0.1em] uppercase">
				{BRAND}
			</span>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

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
			<WorkHeader />
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
