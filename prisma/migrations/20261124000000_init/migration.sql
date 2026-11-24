-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "school_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('SUPER_ADMIN', 'SCHOOL_ADMIN');

-- CreateEnum
CREATE TYPE "billing_period" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "attendance_source" AS ENUM ('QR_SCAN', 'MANUAL');

-- CreateTable
CREATE TABLE "schools" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "status" "school_status" NOT NULL DEFAULT 'ACTIVE',
    "timezone" VARCHAR(64) NOT NULL,
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(40),
    "address" VARCHAR(500),
    "storage_quota_override_bytes" BIGINT,
    "storage_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "storage_calculated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER,
    "role" "user_role" NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),
    "storage_limit_bytes" BIGINT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "billing_period" "billing_period" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "status" "subscription_status" NOT NULL,
    "storage_limit_bytes" BIGINT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "subscription_id" INTEGER,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" VARCHAR(200),
    "paid_on" DATE NOT NULL,
    "notes" VARCHAR(1000),
    "recorded_by_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_groups" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "student_code" VARCHAR(50) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "class_group_id" INTEGER,
    "status" "student_status" NOT NULL DEFAULT 'ACTIVE',
    "photo_key" VARCHAR(300),
    "photo_bytes" INTEGER,
    "qr_token" VARCHAR(64) NOT NULL,
    "qr_issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "student_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "school_id" INTEGER NOT NULL,
    "status" "attendance_status" NOT NULL,
    "source" "attendance_source" NOT NULL,
    "marked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "marked_by_id" INTEGER,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("student_id","date")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "school_id" INTEGER,
    "actor_user_id" INTEGER,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" VARCHAR(100),
    "details" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schools_slug_key" ON "schools"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_school_id_idx" ON "users"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE INDEX "subscriptions_school_id_status_idx" ON "subscriptions"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_school_id_id_key" ON "subscriptions"("school_id", "id");

-- CreateIndex
CREATE INDEX "payments_school_id_paid_on_idx" ON "payments"("school_id", "paid_on");

-- CreateIndex
CREATE UNIQUE INDEX "class_groups_school_id_name_key" ON "class_groups"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "class_groups_school_id_id_key" ON "class_groups"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "students_qr_token_key" ON "students"("qr_token");

-- CreateIndex
CREATE INDEX "students_school_id_class_group_id_full_name_idx" ON "students"("school_id", "class_group_id", "full_name");

-- CreateIndex
CREATE INDEX "students_school_id_full_name_idx" ON "students"("school_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_student_code_key" ON "students"("school_id", "student_code");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_id_key" ON "students"("school_id", "id");

-- CreateIndex
CREATE INDEX "attendance_school_id_date_idx" ON "attendance"("school_id", "date");

-- CreateIndex
CREATE INDEX "audit_logs_school_id_created_at_idx" ON "audit_logs"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_subscription_id_fkey" FOREIGN KEY ("school_id", "subscription_id") REFERENCES "subscriptions"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_class_group_id_fkey" FOREIGN KEY ("school_id", "class_group_id") REFERENCES "class_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
--  Hand-written safety rules (Prisma cannot express these in schema)
-- =====================================================================

-- Super Admins have no school; School Admins must have one.
ALTER TABLE "users" ADD CONSTRAINT "users_role_school_check" CHECK (
  ("role" = 'SUPER_ADMIN' AND "school_id" IS NULL) OR
  ("role" = 'SCHOOL_ADMIN' AND "school_id" IS NOT NULL)
);

-- Emails are stored lowercase so "Ali@X.com" and "ali@x.com" can't both exist.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));

-- URL-safe school slugs: lowercase letters, digits and single hyphens.
ALTER TABLE "schools" ADD CONSTRAINT "schools_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Sizes and money can never be negative; storage limits must be positive.
ALTER TABLE "schools" ADD CONSTRAINT "schools_storage_check" CHECK (
  "storage_used_bytes" >= 0 AND
  ("storage_quota_override_bytes" IS NULL OR "storage_quota_override_bytes" > 0)
);
ALTER TABLE "plans" ADD CONSTRAINT "plans_values_check" CHECK ("storage_limit_bytes" > 0 AND "price_minor" >= 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_values_check" CHECK (
  "storage_limit_bytes" > 0 AND "price_minor" >= 0 AND "ends_at" > "starts_at"
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_minor" > 0);
ALTER TABLE "students" ADD CONSTRAINT "students_photo_check" CHECK (
  ("photo_key" IS NULL AND "photo_bytes" IS NULL) OR
  ("photo_key" IS NOT NULL AND "photo_bytes" IS NOT NULL AND "photo_bytes" > 0)
);

-- Currency codes are three capital letters (ISO 4217), e.g. PKR, USD.
ALTER TABLE "plans" ADD CONSTRAINT "plans_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- QR tokens must be long enough to be unguessable (at least 16 chars).
ALTER TABLE "students" ADD CONSTRAINT "students_qr_token_check" CHECK (length("qr_token") >= 16);

-- A school can have at most ONE current (trial or active) subscription.
CREATE UNIQUE INDEX "subscriptions_one_current_per_school"
  ON "subscriptions" ("school_id") WHERE "status" IN ('TRIAL', 'ACTIVE');
