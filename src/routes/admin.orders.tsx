import { createFileRoute } from "@tanstack/react-router";

import { OrdersPanel } from "@/components/admin/orders-panel";

export const Route = createFileRoute("/admin/orders")({
	component: OrdersPanel,
});
