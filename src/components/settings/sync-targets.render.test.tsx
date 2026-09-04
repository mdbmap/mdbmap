import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SyncAccountPublic } from "@/lib/sync-accounts";

import { SyncTargetsPanel } from "./sync-targets.tsx";

const noop = () => {
	/* empty */
};

const EMPTY_ACCOUNTS: readonly SyncAccountPublic[] = [];
const EMPTY_TOKENS = {};

const successAt = new Date("2026-01-01T00:00:00.000Z");

const linkedAnilist = {
	cursor: "continuity:1@2026-01-01T00:00:00.000Z",
	externalAccountId: "ani-1",
	// SyncAccountPublic.lastError is string | null from the store seam.
	// oxlint-disable-next-line unicorn/no-null -- wire format uses SQL NULL
	lastError: null,
	lastSuccessfulAt: successAt,
	linkedAt: new Date("2026-01-01T00:00:00.000Z"),
	provider: "anilist",
} as const satisfies SyncAccountPublic;

const linkedAccounts: readonly SyncAccountPublic[] = [linkedAnilist];

describe("SyncTargetsPanel", () => {
	it("renders the upgrade path when entitlement is inactive", () => {
		const html = renderToStaticMarkup(
			<SyncTargetsPanel
				accounts={EMPTY_ACCOUNTS}
				connectPendingProvider={undefined}
				disconnectPendingProvider={undefined}
				entitlement="inactive"
				message={undefined}
				onConnect={noop}
				onDisconnect={noop}
				onSyncNow={noop}
				onTokenChange={noop}
				syncPending={false}
				tokens={EMPTY_TOKENS}
			/>,
		);
		expect(html).toContain("data-sync-locked");
		expect(html).toContain("Use checkout above to upgrade");
		expect(html).not.toContain("data-sync-entitled");
		expect(html).not.toContain("Sync now");
	});

	it("renders connect and sync controls when entitlement is active", () => {
		const html = renderToStaticMarkup(
			<SyncTargetsPanel
				accounts={linkedAccounts}
				connectPendingProvider={undefined}
				disconnectPendingProvider={undefined}
				entitlement="active"
				message={undefined}
				onConnect={noop}
				onDisconnect={noop}
				onSyncNow={noop}
				onTokenChange={noop}
				syncPending={false}
				tokens={EMPTY_TOKENS}
			/>,
		);
		expect(html).toContain("data-sync-entitled");
		expect(html).toContain('data-sync-provider="anilist"');
		expect(html).toContain("Last success");
		expect(html).toContain(successAt.toISOString());
		expect(html).toContain("Disconnect");
		expect(html).toContain("Sync now");
		expect(html).toContain('data-sync-provider="mal"');
		expect(html).toContain("Access token");
	});
});
