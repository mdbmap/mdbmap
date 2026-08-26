CREATE TABLE `research_timing` (
	`id` integer PRIMARY KEY NOT NULL,
	`timing` text DEFAULT 'off' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `research_timing_singleton` CHECK(`id` = 1)
);
