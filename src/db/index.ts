import { drizzle } from "drizzle-orm/better-sqlite3";

import { env } from "@/env";

import { todos } from "./schema.ts";

const schema = { todos };

export const db = drizzle(env.DATABASE_URL ?? ":memory:", { schema });
