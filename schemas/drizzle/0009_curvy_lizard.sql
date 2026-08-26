CREATE TABLE `research_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`timing` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
