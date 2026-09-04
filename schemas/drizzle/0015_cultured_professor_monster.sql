CREATE TABLE `stripe_webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`processed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`type` text NOT NULL
);
