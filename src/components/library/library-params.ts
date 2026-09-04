import { watchStatuses } from "@/db/schema";
import type { WatchStatus } from "@/db/schema";
import { librarySorts } from "@/orpc/schema";
import type { LibrarySort } from "@/orpc/schema";

interface LibrarySearch {
	sort?: LibrarySort | undefined;
	status?: WatchStatus | undefined;
}

const isWatchStatus = (value: unknown): value is WatchStatus =>
	typeof value === "string" &&
	(watchStatuses as readonly string[]).includes(value);

const isLibrarySort = (value: unknown): value is LibrarySort =>
	typeof value === "string" &&
	(librarySorts as readonly string[]).includes(value);

const parseLibrarySearch = (search: Record<string, unknown>): LibrarySearch => {
	const next: LibrarySearch = {};
	const { status, sort } = search;
	if (isWatchStatus(status)) {
		next.status = status;
	}
	if (isLibrarySort(sort) && sort !== "activity") {
		next.sort = sort;
	}
	return next;
};

const libraryListInput = (search: LibrarySearch) => {
	const input: { sort?: LibrarySort; status?: WatchStatus } = {};
	if (search.sort !== undefined) {
		input.sort = search.sort;
	}
	if (search.status !== undefined) {
		input.status = search.status;
	}
	return input;
};

export {
	isLibrarySort,
	libraryListInput,
	parseLibrarySearch,
	type LibrarySearch,
};
