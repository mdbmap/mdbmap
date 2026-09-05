import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeEvent, ReactNode, SubmitEvent } from "react";
import { useCallback, useState } from "react";

import {
	DEFAULT_RESEARCH_TIMING,
	llmProviderKinds,
	researchTimings,
} from "@/db/schema";
import type { LlmProviderKind, ResearchTiming } from "@/db/schema";
import { orpc } from "@/orpc/client";
import type { ProviderRow } from "@/orpc/schema";

import { buttonClass, inputClass } from "./styles.ts";

const TITLE = "Providers";
const EMPTY = "No providers yet.";
const DENIED = "Administrator access required.";
const LOAD_FAILED = "Could not load providers.";
const KEY_HINT = "API key is write-only — never shown again after save.";
const KEY_KEEP = "Leave blank to keep the current key.";
const KEY_KIND_CHANGE = "Enter a new API key when changing provider kind.";

const isAuthDenial = (error: unknown): boolean =>
	error instanceof ORPCError &&
	(error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED");

const messageOf = (error: unknown): string | undefined =>
	error instanceof Error ? error.message : undefined;

const LABEL = {
	add: "Add provider",
	apiKey: "API key",
	baseUrl: "Base URL",
	cancel: "Cancel",
	edit: "Edit",
	kind: "Kind",
	labelField: "Label",
	model: "Model",
	remove: "Remove",
	save: "Save",
	timing: "Research timing",
} as const;

const TIMING_COPY: Record<ResearchTiming, string> = {
	"after-residue": "After residue",
	"before-builds": "Before builds",
	off: "Off",
};

interface ProviderFormState {
	apiKey: string;
	baseUrl: string;
	kind: LlmProviderKind;
	label: string;
	model: string;
}

const emptyForm = (): ProviderFormState => ({
	apiKey: "",
	baseUrl: "",
	kind: "openai",
	label: "",
	model: "",
});

const formFromRow = (row: ProviderRow): ProviderFormState => ({
	apiKey: "",
	baseUrl: row.config.kind === "openai-compatible" ? row.config.baseUrl : "",
	kind: row.kind,
	label: row.label,
	model: row.config.model,
});

const kindFields = (form: ProviderFormState) => {
	if (form.kind === "openai-compatible") {
		return {
			baseUrl: form.baseUrl,
			kind: form.kind,
			model: form.model,
		};
	}
	return { kind: form.kind, model: form.model };
};

const buildCreateConfig = (form: ProviderFormState) => ({
	apiKey: form.apiKey,
	...kindFields(form),
});

const buildUpdateConfig = (form: ProviderFormState) => {
	const apiKey = form.apiKey.trim().length === 0 ? undefined : form.apiKey;
	return {
		...(apiKey === undefined ? {} : { apiKey }),
		...kindFields(form),
	};
};

function Field({ children, label }: { children: ReactNode; label: string }) {
	return (
		<label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
			{label}
			{children}
		</label>
	);
}

function TimingPolicy({
	onChange,
	pending,
	value,
}: {
	onChange: (timing: ResearchTiming) => void;
	pending: boolean;
	value: ResearchTiming;
}) {
	const onSelect = useCallback(
		(event: ChangeEvent<HTMLSelectElement>) => {
			const next = researchTimings.find(
				(option) => option === event.target.value,
			);
			if (next !== undefined) {
				onChange(next);
			}
		},
		[onChange],
	);

	return (
		<Field label={LABEL.timing}>
			<select
				className={inputClass}
				disabled={pending}
				onChange={onSelect}
				value={value}
			>
				{researchTimings.map((option) => (
					<option key={option} value={option}>
						{TIMING_COPY[option]}
					</option>
				))}
			</select>
		</Field>
	);
}

function KindField({
	onChange,
	value,
}: {
	onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
	value: LlmProviderKind;
}) {
	return (
		<Field label={LABEL.kind}>
			<select className={inputClass} onChange={onChange} value={value}>
				{llmProviderKinds.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
		</Field>
	);
}

function ProviderFormFields({
	editing,
	form,
	kindChanged,
	onApiKey,
	onBaseUrl,
	onKind,
	onLabel,
	onModel,
}: {
	editing: ProviderRow | undefined;
	form: ProviderFormState;
	kindChanged: boolean;
	onApiKey: (event: ChangeEvent<HTMLInputElement>) => void;
	onBaseUrl: (event: ChangeEvent<HTMLInputElement>) => void;
	onKind: (event: ChangeEvent<HTMLSelectElement>) => void;
	onLabel: (event: ChangeEvent<HTMLInputElement>) => void;
	onModel: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
	let keyPlaceholder: string | undefined;
	if (editing !== undefined) {
		keyPlaceholder = kindChanged ? KEY_KIND_CHANGE : KEY_KEEP;
	}

	return (
		<>
			<Field label={LABEL.labelField}>
				<input className={inputClass} onChange={onLabel} value={form.label} />
			</Field>
			<KindField onChange={onKind} value={form.kind} />
			<Field label={LABEL.model}>
				<input className={inputClass} onChange={onModel} value={form.model} />
			</Field>
			{form.kind === "openai-compatible" ? (
				<Field label={LABEL.baseUrl}>
					<input
						className={inputClass}
						onChange={onBaseUrl}
						value={form.baseUrl}
					/>
				</Field>
			) : undefined}
			<Field label={LABEL.apiKey}>
				<input
					autoComplete="off"
					className={inputClass}
					onChange={onApiKey}
					placeholder={keyPlaceholder}
					type="password"
					value={form.apiKey}
				/>
			</Field>
		</>
	);
}

function ProviderForm({
	editing,
	onCancel,
	onSubmit,
	pending,
}: {
	editing: ProviderRow | undefined;
	onCancel: () => void;
	onSubmit: (form: ProviderFormState) => void;
	pending: boolean;
}) {
	const [form, setForm] = useState<ProviderFormState>(() =>
		editing === undefined ? emptyForm() : formFromRow(editing),
	);
	const kindChanged = editing !== undefined && form.kind !== editing.kind;
	const needsFreshKey = kindChanged && form.apiKey.trim().length === 0;

	const onLabel = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setForm((current) => ({ ...current, label: event.target.value }));
	}, []);
	const onKind = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
		const next = llmProviderKinds.find(
			(option) => option === event.target.value,
		);
		if (next !== undefined) {
			setForm((current) => ({ ...current, kind: next }));
		}
	}, []);
	const onModel = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setForm((current) => ({ ...current, model: event.target.value }));
	}, []);
	const onBaseUrl = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setForm((current) => ({ ...current, baseUrl: event.target.value }));
	}, []);
	const onApiKey = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setForm((current) => ({ ...current, apiKey: event.target.value }));
	}, []);

	const submit = useCallback(
		(event: SubmitEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (form.label.trim().length === 0 || form.model.trim().length === 0) {
				return;
			}
			if (editing === undefined && form.apiKey.trim().length === 0) {
				return;
			}
			if (needsFreshKey) {
				return;
			}
			if (
				form.kind === "openai-compatible" &&
				form.baseUrl.trim().length === 0
			) {
				return;
			}
			onSubmit(form);
		},
		[editing, form, needsFreshKey, onSubmit],
	);

	return (
		<form
			className="flex flex-col gap-3 border border-neutral-300 p-4 dark:border-neutral-700"
			onSubmit={submit}
		>
			<div className="flex flex-wrap items-end gap-2">
				<ProviderFormFields
					editing={editing}
					form={form}
					kindChanged={kindChanged}
					onApiKey={onApiKey}
					onBaseUrl={onBaseUrl}
					onKind={onKind}
					onLabel={onLabel}
					onModel={onModel}
				/>
			</div>
			<p className="text-xs text-neutral-500 dark:text-neutral-400">
				{KEY_HINT}
			</p>
			{needsFreshKey ? (
				<p className="text-xs text-neutral-600 dark:text-neutral-400">
					{KEY_KIND_CHANGE}
				</p>
			) : undefined}
			<div className="flex gap-2">
				<button className={buttonClass} disabled={pending} type="submit">
					{editing === undefined ? LABEL.add : LABEL.save}
				</button>
				{editing === undefined ? undefined : (
					<button className={buttonClass} onClick={onCancel} type="button">
						{LABEL.cancel}
					</button>
				)}
			</div>
		</form>
	);
}

