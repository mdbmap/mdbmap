import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { Section } from "@/components/ui/section";
import { SectionHead } from "@/components/ui/section-head";
import { workPathId } from "@/engine/continuity/keys";
import type { Similar } from "@/orpc/schema";

import { imageUrl, posterHue } from "./placeholders";

const HEADING = "If you liked this";

function Poster({
	hue,
	src,
	title,
}: {
	hue: string;
	src: string | undefined;
	title: string;
}) {
	if (src === undefined) {
		return <div className={`border-line aspect-[2/3] border ${hue}`} />;
	}
	return (
		<img
			alt={`${title} cover`}
			className="border-line aspect-[2/3] border object-cover"
			src={src}
		/>
	);
}

function CardBody({ hue, item }: { hue: string; item: Similar }) {
	return (
		<>
			<Poster hue={hue} src={imageUrl(item.coverRef)} title={item.title} />
			<div className="text-ink mt-2 text-[12.5px] leading-snug font-medium">
				{item.title}
			</div>
		</>
	);
}

function SimilarCard({ hue, item }: { hue: string; item: Similar }) {
	const pathId = workPathId(item.continuityId);
	const params = useMemo(
		() => (pathId === undefined ? undefined : { continuityId: pathId }),
		[pathId],
	);
	if (params === undefined) {
		return <CardBody hue={hue} item={item} />;
	}
	return (
		<Link params={params} to="/work/$continuityId">
			<CardBody hue={hue} item={item} />
		</Link>
	);
}

function IfYouLiked({ items }: { items: Similar[] }) {
	return (
		<Section>
			<SectionHead>{HEADING}</SectionHead>
			<div className="mt-4 grid grid-cols-3 gap-3.5 sm:grid-cols-5">
				{items.map((item, index) => (
					<SimilarCard
						hue={posterHue(index + 2)}
						item={item}
						key={item.continuityId}
					/>
				))}
			</div>
		</Section>
	);
}

export { IfYouLiked };
