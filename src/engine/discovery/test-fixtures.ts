import type { SimklEntry, SimklExternalIds, SimklRelation } from "./simkl.ts";

const anime = (
	id: string,
	externalIds: SimklExternalIds,
	relations: readonly SimklRelation[],
): SimklEntry => ({
	externalIds,
	firstAirDate: undefined,
	id,
	relations,
	title: id,
	type: "anime",
});

export { anime };
