CREATE TABLE `backlink_import_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_backlink_import_batch_user_created` ON `backlink_import_batch` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `user_backlink` ADD `batch_id` text REFERENCES backlink_import_batch(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_user_backlink_user_batch` ON `user_backlink` (`user_id`,`batch_id`);
