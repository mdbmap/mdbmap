import { isContentType, ResourceTypes } from "stremio-types";
import type { ContentType } from "stremio-types";

type AddonRequest =
	| { readonly kind: "manifest" }
	| {
			readonly extra: URLSearchParams;
			readonly id: string;
			readonly kind: "catalog";
			readonly type: ContentType;
	  }
	| {
			readonly id: string;
			readonly kind: "meta";
			readonly type: ContentType;
	  };

const STREMIO_PREFIX = "/stremio/";
const JSON_SUFFIX = ".json";

const restOf = (pathname: string): string | undefined => {
	const index = pathname.indexOf(STREMIO_PREFIX);
	if (index === -1) {
		return undefined;
	}
	return pathname.slice(index + STREMIO_PREFIX.length);
};

const stripJson = (value: string): string | undefined => {
	if (!value.endsWith(JSON_SUFFIX)) {
		return undefined;
	}
	return value.slice(0, -JSON_SUFFIX.length);
};

const parseAddonPath = (pathname: string): AddonRequest | undefined => {
	const rest = restOf(pathname);
	if (rest === undefined) {
		return undefined;
	}
	if (rest === "manifest.json" || rest === "manifest") {
		return { kind: "manifest" };
	}
	const withoutJson = stripJson(rest);
	if (withoutJson === undefined) {
		return undefined;
	}
	const segments = withoutJson.split("/");
	const [resource, type, ...tail] = segments;
	if (type === undefined || !isContentType(type) || tail.length === 0) {
		return undefined;
	}
	if (resource === ResourceTypes.CATALOG) {
		const [id, ...extraParts] = tail;
		if (id === undefined || id === "") {
			return undefined;
		}
		return {
			extra: new URLSearchParams(extraParts.join("/")),
			id,
			kind: "catalog",
			type,
		};
	}
	if (resource === ResourceTypes.META) {
		const id = tail.join("/");
		if (id === "") {
			return undefined;
		}
		return { id, kind: "meta", type };
	}
	return undefined;
};

export { parseAddonPath };
export type { AddonRequest };