function ProviderCard({
	onEdit,
	onRemove,
	row,
}: {
	onEdit: (row: ProviderRow) => void;
	onRemove: (id: string) => void;
	row: ProviderRow;
}) {
	const edit = useCallback(() => {
		onEdit(row);
	}, [onEdit, row]);
	const remove = useCallback(() => {
		onRemove(row.id);
	}, [onRemove, row.id]);
	const detail =
		row.config.kind === "openai-compatible"
			? `${row.config.kind} · ${row.config.model} · ${row.config.baseUrl}`
			: `${row.config.kind} · ${row.config.model}`;

	return (
		<article className="flex items-center justify-between gap-4 border border-neutral-300 p-4 dark:border-neutral-700">
			<div className="flex flex-col gap-1">
				<span className="font-medium text-neutral-900 dark:text-neutral-50">
					{row.label}
				</span>
				<span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
					{detail}
				</span>
			</div>
			<div className="flex gap-2">
				<button className={buttonClass} onClick={edit} type="button">
					{LABEL.edit}
				</button>
				<button className={buttonClass} onClick={remove} type="button">
					{LABEL.remove}
				</button>
			</div>
		</article>
	);
}

function ProviderList({
	onEdit,
	onRemove,
	rows,
}: {
	onEdit: (row: ProviderRow) => void;
	onRemove: (id: string) => void;
	rows: readonly ProviderRow[];
}) {
	return (
		<div className="flex flex-col gap-2">
			{rows.map((row) => (
				<ProviderCard
					key={row.id}
					onEdit={onEdit}
					onRemove={onRemove}
					row={row}
				/>
			))}
		</div>
	);
}

