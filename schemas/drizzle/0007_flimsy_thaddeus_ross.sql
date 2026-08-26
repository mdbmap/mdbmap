CREATE TABLE `api_key` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`label` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_key_hash_unique` ON `api_key` (`key_hash`);