CREATE TABLE `presentation_order_proposals` (
	`author_user_id` text NOT NULL,
	`continuity_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rationale` text NOT NULL,
	`reviewed_at` integer,
	`reviewed_by_user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`continuity_id`) REFERENCES `continuities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "presentation_order_proposals_status" CHECK("presentation_order_proposals"."status" in ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `presentation_order_proposals_continuity_id_idx` ON `presentation_order_proposals` (`continuity_id`);--> statement-breakpoint
CREATE INDEX `presentation_order_proposals_status_id_idx` ON `presentation_order_proposals` (`status`,`id`);
--> statement-breakpoint
CREATE TABLE `presentation_order_proposal_items` (
	`position` integer NOT NULL,
	`proposal_id` integer NOT NULL,
	`segment_id` integer NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `presentation_order_proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `continuity_segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_order_proposal_items_proposal_position_idx` ON `presentation_order_proposal_items` (`proposal_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_order_proposal_items_proposal_segment_idx` ON `presentation_order_proposal_items` (`proposal_id`,`segment_id`);
