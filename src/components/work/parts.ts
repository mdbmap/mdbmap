import type { WorkBlock } from "@/orpc/schema";

const instalmentCount = (block: WorkBlock) =>
	block.kind === "film" ? 1 : block.episodeCount;

const watchedCount = (block: WorkBlock) => {
	if (block.kind === "film") {
		return block.watched ? 1 : 0;
	}
	return block.episodes.reduce(
		(count, episode) => count + (episode.watched ? 1 : 0),
		0,
	);
};

const totalEpisodes = (parts: WorkBlock[]) =>
	parts.reduce((sum, part) => sum + instalmentCount(part), 0);

const locatorsOf = (block: WorkBlock): string[] =>
	block.kind === "film"
		? [block.instalmentLocator]
		: block.episodes.map((episode) => episode.instalmentLocator);

export { instalmentCount, locatorsOf, totalEpisodes, watchedCount };
