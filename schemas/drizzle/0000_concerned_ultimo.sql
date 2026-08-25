CREATE TABLE `account` (
	`access_token` text,
	`access_token_expires_at` integer,
	`account_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`id_token` text,
	`issuer` text NOT NULL,
	`password` text,
	`provider_id` text NOT NULL,
	`refresh_token` text,
	`refresh_token_expires_at` integer,
	`scope` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_account_id_idx` ON `account` (`issuer`,`account_id`);--> statement-breakpoint
CREATE TABLE `episode_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instalment_locator` text NOT NULL,
	`user_id` text NOT NULL,
	`watched_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episode_progress_user_instalment_idx` ON `episode_progress` (`user_id`,`instalment_locator`);--> statement-breakpoint
CREATE TABLE `personal_rating` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`score` integer NOT NULL,
	`unit_key` text NOT NULL,
	`unit_kind` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "personal_rating_score_range" CHECK("personal_rating"."score" between 1 and 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_rating_user_unit_idx` ON `personal_rating` (`user_id`,`unit_kind`,`unit_key`);--> statement-breakpoint
CREATE TABLE `session` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`ip_address` text,
	`token` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `todos` (
	`created_at` integer DEFAULT (unixepoch()),
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`image` text,
	`name` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watch_status` (
	`continuity_key` text NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rewatch_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_status_user_continuity_idx` ON `watch_status` (`user_id`,`continuity_key`);