import { z } from "zod";

import type { CatalogueTitle } from "@/engine/discovery";

// Shared catalogue record shape for research API tools. A tool result and a
// server-side catalogue fetch both parse through this schema so acceptance
// never re-fetches to learn what the pass already validated.
const researchInstalmentSchema = z.object({
	kind: z.enum(["regular", "special"]).default("regular"),
	locator: z.string().min(1),
	locatorKind: z.enum(["service-id", "position"]).default("position"),
});

const researchCatalogueSchema = z.object({
	format: z.string().optional(),
	instalmentCount: z.number().int().nonnegative().optional(),
	instalments: z.array(researchInstalmentSchema).default([]),
	releaseDate: z.string().optional(),
	title: z.string().min(1),
});

type ResearchCatalogueRecord = z.infer<typeof researchCatalogueSchema>;

const parseResearchCatalogue = (raw: unknown): ResearchCatalogueRecord =>
	researchCatalogueSchema.parse(raw);

// Project onto the discovery verification seam so a tool-backed client and a
// verify CatalogueClient agree on the fields that check native identity.
const toCatalogueTitle = (record: ResearchCatalogueRecord): CatalogueTitle => ({
	format: record.format ?? undefined,
	instalmentCount: record.instalmentCount ?? record.instalments.length,
	releaseDate: record.releaseDate ?? undefined,
	title: record.title,
});

export { parseResearchCatalogue, researchCatalogueSchema, toCatalogueTitle };
export type { ResearchCatalogueRecord };
