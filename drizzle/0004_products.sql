CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"description" text,
	"unit" text DEFAULT 'piece' NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"vat_code" text DEFAULT 'normal' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_org_name_idx" ON "products" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_sku_idx" ON "products" USING btree ("organization_id","sku") WHERE "products"."sku" is not null and "products"."archived_at" is null;