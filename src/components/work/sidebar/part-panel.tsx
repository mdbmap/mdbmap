import { useCallback } from "react";

import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { useSelectedPart } from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { useRequireAuth } from "@/integrations/better-auth/require-auth";
import type { ServiceRating, WorkBlock } from "@/orpc/schema";

import { ScoreSelect } from "./score-select";
import { useWorkTracking } from "./use-work-tracking";

const NO_PARTS = "No parts";
const THIS_PART = "This part";
const COMMUNITY_LABEL = "mdbmap average";
const YOUR_SCORE = "your score";
const EM_DASH = "—";

const compact = new Intl.NumberFormat("en", {
	maximumFractionDigits: 1,
	notation: "compact",
});

const airedRange = (part: WorkBlock) =>
	[part.airedFrom, part.airedTo]
		.filter((edge) => edge !== undefined)
		.join(" – ");

function CommunityRow({
	count,
	mean,
}: {
	count: number;
	mean: number | undefined;
}) {
	return (
		<div className="border-line mt-2.5 flex items-baseline gap-1.5 border-b pb-2.5 font-mono text-xs">
			<span className="text-accent mr-auto">{COMMUNITY_LABEL}</span>
			<span>{mean ?? EM_DASH}</span>
			<span className="text-ink/35">{compact.format(count)}</span>
		</div>
	);
}

function ServiceRow({ rating }: { rating: ServiceRating }) {
	return (
		<div className="flex items-baseline gap-1.5">
			<span className="text-ink/75 mr-auto">{rating.service}</span>
			<span>{rating.score}</span>
			<span className="text-ink/35">{`/${rating.scale}`}</span>
			<span className="text-ink/35">{compact.format(rating.votes)}</span>
		</div>
	);
}

function ServiceList({ ratings }: { ratings: ServiceRating[] }) {
	return (
		<div className="mt-2.5 flex flex-col gap-2 font-mono text-[11.5px]">
			{ratings.map((rating) => (
				<ServiceRow key={rating.service} rating={rating} />
			))}
		</div>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<span className="text-ink/35">{label}</span>
			{value}
		</div>
	);
}

function PartFacts({ aired, part }: { aired: string; part: WorkBlock }) {
	return (
		<div className="text-ink/60 mt-3 flex flex-col gap-1.5 font-mono text-[11.5px] leading-normal">
			{aired !== "" && <Fact label="aired " value={aired} />}
			{part.kind === "part" && (
				<Fact label="episodes " value={String(part.episodeCount)} />
			)}
		</div>
	);
}

interface PartPanelProps {
	continuityId: string;
	order?: PresentationOrderSlug | undefined;
	parts: WorkBlock[];
}

interface PartDetailsProps {
	onRate: (score: number | undefined) => void;
	part: WorkBlock;
}

function PartDetails({ onRate, part }: PartDetailsProps) {
	return (
		<Section>
			<Label>{`${part.label} · this part`}</Label>
			<CommunityRow
				count={part.communityScore.count}
				mean={part.communityScore.mean}
			/>
			{part.serviceRatings.length > 0 && (
				<ServiceList ratings={part.serviceRatings} />
			)}
			<div className="mt-3 flex items-baseline justify-between font-mono text-[11.5px]">
				<span className="text-ink/35">{YOUR_SCORE}</span>
				<ScoreSelect
					label={`Your score for ${part.label}`}
					onChange={onRate}
					size="inline"
					value={part.personalRating}
				/>
			</div>
			<PartFacts aired={airedRange(part)} part={part} />
		</Section>
	);
}

function PartPanel({ continuityId, order, parts }: PartPanelProps) {
	const { selectedPart } = useSelectedPart(parts);
	const { setRating } = useWorkTracking(continuityId, order);
	const { authDialog, requireAuth } = useRequireAuth();
	const ratePart = useCallback(
		(score: number | undefined) => {
			requireAuth(() => {
				if (selectedPart) {
					setRating(selectedPart.rateableUnit, score);
				}
			});
		},
		[requireAuth, selectedPart, setRating],
	);

	if (selectedPart === undefined) {
		return (
			<Section>
				<Label>{THIS_PART}</Label>
				<p className="text-ink/40 mt-2 font-mono text-[11px]">{NO_PARTS}</p>
				{authDialog}
			</Section>
		);
	}

	return (
		<>
			<PartDetails onRate={ratePart} part={selectedPart} />
			{authDialog}
		</>
	);
}

export { PartDetails, PartPanel };
