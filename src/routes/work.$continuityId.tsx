import { ORPCError } from "@orpc/client";
import { createFileRoute, isNotFound } from "@tanstack/react-router";

import { workGetInput } from "@/components/work/part-state";
import { workMatchHead } from "@/components/work/work-head";
import { WorkNotFound } from "@/components/work/work-not-found";
import {
	parseWorkParams,
	stringifyWorkParams,
	throwNotFound,
} from "@/components/work/work-params";
import { WorkRoute } from "@/components/work/work-route";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { continuityKey } from "@/engine/continuity/keys";
import { orpc } from "@/orpc/client";

const isOrder = (value: unknown): value is PresentationOrderSlug =>
	value === "release" || value === "watch";

interface WorkSearch {
	order?: PresentationOrderSlug | undefined;
}

const isWorkRpcNotFound = (error: unknown): boolean =>
	isNotFound(error) ||
	(error instanceof ORPCError && error.code === "NOT_FOUND");

export const Route = createFileRoute("/work/$continuityId")({
	component: WorkRoute,
	head: ({ loaderData, match }) => workMatchHead(loaderData, match.status),
	loader: async ({ context, deps, params }) => {
		const input = workGetInput(continuityKey(params.continuityId), deps.order);
		const query = orpc.work.get.queryOptions({ input });
		try {
			return await context.queryClient.ensureQueryData(query);
		} catch (error) {
			if (isWorkRpcNotFound(error)) {
				throwNotFound();
			}
			throw error;
		}
	},
	loaderDeps: (opts: { search: WorkSearch }): WorkSearch => ({
		order: opts.search.order,
	}),
	notFoundComponent: WorkNotFound,
	params: {
		parse: parseWorkParams,
		stringify: stringifyWorkParams,
	},
	validateSearch: (search: Record<string, unknown>): WorkSearch => {
		const { order } = search;
		return isOrder(order) ? { order } : {};
	},
});
