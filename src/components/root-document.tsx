import { TanStackDevtools } from "@tanstack/react-devtools";
import { HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";

import { getLocale } from "#/paraglide/runtime";
import { PostHogProvider } from "@/integrations/posthog/provider";
import { queryDevtoolsPlugin } from "@/integrations/tanstack-query/devtools";

const devtoolsConfig = { position: "bottom-right" } as const;

const devtoolsPlugins = [
	{
		name: "Tanstack Router",
		render: <TanStackRouterDevtoolsPanel />,
	},
	queryDevtoolsPlugin,
];

function RootProviders({ children }: { children: ReactNode }) {
	return (
		<PostHogProvider>
			{children}
			<TanStackDevtools config={devtoolsConfig} plugins={devtoolsPlugins} />
		</PostHogProvider>
	);
}

export function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang={getLocale()}>
			<head>
				<HeadContent />
			</head>
			<body>
				<RootProviders>{children}</RootProviders>
				<Scripts />
			</body>
		</html>
	);
}
