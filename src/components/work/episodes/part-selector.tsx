import { Fragment, useCallback } from "react";
import { tv } from "tailwind-variants";

import {
	locatorsOf,
	watchedCount as watchedOnPart,
} from "@/components/work/parts";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { CommunityOrderRef, WorkBlock } from "@/orpc/schema";

const ORDER_LABELS = {
	release: "Release",
	watch: "Watch",
} as const;

const MARK_PART = "mark part watched";
const CLEAR_PART = "clear part watched";
const PROPOSE = "Propose order";

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

interface CommunityOrderTabProps {
	active: boolean;
	name: string;
	onSelect: (id: number) => void;
	proposalId: number;
}

function CommunityOrderTab({
	active,
	name,
	onSelect,
	proposalId,
}: CommunityOrderTabProps) {
	const handleSelect = useCallback(() => {
		onSelect(proposalId);
	}, [onSelect, proposalId]);
	return (
		<button className={tab({ active })} onClick={handleSelect} type="button">
			{name}
		</button>
	);
}

interface OrderToggleProps {
	communityOrders: readonly CommunityOrderRef[];
	onPropose?: (() => void) | undefined;
	onSelect: (order: PresentationOrderSlug) => void;
	onSelectProposal?: ((proposalId: number) => void) | undefined;
	order: PresentationOrderSlug | undefined;
	orders: readonly PresentationOrderSlug[];
	selectedProposalId?: number | undefined;
}

function OrderToggle({
	communityOrders,
	onPropose,
	onSelect,
	onSelectProposal,
	order,
	orders,
	selectedProposalId,
}: OrderToggleProps) {
	const builtins =
		orders.length >= 2 || communityOrders.length > 0 ? orders : [];
	return (
		<div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs">
			{builtins.map((slug, index) => (
				<Fragment key={slug}>
					{index > 0 && <span className="text-ink/30">·</span>}
					<OrderTab
						active={selectedProposalId === undefined && slug === order}
						onSelect={onSelect}
						order={slug}
					/>
				</Fragment>
			))}
			{communityOrders.map((communityOrder, index) => (
				<Fragment key={communityOrder.id}>
					{(builtins.length > 0 || index > 0) && (
						<span className="text-ink/30">·</span>
					)}
					{onSelectProposal === undefined ? (
						<span className="text-ink/50">{communityOrder.name}</span>
					) : (
						<CommunityOrderTab
							active={communityOrder.id === selectedProposalId}
							name={communityOrder.name}
							onSelect={onSelectProposal}
							proposalId={communityOrder.id}
						/>
					)}
				</Fragment>
			))}
			{onPropose === undefined ? undefined : (
				<>
					{(builtins.length > 0 || communityOrders.length > 0) && (
						<span className="text-ink/30">·</span>
					)}
					<button
						className="text-ink/50 hover:text-accent cursor-pointer"
						onClick={onPropose}
						type="button"
					>
						{PROPOSE}
					</button>
				</>
			)}
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

const EMPTY_COMMUNITY_ORDERS: readonly CommunityOrderRef[] = [];

interface PartSelectorProps {
	communityOrders?: readonly CommunityOrderRef[] | undefined;
	episodeCount: number;
	onMarkPart: (locators: string[], watched: boolean) => void;
	onPropose?: (() => void) | undefined;
	onSelect: (index: number) => void;
	onSelectOrder?: ((order: PresentationOrderSlug) => void) | undefined;
	onSelectProposal?: ((proposalId: number) => void) | undefined;
	order?: PresentationOrderSlug | undefined;
	orders?: readonly PresentationOrderSlug[] | undefined;
	parts: WorkBlock[];
	selectedIndex: number;
	selectedProposalId?: number | undefined;
	watchedCount: number;
}

function PartSelector({
	communityOrders = EMPTY_COMMUNITY_ORDERS,
	episodeCount,
	onMarkPart,
	onPropose,
	onSelect,
	onSelectOrder,
	onSelectProposal,
	order,
	orders,
	parts,
	selectedIndex,
	selectedProposalId,
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
	const showOrders =
		onSelectOrder !== undefined &&
		orders !== undefined &&
		(orders.length >= 2 ||
			communityOrders.length > 0 ||
			onPropose !== undefined);
	if (!showOrders || orders === undefined || onSelectOrder === undefined) {
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
			<OrderToggle
				communityOrders={communityOrders}
				onPropose={onPropose}
				onSelect={onSelectOrder}
				onSelectProposal={onSelectProposal}
				order={order}
				orders={orders}
				selectedProposalId={selectedProposalId}
			/>
		</div>
	);
}

export { CLEAR_PART, MARK_PART, PartSelector };
