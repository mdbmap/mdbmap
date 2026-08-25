import { sql } from "drizzle-orm";
import { integer } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
	integer(name, { mode: "timestamp" }).default(sql`(unixepoch())`).notNull();

export { timestamp };
