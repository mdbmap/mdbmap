import { useMutation } from "@tanstack/react-query";
import type { ChangeEvent } from "react";
import { useCallback, useMemo, useState } from "react";
import { tv } from "tailwind-variants";

import type { ImportDraft, ImportProvider } from "@/lib/library-import";
import { orpc } from "@/orpc/client";

const HEADING = "Library import";
const BODY =
	"Load a MAL or AniList draft, resolve ambiguous matches, then apply status, scores, and progress. Newer local edits are kept unless you overwrite them.";
const LOAD_LABEL = "Load draft";
const LOAD_PENDING = "Loading draft…";
const APPLY_LABEL = "Apply draft";
const APPLY_PENDING = "Applying…";
const OVERWRITE_LABEL = "Overwrite newer local rows";
const MATCHED_LABEL = "Matched";
const AMBIGUOUS_LABEL = "Ambiguous";
const UNMATCHED_LABEL = "Unmatched";
const SKIP_LABEL = "Skip";
const MAL_LABEL = "MyAnimeList";
const ANILIST_LABEL = "AniList";
const PROVIDER_LABEL = "Import provider";

const PROVIDERS = [
	"anilist",
	"mal",
] as const satisfies readonly ImportProvider[];

const isImportProvider = (value: string): value is ImportProvider =>
	(PROVIDERS as readonly string[]).includes(value);

const providerLabelOf = (provider: ImportProvider): string => {
	switch (provider) {
		case "anilist": {
			return ANILIST_LABEL;
		}
		case "mal": {
			return MAL_LABEL;
		}
	}
};

const section = tv({
	base: "border-line flex flex-col gap-4 border-t pt-6",
});

const heading = tv({
	base: "font-display text-ink text-lg tracking-tight",
});

const copy = tv({
	base: "text-ink/70 text-sm leading-relaxed",
});

const controls = tv({
	base: "[&_button]:border-line [&_button]:text-ink [&_button]:hover:border-accent [&_button]:hover:text-accent [&_select]:border-line [&_select]:bg-paper [&_select]:text-ink flex flex-wrap items-center gap-3 [&_button]:inline-flex [&_button]:cursor-pointer [&_button]:items-center [&_button]:border [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2 [&_button]:font-mono [&_button]:text-xs [&_button]:disabled:cursor-wait [&_button]:disabled:opacity-50 [&_select]:border [&_select]:px-2 [&_select]:py-1 [&_select]:font-mono [&_select]:text-xs",
});

const list = tv({
	base: "text-ink/80 flex flex-col gap-2 font-mono text-xs",
});

const errorText = tv({
	base: "text-accent font-mono text-xs",
});

interface MatchedListProps {
	readonly draft: ImportDraft;
}

function MatchedList({ draft }: MatchedListProps) {
	return (
		<div className="flex flex-col gap-2">
			<p
				className={copy()}
			>{`${MATCHED_LABEL} (${String(draft.matched.length)})`}</p>
			{draft.matched.map((item) => (
				<p className={list()} key={item.entry.externalTitleId}>
					{`${item.entry.title ?? item.entry.externalTitleId} → ${item.continuityId}`}
				</p>
			))}
		</div>
	);
}

interface AmbiguousListProps {
	readonly draft: ImportDraft;
	readonly onResolve: (externalTitleId: string, continuityId: string) => void;
	readonly resolutions: ReadonlyMap<string, string>;
}

function AmbiguousRow({
	continuityIds,
	label,
	onResolve,
	selected,
	externalTitleId,
}: {
	readonly continuityIds: readonly string[];
	readonly externalTitleId: string;
	readonly label: string;
	readonly onResolve: (externalTitleId: string, continuityId: string) => void;
	readonly selected: string;
}) {
	const onChange = useCallback(
		(event: ChangeEvent<HTMLSelectElement>) => {
			onResolve(externalTitleId, event.target.value);
		},
		[externalTitleId, onResolve],
	);
	return (
		<div className="border-line flex flex-col gap-1 border p-2">
			<p className={copy()}>{label}</p>
			<select
				aria-label={`${AMBIGUOUS_LABEL} ${label}`}
				className="border-line bg-paper text-ink max-w-md border px-2 py-1 font-mono text-xs"
				onChange={onChange}
				value={selected}
			>
				<option value="">{SKIP_LABEL}</option>
				{continuityIds.map((id) => (
					<option key={id} value={id}>
						{id}
					</option>
				))}
			</select>
		</div>
	);
}

function AmbiguousList({ draft, onResolve, resolutions }: AmbiguousListProps) {
	return (
		<div className="flex flex-col gap-2">
			<p
				className={copy()}
			>{`${AMBIGUOUS_LABEL} (${String(draft.ambiguous.length)})`}</p>
			{draft.ambiguous.map((item) => (
				<AmbiguousRow
					continuityIds={item.continuityIds}
					externalTitleId={item.entry.externalTitleId}
					key={item.entry.externalTitleId}
					label={item.entry.title ?? item.entry.externalTitleId}
					onResolve={onResolve}
					selected={resolutions.get(item.entry.externalTitleId) ?? ""}
				/>
			))}
		</div>
	);
}

