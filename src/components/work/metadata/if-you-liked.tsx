import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import type { Similar } from "@/orpc/schema";

import { imageUrl, posterHue } from "./placeholders";

const HEADING = "If you liked this";

function Poster({ hue, src, title }: { hue: string; src: string | undefined; title: string }) {
	if (src === undefined) {
		return <div className={`aspect-[2/3] border border-line ${hue}`} />;
	}
	return (
		<img
			alt={`${title} cover`}
			className="aspect-[2/3] border border-line object-cover"
			src={src}
		/>
	);
}

function SimilarCard({ hue, item }: { hue: string; item: Similar }) {
	const params = useMemo(() => ({ continuityId: item.continuityId }), [item.continuityId]);
	return (
		<Link params={params} to="/work/$continuityId">
			<Poster hue={hue} src={imageUrl(item.coverRef)} title={item.title} />
			<div className="mt-2 text-[12.5px] leading-snug font-medium text-ink">
				{item.title}
			</div>
		</Link>
	);
}

function IfYouLiked({ items }: { items: Similar[] }) {
	return (
		<Section>
			<SectionHead>{HEADING}</SectionHead>
			<div className="mt-4 grid grid-cols-3 gap-3.5 sm:grid-cols-5">
				{items.map((item, index) => (
					<SimilarCard hue={posterHue(index + 2)} item={item} key={item.continuityId} />
				))}
			</div>
		</Section>
	);
}

export { IfYouLiked };
