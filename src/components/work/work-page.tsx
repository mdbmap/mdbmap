import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { WorkView } from "@/orpc/schema";

import { Banner } from "./banner";
import { WorkLayout } from "./layout";
import { totalEpisodes } from "./parts";

const BRAND = "mdbmap";

function WorkHeader() {
	return (
		<header className="flex items-center justify-between px-8 py-3.5">
			<span className="font-mono text-xs font-medium tracking-[0.1em] text-accent uppercase">
				{BRAND}
			</span>
			<ThemeToggle />
		</header>
	);
}

export function WorkPage({ work }: { work: WorkView }) {
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<WorkHeader />
			<Banner
				episodeTotal={totalEpisodes(work.parts)}
				header={work.header}
				mediaKind={work.mediaKind}
				partCount={work.parts.length}
			/>
			<WorkLayout work={work} />
		</main>
	);
}
