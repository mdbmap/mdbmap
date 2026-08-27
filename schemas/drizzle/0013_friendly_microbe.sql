PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_continuity_segments` (
	`continuity_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`relation_assertion_id` integer,
	`release_ordinal` integer NOT NULL,
	`title_id` integer NOT NULL,
	FOREIGN KEY (`continuity_id`) REFERENCES `continuities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`relation_assertion_id`) REFERENCES `relation_assertions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`title_id`) REFERENCES `service_titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_continuity_segments`("continuity_id", "kind", "relation_assertion_id", "release_ordinal", "title_id") SELECT "continuity_id", "kind", "relation_assertion_id", "release_ordinal", "title_id" FROM `continuity_segments`;--> statement-breakpoint
DROP TABLE `continuity_segments`;--> statement-breakpoint
ALTER TABLE `__new_continuity_segments` RENAME TO `continuity_segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `continuity_segments_continuity_ordinal_idx` ON `continuity_segments` (`continuity_id`,`release_ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `continuity_segments_continuity_title_idx` ON `continuity_segments` (`continuity_id`,`title_id`);--> statement-breakpoint
CREATE TABLE `presentation_orders` (
	`continuity_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`label` text NOT NULL,
	`slug` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`continuity_id`) REFERENCES `continuities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "presentation_orders_slug" CHECK("presentation_orders"."slug" in ('release', 'watch'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_orders_continuity_slug_idx` ON `presentation_orders` (`continuity_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_orders_continuity_default_idx` ON `presentation_orders` (`continuity_id`) WHERE "presentation_orders"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `presentation_order_items` (
	`order_id` integer NOT NULL,
	`position` integer NOT NULL,
	`segment_id` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `presentation_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `continuity_segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_order_items_order_position_idx` ON `presentation_order_items` (`order_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_order_items_order_segment_idx` ON `presentation_order_items` (`order_id`,`segment_id`);
