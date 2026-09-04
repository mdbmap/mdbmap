const APP_DESCRIPTION =
	"A personal tracker for television, film and anime, built on a cross-service metadata matcher.";
const APP_NAME = "mdbmap";
const DESCRIPTION_LIMIT = 160;
const NOT_FOUND_TITLE = "Work not found · mdbmap";

interface WorkHeadSource {
	readonly header: {
		readonly synopsis: string;
		readonly title: string;
	};
}

interface WorkDocumentHead {
	readonly description: string;
	readonly title: string;
}

const truncateSynopsis = (synopsis: string): string | undefined => {
	const trimmed = synopsis.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	if (trimmed.length <= DESCRIPTION_LIMIT) {
		return trimmed;
	}
	return trimmed.slice(0, DESCRIPTION_LIMIT);
};

const workDocumentHead = (
	work: WorkHeadSource | undefined,
): WorkDocumentHead => {
	if (work === undefined) {
		return { description: APP_DESCRIPTION, title: NOT_FOUND_TITLE };
	}
	return {
		description: truncateSynopsis(work.header.synopsis) ?? APP_DESCRIPTION,
		title: `${work.header.title} · ${APP_NAME}`,
	};
};

const workMatchHead = (work: WorkHeadSource | undefined, status: string) => {
	if (status !== "notFound" && work === undefined) {
		return {};
	}
	const { description, title } = workDocumentHead(work);
	return {
		meta: [
			{
				title,
			},
			{
				content: description,
				name: "description",
			},
		],
	};
};

export { workDocumentHead, workMatchHead };