export function ProvidersPanel() {
	const queryClient = useQueryClient();
	const listKey = orpc.providers.list.queryKey();
	const timingKey = orpc.providers.getTiming.queryKey();
	const listQuery = useQuery(orpc.providers.list.queryOptions());
	const timingQuery = useQuery(orpc.providers.getTiming.queryOptions());
	const [editing, setEditing] = useState<ProviderRow | undefined>(undefined);
	const [createFormKey, setCreateFormKey] = useState(0);

	const invalidate = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: listKey }),
			queryClient.invalidateQueries({ queryKey: timingKey }),
		]);
	}, [listKey, queryClient, timingKey]);

	const createMutation = useMutation(
		orpc.providers.create.mutationOptions({
			onSuccess: async () => {
				setCreateFormKey((key) => key + 1);
				await invalidate();
			},
		}),
	);
	const updateMutation = useMutation(
		orpc.providers.update.mutationOptions({
			onSuccess: async () => {
				setEditing(undefined);
				await invalidate();
			},
		}),
	);
	const removeMutation = useMutation(
		orpc.providers.remove.mutationOptions({ onSuccess: invalidate }),
	);
	const timingMutation = useMutation(
		orpc.providers.setTiming.mutationOptions({ onSuccess: invalidate }),
	);

	const {
		error: createError,
		isPending: creating,
		mutate: createMutate,
	} = createMutation;
	const {
		error: updateError,
		isPending: updating,
		mutate: updateMutate,
	} = updateMutation;
	const { error: removeError, mutate: removeMutate } = removeMutation;
	const {
		error: timingError,
		isPending: timingPending,
		mutate: timingMutate,
	} = timingMutation;

	const onCreate = useCallback(
		(form: ProviderFormState) => {
			createMutate({
				config: buildCreateConfig(form),
				label: form.label.trim(),
			});
		},
		[createMutate],
	);
	const onUpdate = useCallback(
		(form: ProviderFormState) => {
			if (editing === undefined) {
				return;
			}
			updateMutate({
				config: buildUpdateConfig(form),
				id: editing.id,
				label: form.label.trim(),
			});
		},
		[editing, updateMutate],
	);
	const onRemove = useCallback(
		(id: string) => {
			removeMutate({ id });
		},
		[removeMutate],
	);
	const onEdit = useCallback((row: ProviderRow) => {
		setEditing(row);
	}, []);
	const onCancelEdit = useCallback(() => {
		setEditing(undefined);
	}, []);
	const onTiming = useCallback(
		(timing: ResearchTiming) => {
			timingMutate({ timing });
		},
		[timingMutate],
	);

	const queryError = listQuery.error ?? timingQuery.error;
	const denied = queryError !== null && isAuthDenial(queryError);
	const loadFailed = queryError !== null && !denied;
	const mutationMessage =
		messageOf(createError) ??
		messageOf(updateError) ??
		messageOf(removeError) ??
		messageOf(timingError);

	let gate: ReactNode;
	if (denied) {
		gate = (
			<p className="text-sm text-neutral-600 dark:text-neutral-400">{DENIED}</p>
		);
	} else if (loadFailed) {
		gate = (
			<p className="text-sm text-neutral-600 dark:text-neutral-400">
				{LOAD_FAILED}
			</p>
		);
	} else {
		gate = (
			<>
				<TimingPolicy
					onChange={onTiming}
					pending={timingPending}
					value={timingQuery.data ?? DEFAULT_RESEARCH_TIMING}
				/>
				{editing === undefined ? (
					<ProviderForm
						editing={undefined}
						key={`create-${String(createFormKey)}`}
						onCancel={onCancelEdit}
						onSubmit={onCreate}
						pending={creating}
					/>
				) : (
					<ProviderForm
						editing={editing}
						key={editing.id}
						onCancel={onCancelEdit}
						onSubmit={onUpdate}
						pending={updating}
					/>
				)}
			</>
		);
	}

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
			<h1 className="font-mono text-lg font-medium text-neutral-900 dark:text-neutral-50">
				{TITLE}
			</h1>
			{gate}
			{mutationMessage === undefined ? undefined : (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{mutationMessage}
				</p>
			)}
			{listQuery.data?.length === 0 ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{EMPTY}
				</p>
			) : undefined}
			{listQuery.data === undefined ? undefined : (
				<ProviderList
					onEdit={onEdit}
					onRemove={onRemove}
					rows={listQuery.data}
				/>
			)}
		</main>
	);
}
