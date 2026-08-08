CREATE TABLE `bench_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`tier` text NOT NULL,
	`overall` real NOT NULL,
	`rank` text,
	`complete` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `debriefs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`input` text NOT NULL,
	`resume` text NOT NULL,
	`points_forts` text NOT NULL,
	`axes` text NOT NULL,
	`focus` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`pseudo` text,
	`current_rank` text,
	`peak_rank` text,
	`main_agent` text,
	`goal` text,
	`weak_maps_notes` text
);
--> statement-breakpoint
CREATE TABLE `routines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`duree` integer NOT NULL,
	`focus` text,
	`contenu` text NOT NULL,
	`done` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenario_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`scenario` text NOT NULL,
	`score` real NOT NULL,
	`energy` real NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `bench_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
