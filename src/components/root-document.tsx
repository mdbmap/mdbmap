import { HeadContent, Scripts } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { ComponentType, ReactNode } from "react";

import { getLocale } from "#/paraglide/runtime";
import { PostHogProvider } from "@/integrations/posthog/provider";

async function loadAppDevtools() {
	const { AppDevtools } = await import("@/components/app-devtools");
	return { default: AppDevtools };
}

const AppDevtools: ComponentType | undefined = import.meta.env.DEV
	? lazy(loadAppDevtools)
	: undefined;

function RootProviders({ children }: { children: ReactNode }) {
	return (
		<PostHogProvider>
			{children}
			{AppDevtools && (
				<Suspense>
					<AppDevtools />
				</Suspense>
			)}
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
