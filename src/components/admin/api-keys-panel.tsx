import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeEvent, SubmitEvent } from "react";
import { useCallback, useState } from "react";

import type { ApiKeyPlan } from "@/db/schema";
import { orpc } from "@/orpc/client";
import { ApiKeyPlanSchema } from "@/orpc/schema";
import type { ApiKeyRow } from "@/orpc/schema";

import { buttonClass, inputClass } from "./styles.ts";

// The internal API-key console (issue #55, ADR-0006). Deliberately plain, like
// the moderation queue (#46) — mint shows the secret exactly once in-page and
// never persists or re-fetches it; every action is gated on the admin role.

const TITLE = "API keys";
const EMPTY = "No keys yet.";
const DENIED = "Administrator access required.";
const SECRET_NOTICE = "Copy this secret now — it will not be shown again.";

const STATUS_LABEL = { active: "active", revoked: "revoked" } as const;

const LABEL = {
	dismiss: "Dismiss",
	labelField: "Label",
	mint: "Mint key",
	planField: "Plan",
	revoke: "Revoke",
} as const;

function SecretBanner({
	onDismiss,
	secret,
}: {
	onDismiss: () => void;
	secret: string;
}) {
	return (
		<div className="flex flex-col gap-2 border border-amber-400 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950">
			<p className="text-amber-900 dark:text-amber-100">{SECRET_NOTICE}</p>
			<code className="overflow-x-auto bg-white p-2 font-mono text-xs dark:bg-neutral-900">
				{secret}
			</code>
			<button className={buttonClass} onClick={onDismiss} type="button">
				{LABEL.dismiss}
			</button>
		</div>
	);
}

interface PlanFieldProps {
	onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
	value: ApiKeyPlan;
}

function PlanField({ onChange, value }: PlanFieldProps) {
	return (
		<label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
			{LABEL.planField}
			<select className={inputClass} onChange={onChange} value={value}>
				{ApiKeyPlanSchema.options.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
		</label>
	);
}

interface MintFormProps {
	onMint: (label: string, plan: ApiKeyPlan) => void;
	pending: boolean;
}

function MintForm({ onMint, pending }: MintFormProps) {
	const [label, setLabel] = useState("");
	const [plan, setPlan] = useState<ApiKeyPlan>("free");

	const onSubmit = useCallback(
		(event: SubmitEvent<HTMLFormElement>) => {
			event.preventDefault();
			const trimmed = label.trim();
			if (trimmed.length === 0) {
				return;
			}
			onMint(trimmed, plan);
			setLabel("");
		},
		[label, onMint, plan],
	);
	const onLabelChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setLabel(event.target.value);
	}, []);
	const onPlanChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
		const next = ApiKeyPlanSchema.options.find(
			(option) => option === event.target.value,
		);
		if (next !== undefined) {
			setPlan(next);
		}
	}, []);

	return (
		<form className="flex flex-wrap items-end gap-2" onSubmit={onSubmit}>
			<label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400">
				{LABEL.labelField}
				<input className={inputClass} onChange={onLabelChange} value={label} />
			</label>
			<PlanField onChange={onPlanChange} value={plan} />
			<button className={buttonClass} disabled={pending} type="submit">
				{LABEL.mint}
			</button>
		</form>
	);
}

function ApiKeyCard({
	keyRow,
	onRevoke,
}: {
	keyRow: ApiKeyRow;
	onRevoke: (id: string) => void;
}) {
	const { id } = keyRow;
	const revoke = useCallback(() => {
		onRevoke(id);
	}, [id, onRevoke]);
	const status =
		keyRow.revokedAt === null ? STATUS_LABEL.active : STATUS_LABEL.revoked;

	return (
		<article className="flex items-center justify-between gap-4 border border-neutral-300 p-4 dark:border-neutral-700">
			<div className="flex flex-col gap-1">
				<span className="font-medium text-neutral-900 dark:text-neutral-50">
					{keyRow.label}
				</span>
				<span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
					{`${keyRow.plan} · ${status}`}
				</span>
			</div>
			{keyRow.revokedAt === null ? (
				<button className={buttonClass} onClick={revoke} type="button">
					{LABEL.revoke}
				</button>
			) : undefined}
		</article>
	);
}

function ApiKeyList({
	onRevoke,
	rows,
}: {
	onRevoke: (id: string) => void;
	rows: readonly ApiKeyRow[];
}) {
	return (
		<div className="flex flex-col gap-2">
			{rows.map((keyRow) => (
				<ApiKeyCard key={keyRow.id} keyRow={keyRow} onRevoke={onRevoke} />
			))}
		</div>
	);
}

export function ApiKeysPanel() {
	const queryClient = useQueryClient();
	const listKey = orpc.apiKeys.list.queryKey();
	const query = useQuery(orpc.apiKeys.list.queryOptions());
	const [mintedSecret, setMintedSecret] = useState<string | undefined>(
		undefined,
	);

	const invalidateList = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: listKey });
	}, [queryClient, listKey]);
	const onMintSuccess = useCallback(
		async (minted: { secret: string }) => {
			setMintedSecret(minted.secret);
			await invalidateList();
		},
		[invalidateList],
	);

	const mintMutation = useMutation(
		orpc.apiKeys.mint.mutationOptions({ onSuccess: onMintSuccess }),
	);
	const revokeMutation = useMutation(
		orpc.apiKeys.revoke.mutationOptions({ onSuccess: invalidateList }),
	);

	const { isPending: minting, mutate: mintMutate } = mintMutation;
	const { mutate: revokeMutate } = revokeMutation;

	const onMint = useCallback(
		(label: string, plan: ApiKeyPlan) => {
			mintMutate({ label, plan });
		},
		[mintMutate],
	);
	const onRevoke = useCallback(
		(id: string) => {
			revokeMutate({ id });
		},
		[revokeMutate],
	);
	const onDismissSecret = useCallback(() => {
		setMintedSecret(undefined);
	}, []);

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
			<h1 className="font-mono text-lg font-medium text-neutral-900 dark:text-neutral-50">
				{TITLE}
			</h1>
			{query.isError ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{DENIED}
				</p>
			) : (
				<MintForm onMint={onMint} pending={minting} />
			)}
			{mintedSecret === undefined ? undefined : (
				<SecretBanner onDismiss={onDismissSecret} secret={mintedSecret} />
			)}
			{query.data?.length === 0 ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					{EMPTY}
				</p>
			) : undefined}
			{query.data === undefined ? undefined : (
				<ApiKeyList onRevoke={onRevoke} rows={query.data} />
			)}
		</main>
	);
}
