CREATE TABLE `continuity_aliases` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`retired_continuity_id` integer NOT NULL,
	`survivor_continuity_id` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`survivor_continuity_id`) REFERENCES `continuities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "continuity_aliases_not_self" CHECK("continuity_aliases"."retired_continuity_id" != "continuity_aliases"."survivor_continuity_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `continuity_aliases_retired_continuity_id_idx` ON `continuity_aliases` (`retired_continuity_id`);