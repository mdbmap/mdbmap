CREATE TABLE `work_note` (
	`body` text NOT NULL,
	`continuity_key` text NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_note_user_continuity_idx` ON `work_note` (`user_id`,`continuity_key`);
