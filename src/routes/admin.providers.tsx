import { createFileRoute } from "@tanstack/react-router";

import { ProvidersPanel } from "@/components/admin/providers-panel";

export const Route = createFileRoute("/admin/providers")({
	component: ProvidersPanel,
});
