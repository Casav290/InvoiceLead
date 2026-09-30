DROP INDEX "users_email_lower_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unlinked_idx" ON "users" USING btree (lower("email")) WHERE "users"."lead_sub" is null;--> statement-breakpoint
CREATE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));