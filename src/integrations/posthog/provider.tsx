import { PostHogProvider as BasePostHogProvider } from "@posthog/react";
import posthog from "posthog-js";
import type { ReactNode } from "react";

if (
	globalThis.window !== undefined &&
	import.meta.env.VITE_POSTHOG_KEY
) {
	posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
		api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
		capture_pageview: false,
		defaults: "2025-11-30",
		person_profiles: "identified_only",
	});
}

interface PostHogProviderProps {
	children: ReactNode;
}

export default function PostHogProvider({ children }: PostHogProviderProps) {
	return <BasePostHogProvider client={posthog}>{children}</BasePostHogProvider>;
}
