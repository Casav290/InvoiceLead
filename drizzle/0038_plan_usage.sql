CREATE TABLE "plan_usage" (
	"organization_id" uuid NOT NULL,
	"period" text NOT NULL,
	"key" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_usage_organization_id_period_key_pk" PRIMARY KEY("organization_id","period","key"),
	CONSTRAINT "plan_usage_used_check" CHECK ("plan_usage"."used" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plan_usage" ADD CONSTRAINT "plan_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;