PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_absence_assertions` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`coverage_revision` integer NOT NULL,
	`target_service` text NOT NULL,
	`unit_id` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `content_units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_absence_assertions`("created_at", "id", "source", "coverage_revision", "target_service", "unit_id") SELECT "created_at", "id", "source", "coverage_revision", "target_service", "unit_id" FROM `absence_assertions`;--> statement-breakpoint
DROP TABLE `absence_assertions`;--> statement-breakpoint
ALTER TABLE `__new_absence_assertions` RENAME TO `absence_assertions`;--> statement-breakpoint
CREATE UNIQUE INDEX `absence_assertions_unit_service_revision_idx` ON `absence_assertions` (`unit_id`,`target_service`,`coverage_revision`);--> statement-breakpoint
CREATE TABLE `__new_content_units` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_content_units`("created_at", "id") SELECT "created_at", "id" FROM `content_units`;--> statement-breakpoint
DROP TABLE `content_units`;--> statement-breakpoint
ALTER TABLE `__new_content_units` RENAME TO `content_units`;--> statement-breakpoint
CREATE TABLE `__new_instalment_assertions` (
	`confidence` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`instalment_id` integer NOT NULL,
	`unit_id` text NOT NULL,
	FOREIGN KEY (`instalment_id`) REFERENCES `service_instalments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `content_units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_instalment_assertions`("confidence", "created_at", "id", "source", "instalment_id", "unit_id") SELECT "confidence", "created_at", "id", "source", "instalment_id", "unit_id" FROM `instalment_assertions`;--> statement-breakpoint
DROP TABLE `instalment_assertions`;--> statement-breakpoint
ALTER TABLE `__new_instalment_assertions` RENAME TO `instalment_assertions`;--> statement-breakpoint
CREATE UNIQUE INDEX `instalment_assertions_instalment_unit_idx` ON `instalment_assertions` (`instalment_id`,`unit_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;