import { createFileRoute } from "@tanstack/react-router";

import { OrderProposalsQueue } from "@/components/admin/order-proposals-queue";

export const Route = createFileRoute("/admin/order-proposals")({
	component: OrderProposalsQueue,
});
