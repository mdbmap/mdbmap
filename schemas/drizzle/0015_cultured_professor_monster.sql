CREATE TABLE `stripe_webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`processed_at` integer,
	`type` text NOT NULL
);
