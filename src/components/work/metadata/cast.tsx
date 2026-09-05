import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import type { Credit } from "@/orpc/schema";

import { imageUrl, posterHue } from "./placeholders";

const HEADING = "Cast";

function Avatar({
	alt,
	hue,
	src,
}: {
	alt: string;
	hue: string;
	src: string | undefined;
}) {
	if (src === undefined) {
		return <div className={`aspect-square rounded-full ${hue}`} />;
	}
	return (
		<img
			alt={alt}
			className="aspect-square rounded-full object-cover"
			src={src}
		/>
	);
}

function CastCard({ credit, hue }: { credit: Credit; hue: string }) {
	return (
		<div>
			<Avatar alt={credit.role} hue={hue} src={imageUrl(credit.ref)} />
			<div className="text-ink mt-2 text-[12.5px] leading-snug font-medium">
				{credit.role}
			</div>
			<div className="text-ink/45 mt-0.5 font-mono text-[10.5px]">
				{credit.name}
			</div>
		</div>
	);
}

function CastSection({ cast }: { cast: Credit[] }) {
	return (
		<Section>
			<SectionHead>{HEADING}</SectionHead>
			<div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-5">
				{cast.map((credit, index) => (
					<CastCard credit={credit} hue={posterHue(index)} key={credit.role} />
				))}
			</div>
		</Section>
	);
}

export { CastSection };
