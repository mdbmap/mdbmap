import type { PartView } from "@/orpc/schema";

export const totalEpisodes = (parts: PartView[]) =>
	parts.reduce((sum, part) => sum + part.episodeCount, 0);
