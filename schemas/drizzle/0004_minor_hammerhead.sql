DROP INDEX `pending_group_candidates_open_idx`;--> statement-breakpoint
ALTER TABLE `pending_group_candidates` ADD `subject_key` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `pending_group_candidates_open_idx` ON `pending_group_candidates` (`kind`,`subject_key`,`evidence_hash`) WHERE "pending_group_candidates"."status" = 'open';