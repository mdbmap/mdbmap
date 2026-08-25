CREATE TABLE `absence_assertions` (
	`coverage_revision` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`target_service` text NOT NULL,
	`unit_id` integer NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `content_units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `absence_assertions_unit_service_revision_idx` ON `absence_assertions` (`unit_id`,`target_service`,`coverage_revision`);--> statement-breakpoint
CREATE TABLE `content_units` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `instalment_assertions` (
	`confidence` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instalment_id` integer NOT NULL,
	`source` text NOT NULL,
	`unit_id` integer NOT NULL,
	FOREIGN KEY (`instalment_id`) REFERENCES `service_instalments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `content_units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instalment_assertions_instalment_unit_idx` ON `instalment_assertions` (`instalment_id`,`unit_id`);--> statement-breakpoint
CREATE TABLE `relation_assertions` (
	`confidence` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`from_title_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`to_title_id` integer NOT NULL,
	FOREIGN KEY (`from_title_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_title_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relation_assertions_from_idx` ON `relation_assertions` (`from_title_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `relation_assertions_to_idx` ON `relation_assertions` (`to_title_id`);--> statement-breakpoint
CREATE TABLE `service_coverages` (
	`baseline_continuity` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`target_service` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_coverages_baseline_service_revision_idx` ON `service_coverages` (`baseline_continuity`,`target_service`,`revision`);--> statement-breakpoint
CREATE TABLE `service_instalments` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`locator` text NOT NULL,
	`locator_kind` text NOT NULL,
	`title_id` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_instalments_title_locator_idx` ON `service_instalments` (`title_id`,`locator`);--> statement-breakpoint
CREATE TABLE `service_titles` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`group_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`service` text NOT NULL,
	`service_id` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `title_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_titles_service_service_id_idx` ON `service_titles` (`service`,`service_id`);--> statement-breakpoint
CREATE TABLE `title_assertions` (
	`confidence` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`title_a_id` integer NOT NULL,
	`title_b_id` integer NOT NULL,
	FOREIGN KEY (`title_a_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`title_b_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "title_assertions_canonical_order" CHECK("title_assertions"."title_a_id" < "title_assertions"."title_b_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `title_assertions_pair_idx` ON `title_assertions` (`title_a_id`,`title_b_id`);--> statement-breakpoint
CREATE TABLE `title_groups` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ladder_complete` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
