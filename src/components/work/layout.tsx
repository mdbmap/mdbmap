import type { WorkView } from "@/orpc/schema";

import { Episodes } from "./episodes";
import { Metadata } from "./metadata";
import { SidebarPartSlot, SidebarYouSlot } from "./slots";

function Synopsis({ text }: { text: string }) {
	return (
		<p className="max-w-[70ch] text-[15px] leading-relaxed text-pretty text-ink/80">
			{text}
		</p>
	);
}

function MainColumn({ work }: { work: WorkView }) {
	return (
		<div className="flex min-w-0 flex-col gap-6 px-8 pt-6 md:border-r md:border-line">
			<Synopsis text={work.header.synopsis} />
			<Episodes continuityId={work.continuityId} parts={work.parts} />
			<Metadata
				cast={work.cast}
				ifYouLiked={work.ifYouLiked}
				staff={work.staff}
				studios={work.studios}
			/>
		</div>
	);
}

function Sidebar({ work }: { work: WorkView }) {
	return (
		<div className="flex flex-col gap-6 px-8 pt-6">
			<SidebarYouSlot parts={work.parts} viewer={work.viewer} />
			<SidebarPartSlot parts={work.parts} />
		</div>
	);
}

export function WorkLayout({ work }: { work: WorkView }) {
	return (
		<div className="grid grid-cols-1 md:grid-cols-[1fr_300px]">
			<MainColumn work={work} />
			<Sidebar work={work} />
		</div>
	);
}