interface UnmatchedListProps {
	readonly draft: ImportDraft;
}

function UnmatchedList({ draft }: UnmatchedListProps) {
	return (
		<div className="flex flex-col gap-2">
			<p
				className={copy()}
			>{`${UNMATCHED_LABEL} (${String(draft.unmatched.length)})`}</p>
			{draft.unmatched.map((item) => (
				<p className={list()} key={item.entry.externalTitleId}>
					{`${item.entry.title ?? item.entry.externalTitleId} (${item.reason})`}
				</p>
			))}
		</div>
	);
}

function ProviderSelect({
	onChange,
	provider,
}: {
	readonly onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
	readonly provider: ImportProvider;
}) {
	return (
		<select aria-label={PROVIDER_LABEL} onChange={onChange} value={provider}>
			{PROVIDERS.map((value) => (
				<option key={value} value={value}>
					{providerLabelOf(value)}
				</option>
			))}
		</select>
	);
}

function OverwriteToggle({
	checked,
	onChange,
}: {
	readonly checked: boolean;
	readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
	return (
		<label className="text-ink/70 flex items-center gap-2 font-mono text-xs">
			<input checked={checked} onChange={onChange} type="checkbox" />
			{OVERWRITE_LABEL}
		</label>
	);
}

function LibraryImportPanel() {
	const [provider, setProvider] = useState<ImportProvider>("mal");
	const [draft, setDraft] = useState<ImportDraft | undefined>(undefined);
	const [resolutions, setResolutions] = useState<ReadonlyMap<string, string>>(
		() => new Map(),
	);
	const [overwriteLocal, setOverwriteLocal] = useState(false);
	const [report, setReport] = useState<string | undefined>(undefined);

	const draftMutation = useMutation(
		(provider === "mal"
			? orpc.import.draftMal
			: orpc.import.draftAnilist
		).mutationOptions({
			onSuccess: (next) => {
				setDraft(next);
				setResolutions(new Map());
				setReport(undefined);
			},
		}),
	);

	const applyMutation = useMutation(
		orpc.import.apply.mutationOptions({
			onSuccess: (result) => {
				setReport(
					`Applied ${String(result.applied)}; skipped newer local ${String(result.skippedNewerLocal)}; unresolved ${String(result.skippedUnresolved)}; unmatched ${String(result.skippedUnmatched)}.`,
				);
			},
		}),
	);

	const onProviderChange = useCallback(
		(event: ChangeEvent<HTMLSelectElement>) => {
			const next = event.target.value;
			if (!isImportProvider(next)) {
				return;
			}
			setProvider(next);
			setDraft(undefined);
			setReport(undefined);
		},
		[],
	);

	const onResolve = useCallback(
		(externalTitleId: string, continuityId: string) => {
			setResolutions((prior) => {
				const next = new Map(prior);
				if (continuityId === "") {
					next.delete(externalTitleId);
				} else {
					next.set(externalTitleId, continuityId);
				}
				return next;
			});
		},
		[],
	);

	const onLoad = useCallback(() => {
		draftMutation.mutate({});
	}, [draftMutation]);

	const onApply = useCallback(() => {
		applyMutation.mutate({
			fingerprint: draft?.fingerprint ?? "",
			overwriteLocal,
			provider,
			resolutions: [...resolutions.entries()].map(
				([externalTitleId, continuityId]) => ({
					continuityId,
					externalTitleId,
				}),
			),
		});
	}, [applyMutation, draft, overwriteLocal, provider, resolutions]);

	const onOverwriteChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			setOverwriteLocal(event.target.checked);
		},
		[],
	);

	const errorMessage = useMemo(
		() => draftMutation.error?.message ?? applyMutation.error?.message,
		[applyMutation.error, draftMutation.error],
	);

	return (
		<section className={section()}>
			<div className="flex flex-col gap-2">
				<h2 className={heading()}>{HEADING}</h2>
				<p className={copy()}>{BODY}</p>
			</div>
			<div className={controls()}>
				<ProviderSelect onChange={onProviderChange} provider={provider} />
				<button
					disabled={draftMutation.isPending}
					onClick={onLoad}
					type="button"
				>
					{draftMutation.isPending ? LOAD_PENDING : LOAD_LABEL}
				</button>
				<button
					disabled={
						draft === undefined ||
						draft.fingerprint.length === 0 ||
						applyMutation.isPending
					}
					onClick={onApply}
					type="button"
				>
					{applyMutation.isPending ? APPLY_PENDING : APPLY_LABEL}
				</button>
				<OverwriteToggle
					checked={overwriteLocal}
					onChange={onOverwriteChange}
				/>
			</div>
			{draft === undefined ? undefined : <MatchedList draft={draft} />}
			{draft === undefined ? undefined : (
				<AmbiguousList
					draft={draft}
					onResolve={onResolve}
					resolutions={resolutions}
				/>
			)}
			{draft === undefined ? undefined : <UnmatchedList draft={draft} />}
			{report === undefined ? undefined : <p className={copy()}>{report}</p>}
			{errorMessage === undefined ? undefined : (
				<p className={errorText()}>{errorMessage}</p>
			)}
		</section>
	);
}

export { LibraryImportPanel };
