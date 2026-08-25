PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_relation_assertions` (
	`confidence` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`from_title_id` integer NOT NULL,
	`to_title_id` integer NOT NULL,
	FOREIGN KEY (`from_title_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_title_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "relation_assertions_no_self_edge" CHECK("__new_relation_assertions"."from_title_id" <> "__new_relation_assertions"."to_title_id")
);
--> statement-breakpoint
INSERT INTO `__new_relation_assertions`("confidence", "created_at", "id", "source", "from_title_id", "to_title_id") SELECT "confidence", "created_at", "id", "source", "from_title_id", "to_title_id" FROM `relation_assertions`;--> statement-breakpoint
DROP TABLE `relation_assertions`;--> statement-breakpoint
ALTER TABLE `__new_relation_assertions` RENAME TO `relation_assertions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `relation_assertions_from_idx` ON `relation_assertions` (`from_title_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `relation_assertions_to_idx` ON `relation_assertions` (`to_title_id`);