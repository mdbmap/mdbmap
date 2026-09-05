CREATE TABLE `catalogue_metadata` (
	`core_fetched_at` integer NOT NULL,
	`core_json` text NOT NULL,
	`entry_key` text NOT NULL,
	`freshness_class` text NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`snapshot_version` integer NOT NULL,
	`user_refreshed_at` integer,
	`volatile_fetched_at` integer NOT NULL,
	`volatile_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalogue_metadata_provider_entry_idx` ON `catalogue_metadata` (`provider`,`entry_key`);
--> statement-breakpoint
CREATE INDEX `catalogue_metadata_freshness_idx` ON `catalogue_metadata` (`freshness_class`,`volatile_fetched_at`);
--> statement-breakpoint
CREATE TABLE `metadata_refresh_lease` (
	`continuity_key` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL
);
