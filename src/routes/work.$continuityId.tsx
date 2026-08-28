import { createFileRoute } from "@tanstack/react-router";

import { workGetInput } from "@/components/work/part-state";
import { WorkRoute } from "@/components/work/work-route";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { continuityKey, parseWorkPathId } from "@/engine/continuity/keys";
import { orpc } from "@/orpc/client";

const isOrder = (value: unknown): value is PresentationOrderSlug =>
	value === "release" || value === "watch";

interface WorkSearch {
	order?: PresentationOrderSlug | undefined;
}

const parseWorkParams = ({ continuityId }: { continuityId: string }) => {
	const id = parseWorkPathId(continuityId);
	if (id === undefined) {
		throw Object.assign(new Error("Not Found"), { isNotFound: true });
	}
	return { continuityId: id };
};

const stringifyWorkParams = ({ continuityId }: { continuityId: number }) => ({
	continuityId: String(continuityId),
});

export const Route = createFileRoute("/work/$continuityId")({
	component: WorkRoute,
	loader: async ({ context, deps, params }) => {
		const input = workGetInput(continuityKey(params.continuityId), deps.order);
		const query = orpc.work.get.queryOptions({ input });
		return context.queryClient.ensureQueryData(query);
	},
	loaderDeps: (opts: { search: WorkSearch }): WorkSearch => ({
		order: opts.search.order,
	}),
	params: {
		parse: parseWorkParams,
		stringify: stringifyWorkParams,
	},
	validateSearch: (search: Record<string, unknown>): WorkSearch => {
		const { order } = search;
		return isOrder(order) ? { order } : {};
	},
});
