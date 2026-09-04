CREATE TABLE `sync_account_link` (
	`ciphertext` text NOT NULL,
	`cursor` text,
	`data_iv` text NOT NULL,
	`external_account_id` text,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`last_error` text,
	`linked_at` integer DEFAULT (unixepoch()) NOT NULL,
	`provider` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` text NOT NULL,
	`wrap_iv` text NOT NULL,
	`wrapped_key` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_account_link_user_provider_uidx` ON `sync_account_link` (`user_id`,`provider`);