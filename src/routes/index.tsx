import { createFileRoute } from "@tanstack/react-router";

import { HomeRoute } from "@/components/home-route";
import { parseHomeSearch } from "@/components/home-search";

export const Route = createFileRoute("/")({
	component: HomeRoute,
	validateSearch: parseHomeSearch,
});
