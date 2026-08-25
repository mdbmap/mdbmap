import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";

import { posterHue } from "./placeholders";

const HEADING = "Studios";

function StudioChip({ hue, name }: { hue: string; name: string }) {
	return (
		<div className="flex items-center gap-2.5">
			<div className={`size-10 shrink-0 border border-line ${hue}`} />
			<span className="text-[13px] font-medium text-ink/85">{name}</span>
		</div>
	);
}

function StudiosSection({ studios }: { studios: string[] }) {
	return (
		<Section>
			<SectionHead>{HEADING}</SectionHead>
			<div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-3.5">
				{studios.map((name, index) => (
					<StudioChip hue={posterHue(index + 1)} key={name} name={name} />
				))}
			</div>
		</Section>
	);
}

export { StudiosSection };
