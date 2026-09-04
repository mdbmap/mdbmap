import { notFound } from "@tanstack/react-router";

import { parseWorkPathId } from "@/engine/continuity/keys";

const throwNotFound = (): never => {
	throw Object.assign(new Error("Not Found"), notFound());
};

const parseWorkParams = ({
	continuityId,
}: {
	continuityId: string;
}): { continuityId: number } => {
	const id = parseWorkPathId(continuityId);
	if (id === undefined) {
		return throwNotFound();
	}
	return { continuityId: id };
};

const stringifyWorkParams = ({ continuityId }: { continuityId: number }) => ({
	continuityId: String(continuityId),
});

export { parseWorkParams, stringifyWorkParams, throwNotFound };
