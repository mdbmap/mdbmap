import { useSuspenseQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";

import { CalendarPage } from "./calendar-page";

function CalendarRoute() {
	const { data } = useSuspenseQuery(orpc.calendar.list.queryOptions());
	return <CalendarPage days={data} />;
}

export { CalendarRoute };
