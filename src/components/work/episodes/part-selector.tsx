import { Fragment, useCallback } from "react";
import { tv } from "tailwind-variants";

import type { PartView } from "@/orpc/schema";

const tab = tv({
	base: "cursor-pointer border-b-[1.5px] pb-px",
	variants: {
		active: {
			false: "border-transparent text-ink/50",
			true: "border-accent text-accent",
		},
	},
});

interface PartTabProps {
	active: boolean;
	index: number;
	label: string;
	onSelect: (index: number) => void;
}

function PartTab({ active, index, label, onSelect }: PartTabProps) {
	const handleSelect = useCallback(() => {
		onSelect(index);
	}, [index, onSelect]);
	return (
		<button className={tab({ active })} onClick={handleSelect} type="button">
			{label}
		</button>
	);
}

interface PartSelectorProps {
	episodeCount: number;
	onSelect: (index: number) => void;
	parts: PartView[];
	selectedIndex: number;
	watchedCount: number;
}

export function PartSelector({
	episodeCount,
	onSelect,
	parts,
	selectedIndex,
	watchedCount,
}: PartSelectorProps) {
	return (
		<div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-xs">
			{parts.map((part, index) => (
				<Fragment key={part.rateableUnit.key}>
					{index > 0 && <span className="text-ink/30">→</span>}
					<PartTab
						active={index === selectedIndex}
						index={index}
						label={part.label}
						onSelect={onSelect}
					/>
				</Fragment>
			))}
			<span className="ml-auto text-ink/45">
				{`${watchedCount} of ${episodeCount} watched`}
			</span>
		</div>
	);
}
