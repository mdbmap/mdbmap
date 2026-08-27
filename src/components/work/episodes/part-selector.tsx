import { Fragment, useCallback } from "react";
import { tv } from "tailwind-variants";

import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WorkBlock } from "@/orpc/schema";

const ORDER_LABELS = {
	release: "Release",
	watch: "Watch",
} as const;

const tab = tv({
	base: "cursor-pointer border-b-[1.5px] pb-px",
	variants: {
		active: {
			false: "text-ink/50 border-transparent",
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

interface OrderTabProps {
	active: boolean;
	onSelect: (order: PresentationOrderSlug) => void;
	order: PresentationOrderSlug;
}

function OrderTab({ active, onSelect, order }: OrderTabProps) {
	const handleSelect = useCallback(() => {
		onSelect(order);
	}, [onSelect, order]);
	return (
		<button className={tab({ active })} onClick={handleSelect} type="button">
			{ORDER_LABELS[order]}
		</button>
	);
}

interface OrderToggleProps {
	onSelect: (order: PresentationOrderSlug) => void;
	order: PresentationOrderSlug | undefined;
	orders: readonly PresentationOrderSlug[];
}

function OrderToggle({ onSelect, order, orders }: OrderToggleProps) {
	return (
		<div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs">
			{orders.map((slug, index) => (
				<Fragment key={slug}>
					{index > 0 && <span className="text-ink/30">·</span>}
					<OrderTab active={slug === order} onSelect={onSelect} order={slug} />
				</Fragment>
			))}
		</div>
	);
}

interface PartTabsProps {
	episodeCount: number;
	onSelect: (index: number) => void;
	parts: WorkBlock[];
	selectedIndex: number;
	watchedCount: number;
}

function PartTabs({
	episodeCount,
	onSelect,
	parts,
	selectedIndex,
	watchedCount,
}: PartTabsProps) {
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
			<span className="text-ink/45 ml-auto">
				{`${watchedCount} of ${episodeCount} watched`}
			</span>
		</div>
	);
}

interface PartSelectorProps {
	episodeCount: number;
	onSelect: (index: number) => void;
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	parts: WorkBlock[];
	selectedIndex: number;
	watchedCount: number;
}

export function PartSelector({
	episodeCount,
	onSelect,
	onSelectOrder,
	order,
	orders,
	parts,
	selectedIndex,
	watchedCount,
}: PartSelectorProps) {
	const tabs = (
		<PartTabs
			episodeCount={episodeCount}
			onSelect={onSelect}
			parts={parts}
			selectedIndex={selectedIndex}
			watchedCount={watchedCount}
		/>
	);
	if (
		orders === undefined ||
		onSelectOrder === undefined ||
		orders.length < 2
	) {
		return <div>{tabs}</div>;
	}
	return (
		<div>
			{tabs}
			<OrderToggle onSelect={onSelectOrder} order={order} orders={orders} />
		</div>
	);
}
