import { useCallback } from "react";
import type { ChangeEvent } from "react";

import type { WatchStatus } from "@/db/schema";
import { watchStatuses } from "@/db/schema";
import { librarySorts } from "@/orpc/schema";
import type { LibrarySort } from "@/orpc/schema";

import { isLibrarySort } from "./library-params";

const SORT_LABEL = "Sort";
const STATUS_ALL = "all";

const statusLabels: Record<WatchStatus | typeof STATUS_ALL, string> = {
	all: "All",
	completed: "Completed",
	dropped: "Dropped",
	on_hold: "On hold",
	plan_to_watch: "Plan to watch",
	rewatching: "Rewatching",
	watching: "Watching",
};

const sortLabels: Record<LibrarySort, string> = {
	activity: "Recent activity",
	rating: "Personal rating",
	title: "Title",
};

const statusTabs = [STATUS_ALL, ...watchStatuses] as const;

interface StatusTabProps {
	active: boolean;
	onSelect: (status: WatchStatus | undefined) => void;
	tab: (typeof statusTabs)[number];
}

function StatusTab({ active, onSelect, tab }: StatusTabProps) {
	const handleSelect = useCallback(() => {
		onSelect(tab === STATUS_ALL ? undefined : tab);
	}, [onSelect, tab]);
	return (
		<button
			aria-pressed={active}
			className={
				active
					? "text-accent border-accent border-b font-mono text-[11px] tracking-[0.08em] uppercase"
					: "text-ink/45 hover:text-ink/80 border-b border-transparent font-mono text-[11px] tracking-[0.08em] uppercase"
			}
			onClick={handleSelect}
			type="button"
		>
			{statusLabels[tab]}
		</button>
	);
}

interface SortSelectProps {
	onSortChange: (sort: LibrarySort) => void;
	sort: LibrarySort;
}

function SortSelect({ onSortChange, sort }: SortSelectProps) {
	const handleChange = useCallback(
		(event: ChangeEvent<HTMLSelectElement>) => {
			const { value } = event.target;
			if (isLibrarySort(value)) {
				onSortChange(value);
			}
		},
		[onSortChange],
	);
	return (
		<label className="text-ink/50 flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] uppercase">
			{SORT_LABEL}
			<select
				className="text-ink/80 border-line border bg-transparent px-2 py-1 font-mono text-[11px] tracking-normal normal-case"
				onChange={handleChange}
				value={sort}
			>
				{librarySorts.map((value) => (
					<option key={value} value={value}>
						{sortLabels[value]}
					</option>
				))}
			</select>
		</label>
	);
}

interface LibraryControlsProps {
	onSortChange: (sort: LibrarySort) => void;
	onStatusChange: (status: WatchStatus | undefined) => void;
	sort: LibrarySort;
	status: WatchStatus | undefined;
}

function LibraryControls({
	onSortChange,
	onStatusChange,
	sort,
	status,
}: LibraryControlsProps) {
	return (
		<div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex flex-wrap gap-2">
				{statusTabs.map((tab) => (
					<StatusTab
						active={tab === STATUS_ALL ? status === undefined : status === tab}
						key={tab}
						onSelect={onStatusChange}
						tab={tab}
					/>
				))}
			</div>
			<SortSelect onSortChange={onSortChange} sort={sort} />
		</div>
	);
}

export { LibraryControls };
