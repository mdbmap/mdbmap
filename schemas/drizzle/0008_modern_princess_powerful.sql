CREATE TABLE `llm_provider` (
	`ciphertext` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`data_iv` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`wrap_iv` text NOT NULL,
	`wrapped_key` text NOT NULL
);
