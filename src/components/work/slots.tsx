import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import type { Credit, PartView, Similar, ViewerTracking } from "@/orpc/schema";

import { totalEpisodes } from "./parts";

// Placeholder regions for the sections that mount into this shell: main-column
// metadata (#12) and sidebar You + this-part (#13). Props mirror the WorkView
// fields those issues consume so they slot in cleanly.

function SlotRegion({ head, note }: { head: string; note: string }) {
	return (
		<Section>
			<SectionHead>{head}</SectionHead>
			<p className="mt-2 font-mono text-[11px] text-ink/40">{note}</p>
		</Section>
	);
}

interface MetadataSlotProps {
	cast: Credit[];
	ifYouLiked: Similar[];
	staff: Credit[];
	studios: string[];
}

function MetadataSlot({ cast, ifYouLiked, staff, studios }: MetadataSlotProps) {
	return (
		<>
			<SlotRegion head="Cast" note={`${cast.length} credited`} />
			<SlotRegion head="Staff" note={`${staff.length} credited`} />
			<SlotRegion head="Studios" note={`${studios.length} listed`} />
			<SlotRegion head="If you liked this" note={`${ifYouLiked.length} similar`} />
		</>
	);
}

interface SidebarYouSlotProps {
	parts: PartView[];
	viewer: ViewerTracking | undefined;
}

function SidebarYouSlot({ parts, viewer }: SidebarYouSlotProps) {
	const watched = viewer?.watched.length ?? 0;
	return <SlotRegion head="You" note={`${watched} / ${totalEpisodes(parts)} watched`} />;
}

function SidebarPartSlot({ parts }: { parts: PartView[] }) {
	const [first] = parts;
	return <SlotRegion head="This part" note={first?.label ?? "No parts"} />;
}

export { MetadataSlot, SidebarPartSlot, SidebarYouSlot };
