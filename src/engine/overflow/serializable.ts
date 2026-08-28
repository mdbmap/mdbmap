import type { InstalmentLocator } from "@/db/schema";
import type { EnumeratedTitle } from "@/engine/discovery/structural.ts";
import type { InstalmentFacts } from "@/engine/matcher";

type SerializedFacts = readonly (readonly [
	InstalmentLocator,
	InstalmentFacts,
])[];

interface SerializableEnumerated {
	readonly facts: SerializedFacts;
	readonly stream: EnumeratedTitle["stream"];
}

const emptyEnumerated = (): SerializableEnumerated => ({
	facts: [],
	stream: { boundary: "complete", instalments: [] },
});

const serializeEnumerated = (
	title: EnumeratedTitle,
): SerializableEnumerated => ({
	facts: [...title.facts],
	stream: title.stream,
});

const deserializeEnumerated = (
	title: SerializableEnumerated,
): EnumeratedTitle => ({
	facts: new Map(title.facts),
	stream: title.stream,
});

export { deserializeEnumerated, emptyEnumerated, serializeEnumerated };
export type { SerializableEnumerated };
