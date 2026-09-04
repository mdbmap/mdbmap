const COMMUNITY_LABEL = "mdbmap average";
const EM_DASH = "—";

const compact = new Intl.NumberFormat("en", {
	maximumFractionDigits: 1,
	notation: "compact",
});

interface CommunityRowProps {
	count: number;
	mean: number | undefined;
}

function CommunityRow({ count, mean }: CommunityRowProps) {
	return (
		<div className="border-line mt-2.5 flex items-baseline gap-1.5 border-b pb-2.5 font-mono text-xs">
			<span className="text-accent mr-auto">{COMMUNITY_LABEL}</span>
			<span>{mean ?? EM_DASH}</span>
			<span className="text-ink/35" data-votes={count}>
				{compact.format(count)}
			</span>
		</div>
	);
}

export { CommunityRow };
