import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { workPathId } from "@/engine/continuity/keys";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/orpc/client";
import type { LibraryEntry, NextUp } from "@/orpc/schema";

const UNTITLED = "Title unavailable";
const CONTINUE_LIMIT = 4;
const HEADING = "Continue";

const padNumber = (value: number) => String(value).padStart(2, "0");

const nextLine = (next: NextUp) =>
	`next ${next.partLabel} · ${padNumber(next.number)} · ${next.title}`;

const isContinueStatus = (status: LibraryEntry["status"]) =>
	status === "rewatching" || status === "watching";

const continueEntries = (
	entries: readonly LibraryEntry[],
): readonly LibraryEntry[] => {
	const picked: LibraryEntry[] = [];
	for (const entry of entries) {
		if (picked.length >= CONTINUE_LIMIT) {
			break;
		}
		if (isContinueStatus(entry.status) && entry.nextUp !== undefined) {
			picked.push(entry);
		}
	}
	return picked;
};

function ContinueRow({ entry }: { entry: LibraryEntry }) {
	const continuityId = workPathId(entry.continuityId);
	const params = useMemo(
		() => (continuityId === undefined ? undefined : { continuityId }),
		[continuityId],
	);
	const next = entry.nextUp;
	if (params === undefined || next === undefined) {
		return;
	}
	return (
		<li className="border-line border-b pb-3">
			<Link params={params} to="/work/$continuityId">
				<span className="text-ink/90 block truncate font-serif text-xl italic">
					{entry.title ?? UNTITLED}
				</span>
				<span className="text-ink/45 mt-1 block truncate font-mono text-[11px]">
					{nextLine(next)}
				</span>
			</Link>
		</li>
	);
}

function ContinueSection({ entries }: { entries: readonly LibraryEntry[] }) {
	return (
		<Section>
			<Label>{HEADING}</Label>
			<ul className="mt-4 flex flex-col gap-3">
				{entries.map((entry) => (
					<ContinueRow entry={entry} key={entry.continuityId} />
				))}
			</ul>
		</Section>
	);
}

function ContinueWatching() {
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const signedIn = session?.user !== undefined;
	const query = useQuery({
		...orpc.library.list.queryOptions({ input: {} }),
		enabled: signedIn && !sessionPending,
	});
	if (!signedIn || query.data === undefined) {
		return;
	}
	const entries = continueEntries(query.data);
	if (entries.length === 0) {
		return;
	}
	return <ContinueSection entries={entries} />;
}

export { ContinueWatching };
