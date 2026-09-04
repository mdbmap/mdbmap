import { Fragment, useCallback } from "react";
import { tv } from "tailwind-variants";

import {
	locatorsOf,
	watchedCount as watchedOnPart,
} from "@/components/work/parts";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WorkBlock } from "@/orpc/schema";

const ORDER_LABELS = {
	release: "Release",
	watch: "Watch",
} as const;

const MARK_PART = "mark part watched";
const CLEAR_PART = "clear part watched";

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

interface PartMarkControlProps {
	onMark: (locators: string[], watched: boolean) => void;
	part: WorkBlock;
}

function PartMarkControl({ onMark, part }: PartMarkControlProps) {
	const locators = locatorsOf(part);
	const marked = watchedOnPart(part);
	const allWatched = locators.length > 0 && marked === locators.length;
	const handleMark = useCallback(() => {
		onMark(locators, !allWatched);
	}, [allWatched, locators, onMark]);
	if (locators.length === 0) {
		return;
	}
	return (
		<button
			className="text-accent mt-2 cursor-pointer font-mono text-[11px]"
			onClick={handleMark}
			type="button"
		>
			{allWatched ? CLEAR_PART : MARK_PART}
		</button>
	);
}

interface PartSelectorProps {
	episodeCount: number;
	onMarkPart: (locators: string[], watched: boolean) => void;
	onSelect: (index: number) => void;
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	parts: WorkBlock[];
	selectedIndex: number;
	watchedCount: number;
}

function PartSelector({
	episodeCount,
	onMarkPart,
	onSelect,
	onSelectOrder,
	order,
	orders,
	parts,
	selectedIndex,
	watchedCount,
}: PartSelectorProps) {
	const selected = parts[selectedIndex];
	const tabs = (
		<PartTabs
			episodeCount={episodeCount}
			onSelect={onSelect}
			parts={parts}
			selectedIndex={selectedIndex}
			watchedCount={watchedCount}
		/>
	);
	const mark =
		selected === undefined ? undefined : (
			<PartMarkControl onMark={onMarkPart} part={selected} />
		);
	if (
		orders === undefined ||
		onSelectOrder === undefined ||
		orders.length < 2
	) {
		return (
			<div>
				{tabs}
				{mark}
			</div>
		);
	}
	return (
		<div>
			{tabs}
			{mark}
			<OrderToggle onSelect={onSelectOrder} order={order} orders={orders} />
		</div>
	);
}

export { CLEAR_PART, MARK_PART, PartSelector };
