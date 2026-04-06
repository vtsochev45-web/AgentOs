CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"persona" text NOT NULL,
	"tools_enabled" json DEFAULT '[]'::json NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversation_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"sources_json" json,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"title" text DEFAULT 'New Conversation' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_agent_id" integer NOT NULL,
	"to_agent_id" integer NOT NULL,
	"thread_id" text,
	"content" text NOT NULL,
	"response" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"path" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_files_agent_path_uniq" UNIQUE("agent_id","path")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"agent_name" text,
	"action_type" text NOT NULL,
	"detail" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vps_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text DEFAULT 'My VPS' NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text NOT NULL,
	"auth_type" text DEFAULT 'password' NOT NULL,
	"encrypted_credential" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"ai_model" text DEFAULT 'google/gemini-2.5-flash' NOT NULL,
	"openai_api_key" text,
	"anthropic_api_key" text,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_user" text,
	"smtp_password" text,
	"webhook_url" text,
	"search_provider" text DEFAULT 'duckduckgo' NOT NULL,
	"brave_api_key" text,
	"openclaw_instance_url" text,
	"openclaw_api_key" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"type" text DEFAULT 'vps-path' NOT NULL,
	"repo_url" text,
	"branch" text DEFAULT 'main' NOT NULL,
	"vps_directory" text,
	"site_url" text,
	"build_command" text,
	"deploy_command" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_messages" ADD CONSTRAINT "agent_conversation_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;