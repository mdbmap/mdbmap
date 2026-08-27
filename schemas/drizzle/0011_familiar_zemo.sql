CREATE TABLE `continuities` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `continuity_segments` (
	`continuity_id` integer NOT NULL,
	`kind` text NOT NULL,
	`relation_assertion_id` integer,
	`release_ordinal` integer NOT NULL,
	`title_id` integer NOT NULL,
	FOREIGN KEY (`continuity_id`) REFERENCES `continuities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`relation_assertion_id`) REFERENCES `relation_assertions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`title_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `continuity_segments_continuity_ordinal_idx` ON `continuity_segments` (`continuity_id`,`release_ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `continuity_segments_continuity_title_idx` ON `continuity_segments` (`continuity_id`,`title_id`);