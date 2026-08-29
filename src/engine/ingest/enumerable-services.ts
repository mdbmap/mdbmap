import type { Service } from "@/engine/identity.ts";

const instalmentEnumerableServices = new Set<Service>(["anilist", "mal"]);

export { instalmentEnumerableServices };
