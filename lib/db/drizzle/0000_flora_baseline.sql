CREATE TABLE "flora_care_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_knowledge_sources" (
	"id" serial PRIMARY KEY NOT NULL,
"species_id" integer,
"source_code" text,
	"source_name" text NOT NULL,
"organization" text,
"subject" text,
	"source_url" text,
	"retrieved_at" timestamp with time zone,
"notes" text,
"citation" text
);
--> statement-breakpoint
CREATE TABLE "flora_plant_photos" (
	"object_path" text PRIMARY KEY NOT NULL,
	"upload_path" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_plant_places" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"environment_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_plants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"species_id" integer NOT NULL,
	"name" text NOT NULL,
	"personal_name" text,
	"photo_url" text NOT NULL,
	"photo_object_path" text,
	"place_id" integer,
	"weather_location_id" integer,
	"location" text NOT NULL,
	"environment_type" text DEFAULT 'INDOOR' NOT NULL,
	"weather_location_name" text,
	"weather_latitude" numeric(10, 7),
	"weather_longitude" numeric(11, 7),
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"plant_id" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"priority" text NOT NULL,
	"related_task_id" integer,
	"explanation" text NOT NULL,
	"original_date" date,
	"suggested_date" date,
	"applied" integer DEFAULT 0 NOT NULL,
	"weather_json" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"reminder_date" date NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"task_count" integer NOT NULL,
	"completed" integer NOT NULL,
	"overdue" integer NOT NULL,
	"postponed" integer NOT NULL,
	"completion_rate" numeric NOT NULL,
	"frequent_category" text NOT NULL,
	"most_active_plant" text NOT NULL,
	"recommendation_summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_saved_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(11, 7) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_species_care_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"species_id" integer NOT NULL,
	"care_type" text NOT NULL,
	"rain_threshold_mm" numeric,
	"max_wind_speed_mps" numeric,
	"min_temperature" numeric,
	"max_temperature" numeric,
"notes" text,
"rule_code" text,
"trigger_description" text,
"recommended_action" text,
"interval_days_min" integer,
"interval_days_max" integer,
"target_water_mm_week_min" numeric,
"target_water_mm_week_max" numeric
);
--> statement-breakpoint
CREATE TABLE "flora_species" (
	"id" serial PRIMARY KEY NOT NULL,
"species_code" text,
	"name" text NOT NULL,
	"scientific_name" text,
"life_cycle" text,
	"category" text,
	"suitable_environment_types" text[],
	"description" text NOT NULL,
	"care_recommendations" text NOT NULL,
"optimal_temp_min" numeric,
"optimal_temp_max" numeric,
"optimal_humidity" integer,
	"humidity_min" integer,
	"humidity_max" integer,
"watering_frequency_days" integer,
"watering_check_interval_days" integer,
"target_water_mm_week_min" numeric,
"target_water_mm_week_max" numeric,
	"light_requirements" text NOT NULL,
	"soil_recommendations" text NOT NULL,
	"watering_recommendations" text NOT NULL,
	"fertilizing_recommendations" text NOT NULL,
	"fertilizing_frequency_days" integer,
	"pruning_recommendations" text NOT NULL,
	"pruning_season" text,
	"transplanting_recommendations" text NOT NULL,
	"transplanting_frequency_months" integer,
"sowing_planting_recommendations" text,
	"harvesting_recommendations" text,
	"general_care_recommendations" text,
"image_url" text
);
--> statement-breakpoint
CREATE TABLE "flora_species_knowledge_sources" (
"species_id" integer NOT NULL,
"source_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_species_care_rule_sources" (
"care_rule_id" integer NOT NULL,
"source_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"plant_id" integer NOT NULL,
	"type" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"postponement_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flora_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL,
	"weather_location_name" text DEFAULT 'Ваш регіон' NOT NULL,
	"weather_latitude" numeric(10, 7),
	"weather_longitude" numeric(11, 7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flora_users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "flora_care_logs" ADD CONSTRAINT "flora_care_logs_task_id_flora_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."flora_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_knowledge_sources" ADD CONSTRAINT "flora_knowledge_sources_species_id_flora_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."flora_species"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_species_knowledge_sources" ADD CONSTRAINT "flora_species_knowledge_sources_species_id_flora_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."flora_species"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_species_knowledge_sources" ADD CONSTRAINT "flora_species_knowledge_sources_source_id_flora_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."flora_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_species_care_rule_sources" ADD CONSTRAINT "flora_species_care_rule_sources_care_rule_id_flora_species_care_rules_id_fk" FOREIGN KEY ("care_rule_id") REFERENCES "public"."flora_species_care_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_species_care_rule_sources" ADD CONSTRAINT "flora_species_care_rule_sources_source_id_flora_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."flora_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_plant_places" ADD CONSTRAINT "flora_plant_places_user_id_flora_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."flora_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_plants" ADD CONSTRAINT "flora_plants_user_id_flora_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."flora_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_plants" ADD CONSTRAINT "flora_plants_species_id_flora_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."flora_species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_plants" ADD CONSTRAINT "flora_plants_place_id_flora_plant_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."flora_plant_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_plants" ADD CONSTRAINT "flora_plants_weather_location_id_flora_saved_locations_id_fk" FOREIGN KEY ("weather_location_id") REFERENCES "public"."flora_saved_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_recommendations" ADD CONSTRAINT "flora_recommendations_plant_id_flora_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."flora_plants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_recommendations" ADD CONSTRAINT "flora_recommendations_related_task_id_flora_tasks_id_fk" FOREIGN KEY ("related_task_id") REFERENCES "public"."flora_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_reminders" ADD CONSTRAINT "flora_reminders_task_id_flora_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."flora_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_reports" ADD CONSTRAINT "flora_reports_user_id_flora_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."flora_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_saved_locations" ADD CONSTRAINT "flora_saved_locations_user_id_flora_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."flora_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_species_care_rules" ADD CONSTRAINT "flora_species_care_rules_species_id_flora_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."flora_species"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flora_tasks" ADD CONSTRAINT "flora_tasks_plant_id_flora_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."flora_plants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flora_plant_places_owner_name_environment_idx" ON "flora_plant_places" USING btree ("user_id","name","environment_type");--> statement-breakpoint
CREATE UNIQUE INDEX "flora_reports_user_period_idx" ON "flora_reports" USING btree ("user_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "flora_saved_locations_owner_coordinates_idx" ON "flora_saved_locations" USING btree ("user_id","latitude","longitude");--> statement-breakpoint
CREATE UNIQUE INDEX "flora_species_care_rules_species_type_idx" ON "flora_species_care_rules" USING btree ("species_id","care_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "flora_species_code_idx" ON "flora_species" USING btree ("species_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "flora_knowledge_sources_source_code_idx" ON "flora_knowledge_sources" USING btree ("source_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "flora_species_source_links_species_source_idx" ON "flora_species_knowledge_sources" USING btree ("species_id","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "flora_care_rule_source_links_rule_source_idx" ON "flora_species_care_rule_sources" USING btree ("care_rule_id","source_id");