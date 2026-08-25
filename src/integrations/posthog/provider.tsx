import { PostHogProvider as BasePostHogProvider } from "@posthog/react";
import { posthog } from "posthog-js";
import type { ReactNode } from "react";

import { env } from "@/env";

if (globalThis.window !== undefined && env.VITE_POSTHOG_KEY) {
	posthog.init(env.VITE_POSTHOG_KEY, {
		api_host: env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
		capture_pageview: false,
		defaults: "2025-11-30",
		person_profiles: "identified_only",
	});
}

interface PostHogProviderProps {
	children: ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
	return <BasePostHogProvider client={posthog}>{children}</BasePostHogProvider>;
}
