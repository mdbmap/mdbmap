CREATE TABLE `pending_group_candidates` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`evidence` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`subject` text NOT NULL,
	`subject_key` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_group_candidates_open_idx` ON `pending_group_candidates` (`kind`,`subject_key`,`evidence_hash`) WHERE "pending_group_candidates"."status" = 'open';--> statement-breakpoint
CREATE TABLE `title_group_aliases` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`retired_group_id` integer NOT NULL,
	`survivor_group_id` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`retired_group_id`) REFERENCES `title_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`survivor_group_id`) REFERENCES `title_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "title_group_aliases_not_self" CHECK("title_group_aliases"."retired_group_id" != "title_group_aliases"."survivor_group_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `title_group_aliases_retired_group_id_idx` ON `title_group_aliases` (`retired_group_id`);