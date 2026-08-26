import { createFileRoute } from "@tanstack/react-router";

import { ApiKeysPanel } from "@/components/admin/api-keys-panel";

export const Route = createFileRoute("/admin/api-keys")({
	component: ApiKeysPanel,
});
