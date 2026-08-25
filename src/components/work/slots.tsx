import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import type { PartView, ViewerTracking } from "@/orpc/schema";

import { totalEpisodes } from "./parts";

// Placeholder regions for the sidebar sections that mount into this shell: You +
// this-part (#13). Props mirror the WorkView fields that issue consumes so they
// slot in cleanly.

function SlotRegion({ head, note }: { head: string; note: string }) {
	return (
		<Section>
			<SectionHead>{head}</SectionHead>
			<p className="mt-2 font-mono text-[11px] text-ink/40">{note}</p>
		</Section>
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

export { SidebarPartSlot, SidebarYouSlot };
