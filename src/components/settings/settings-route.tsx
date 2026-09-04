import { useSuspenseQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";

import { SettingsPage } from "./settings-page";

export function SettingsRoute() {
	const { data } = useSuspenseQuery(
		orpc.library.list.queryOptions({ input: {} }),
	);
	return <SettingsPage entries={data} />;
}
