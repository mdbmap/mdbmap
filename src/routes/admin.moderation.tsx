import { createFileRoute } from "@tanstack/react-router";

import { ModerationQueue } from "@/components/admin/moderation-queue";

export const Route = createFileRoute("/admin/moderation")({
	component: ModerationQueue,
});
