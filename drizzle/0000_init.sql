CREATE TABLE `completed_imports` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`scope` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
