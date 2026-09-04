import { Label } from "@/components/ui/label";
import type { MediaKind } from "@/engine";
import type { WorkView } from "@/orpc/schema";

type WorkHeaderView = WorkView["header"];

interface BannerProps {
	episodeTotal: number;
	header: WorkHeaderView;
	mediaKind: MediaKind;
	partCount: number;
}

// Snapshot refs (e.g. `anidb:16947/cover`) become resolvable URLs in #5/#6; until
// then only absolute http refs are displayable, everything else falls back to the
// ruled placeholder — the prototype's "image absent" treatment.
const displayUrl = (ref: string | undefined) =>
	ref !== undefined && /^https?:\/\//u.test(ref) ? ref : undefined;

const metaLine = (
	header: WorkHeaderView,
	partCount: number,
	episodeTotal: number,
) => {
	const genres =
		header.genres.length === 0 ? undefined : header.genres.join(" · ");
	const runtime =
		header.runtimeMinutes === undefined
			? undefined
			: `${header.runtimeMinutes} min`;
	const segments = [
		header.nativeTitle,
		"continuity",
		`${partCount} parts`,
		`${episodeTotal} ep`,
		header.span,
		genres,
		runtime,
		header.productionStatus,
	];
	return segments
		.filter((segment) => segment !== undefined && segment !== "")
		.join(" · ");
};

function Backdrop({ src }: { src: string | undefined }) {
	if (src === undefined) {
		return <div className="still-340 absolute inset-0" />;
	}
	return (
		<img alt="" className="absolute inset-0 size-full object-cover" src={src} />
	);
}

function Cover({ src, title }: { src: string | undefined; title: string }) {
	if (src === undefined) {
		return (
			<div className="poster-340 border-line aspect-[2/3] w-[152px] shrink-0 border" />
		);
	}
	return (
		<img
			alt={`${title} cover`}
			className="border-line aspect-[2/3] w-[152px] shrink-0 border object-cover"
			src={src}
		/>
	);
}

function TitleBlock({
	episodeTotal,
	header,
	mediaKind,
	partCount,
}: BannerProps) {
	return (
		<div className="min-w-0 flex-1 pb-1.5">
			<Label>{mediaKind.toUpperCase()}</Label>
			<h1 className="text-ink/95 mt-1 font-serif text-4xl leading-tight italic">
				{header.title}
			</h1>
			<p className="text-ink/60 mt-2 font-mono text-xs">
				{metaLine(header, partCount, episodeTotal)}
			</p>
		</div>
	);
}

function BannerFooter({
	episodeTotal,
	header,
	mediaKind,
	partCount,
}: BannerProps) {
	return (
		<div className="absolute inset-x-0 bottom-0 flex items-end gap-6 p-8">
			<Cover src={displayUrl(header.coverRef)} title={header.title} />
			<TitleBlock
				episodeTotal={episodeTotal}
				header={header}
				mediaKind={mediaKind}
				partCount={partCount}
			/>
		</div>
	);
}

export function Banner({
	episodeTotal,
	header,
	mediaKind,
	partCount,
}: BannerProps) {
	return (
		<section className="relative aspect-video max-h-[440px] w-full overflow-hidden">
			<Backdrop src={displayUrl(header.backdropRef)} />
			<div className="from-bg absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t to-transparent" />
			<BannerFooter
				episodeTotal={episodeTotal}
				header={header}
				mediaKind={mediaKind}
				partCount={partCount}
			/>
		</section>
	);
}
