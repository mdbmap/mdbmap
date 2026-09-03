import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { queryDevtoolsPlugin } from "@/integrations/tanstack-query/devtools";

const devtoolsConfig = { position: "bottom-right" } as const;

const devtoolsPlugins = [
	{
		name: "Tanstack Router",
		render: <TanStackRouterDevtoolsPanel />,
	},
	queryDevtoolsPlugin,
];

export function AppDevtools() {
	return <TanStackDevtools config={devtoolsConfig} plugins={devtoolsPlugins} />;
}
