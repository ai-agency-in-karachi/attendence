-- CreateTable
CREATE TABLE "student_photos" (
    "student_id" INTEGER NOT NULL,
    "school_id" INTEGER NOT NULL,
    "content_type" VARCHAR(30) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_photos_pkey" PRIMARY KEY ("student_id")
);

-- CreateIndex
CREATE INDEX "student_photos_school_id_idx" ON "student_photos"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_photos_school_id_student_id_key" ON "student_photos"("school_id", "student_id");

-- AddForeignKey
ALTER TABLE "student_photos" ADD CONSTRAINT "student_photos_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_photos" ADD CONSTRAINT "student_photos_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
--  Safety rules
-- ---------------------------------------------------------------------
ALTER TABLE "student_photos" ADD CONSTRAINT "student_photos_values_check" CHECK (
  "bytes" > 0 AND "bytes" = octet_length("data") AND
  "content_type" IN ('image/jpeg', 'image/png', 'image/webp')
);

-- ---------------------------------------------------------------------
--  Row-Level Security (same rules as students)
-- ---------------------------------------------------------------------
ALTER TABLE "student_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON "student_photos"
  USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY school_all ON "student_photos"
  USING ("school_id" = (SELECT app_current_school_id()))
  WITH CHECK ("school_id" = (SELECT app_current_school_id()));
