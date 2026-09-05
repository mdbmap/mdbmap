import { useCallback } from "react";
import type { ChangeEvent } from "react";

import type { MediaKind } from "@/engine";

const QUERY_LABEL = "Title";
const QUERY_PLACEHOLDER = "Title…";
const KIND_ALL = "all";
const KIND_GROUP_LABEL = "Media kind";

const kindTabs = [KIND_ALL, "anime", "film", "tv"] as const;

const kindLabels: Record<(typeof kindTabs)[number], string> = {
	all: "Any kind",
	anime: "Anime",
	film: "Film",
	tv: "TV",
};

interface KindTabProps {
	active: boolean;
	onSelect: (kind: MediaKind | undefined) => void;
	tab: (typeof kindTabs)[number];
}

function KindTab({ active, onSelect, tab }: KindTabProps) {
	const handleSelect = useCallback(() => {
		onSelect(tab === KIND_ALL ? undefined : tab);
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
			{kindLabels[tab]}
		</button>
	);
}

interface QueryFieldProps {
	onQueryChange: (query: string) => void;
	query: string;
}

function QueryField({ onQueryChange, query }: QueryFieldProps) {
	const handleChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			onQueryChange(event.target.value);
		},
		[onQueryChange],
	);
	return (
		<label className="text-ink/50 flex min-w-0 flex-1 items-center gap-2 font-mono text-[11px] tracking-[0.08em] uppercase">
			{QUERY_LABEL}
			<input
				aria-label={QUERY_LABEL}
				autoCapitalize="off"
				autoComplete="off"
				autoCorrect="off"
				className="text-ink/80 border-line min-w-0 flex-1 border bg-transparent px-2 py-1 font-mono text-[11px] tracking-normal normal-case outline-none focus:border-[var(--color-accent)]"
				onChange={handleChange}
				placeholder={QUERY_PLACEHOLDER}
				spellCheck={false}
				type="search"
				value={query}
			/>
		</label>
	);
}

interface LibraryFindProps {
	kind: MediaKind | undefined;
	onKindChange: (kind: MediaKind | undefined) => void;
	onQueryChange: (query: string) => void;
	query: string;
}

function LibraryFind({
	kind,
	onKindChange,
	onQueryChange,
	query,
}: LibraryFindProps) {
	return (
		<div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<QueryField onQueryChange={onQueryChange} query={query} />
			<fieldset
				aria-label={KIND_GROUP_LABEL}
				className="m-0 flex flex-wrap gap-2 border-0 p-0"
			>
				{kindTabs.map((tab) => (
					<KindTab
						active={tab === KIND_ALL ? kind === undefined : kind === tab}
						key={tab}
						onSelect={onKindChange}
						tab={tab}
					/>
				))}
			</fieldset>
		</div>
	);
}

export { LibraryFind };
