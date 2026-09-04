import { createFileRoute, redirect } from "@tanstack/react-router";

import { CalendarRoute } from "@/components/calendar/calendar-route";
import { viewerIsSignedIn } from "@/lib/viewer-session";
import { orpc } from "@/orpc/client";

const SIGN_IN_HREF = "/?signin=1";

export const Route = createFileRoute("/calendar")({
	beforeLoad: async () => {
		if (!(await viewerIsSignedIn())) {
			redirect({ href: SIGN_IN_HREF, throw: true });
		}
	},
	component: CalendarRoute,
	loader: async ({ context }) =>
		context.queryClient.ensureQueryData(orpc.calendar.list.queryOptions()),
});
