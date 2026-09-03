import { useSuspenseQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";

import { LibraryPage } from "./library-page";

export function LibraryRoute() {
	const { data } = useSuspenseQuery(orpc.library.list.queryOptions());
	return <LibraryPage entries={data} />;
}
