-- =====================================================================
--  Database safety-rule tests.
--  Runs inside a transaction that is ROLLED BACK at the end, so it
--  leaves no data behind.
--  Run with:  npm run db:test
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;
\o /dev/null
CREATE TEMP TABLE test_failures (label text);

-- Helper: run a statement that MUST fail, and report PASS/FAIL.
CREATE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE WARNING 'FAIL  % (statement was accepted)', label;
    INSERT INTO test_failures VALUES (label);
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS  % -> rejected: %', label, SQLERRM;
  END;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void AS $$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'PASS  % -> accepted', label;
EXCEPTION WHEN others THEN
  RAISE WARNING 'FAIL  % (rejected: %)', label, SQLERRM;
  INSERT INTO test_failures VALUES (label);
END $$ LANGUAGE plpgsql;

-- ---------- Sample data: two schools ----------
INSERT INTO schools (id, name, slug, timezone, updated_at) VALUES
  (9001, 'Test School A', 'test-school-a', 'Asia/Karachi', now()),
  (9002, 'Test School B', 'test-school-b', 'Asia/Karachi', now());
INSERT INTO class_groups (id, school_id, name, updated_at) VALUES
  (9001, 9001, 'Grade 1', now()),
  (9002, 9002, 'Grade 1', now());
INSERT INTO students (id, school_id, student_code, full_name, class_group_id, qr_token, updated_at) VALUES
  (9001, 9001, 'A-001', 'Student A', 9001, 'tokenAAAAAAAAAAAAAAAAA', now()),
  (9002, 9002, 'B-001', 'Student B', 9002, 'tokenBBBBBBBBBBBBBBBBBB', now());
INSERT INTO plans (id, name, storage_limit_bytes, price_minor, currency, billing_period, updated_at) VALUES
  (9001, 'Test Plan', 524288000, 250000, 'PKR', 'MONTHLY', now());

\echo '--- Tenant isolation (cross-school links) ---'
SELECT pg_temp.expect_fail('Attendance for School B student filed under School A',
  $q$INSERT INTO attendance (student_id, date, school_id, status, source) VALUES (9002, '2026-11-24', 9001, 'PRESENT', 'QR_SCAN')$q$);
SELECT pg_temp.expect_fail('School A student placed in School B class',
  $q$UPDATE students SET class_group_id = 9002 WHERE id = 9001$q$);
-- (Both schools already have a class named 'Grade 1' in the sample data,
--  which proves the same class name is allowed in different schools.)

\echo '--- Attendance rules ---'
SELECT pg_temp.expect_ok('First attendance of the day',
  $q$INSERT INTO attendance (student_id, date, school_id, status, source) VALUES (9001, '2026-11-24', 9001, 'PRESENT', 'QR_SCAN')$q$);
SELECT pg_temp.expect_fail('Duplicate attendance same student same day',
  $q$INSERT INTO attendance (student_id, date, school_id, status, source) VALUES (9001, '2026-11-24', 9001, 'PRESENT', 'QR_SCAN')$q$);
SELECT pg_temp.expect_ok('Same student, next day',
  $q$INSERT INTO attendance (student_id, date, school_id, status, source) VALUES (9001, '2026-11-25', 9001, 'ABSENT', 'MANUAL')$q$);
SELECT pg_temp.expect_fail('Deleting a student who has attendance history',
  $q$DELETE FROM students WHERE id = 9001$q$);
SELECT pg_temp.expect_fail('Deleting a school that has data',
  $q$DELETE FROM schools WHERE id = 9001$q$);

\echo '--- Students ---'
SELECT pg_temp.expect_fail('Duplicate student code in same school',
  $q$INSERT INTO students (school_id, student_code, full_name, qr_token, updated_at) VALUES (9001, 'A-001', 'Dup', 'tokenCCCCCCCCCCCCCCCCCC', now())$q$);
SELECT pg_temp.expect_ok('Same student code in a different school',
  $q$INSERT INTO students (school_id, student_code, full_name, qr_token, updated_at) VALUES (9002, 'A-001', 'Other', 'tokenDDDDDDDDDDDDDDDDDD', now())$q$);
SELECT pg_temp.expect_fail('Duplicate QR token',
  $q$INSERT INTO students (school_id, student_code, full_name, qr_token, updated_at) VALUES (9001, 'A-002', 'X', 'tokenAAAAAAAAAAAAAAAAA', now())$q$);
SELECT pg_temp.expect_fail('QR token too short (guessable)',
  $q$INSERT INTO students (school_id, student_code, full_name, qr_token, updated_at) VALUES (9001, 'A-003', 'X', 'abc123', now())$q$);
SELECT pg_temp.expect_fail('Photo key without photo size',
  $q$UPDATE students SET photo_key = 'photos/x.jpg' WHERE id = 9001$q$);

\echo '--- Users ---'
SELECT pg_temp.expect_fail('School Admin without a school',
  $q$INSERT INTO users (role, email, full_name, updated_at) VALUES ('SCHOOL_ADMIN', 'a@x.com', 'A', now())$q$);
SELECT pg_temp.expect_fail('Super Admin attached to a school',
  $q$INSERT INTO users (role, school_id, email, full_name, updated_at) VALUES ('SUPER_ADMIN', 9001, 'b@x.com', 'B', now())$q$);
SELECT pg_temp.expect_fail('Email with capital letters',
  $q$INSERT INTO users (role, school_id, email, full_name, updated_at) VALUES ('SCHOOL_ADMIN', 9001, 'Ali@X.com', 'C', now())$q$);
SELECT pg_temp.expect_ok('Two admins for the same school',
  $q$INSERT INTO users (role, school_id, email, full_name, updated_at) VALUES ('SCHOOL_ADMIN', 9001, 'one@x.com', 'One', now()), ('SCHOOL_ADMIN', 9001, 'two@x.com', 'Two', now())$q$);

\echo '--- Schools, plans, subscriptions, payments ---'
SELECT pg_temp.expect_fail('School slug with spaces/capitals',
  $q$INSERT INTO schools (name, slug, timezone, updated_at) VALUES ('X', 'Bad Slug', 'UTC', now())$q$);
SELECT pg_temp.expect_fail('Plan with zero storage',
  $q$INSERT INTO plans (name, storage_limit_bytes, price_minor, currency, billing_period, updated_at) VALUES ('Zero', 0, 0, 'PKR', 'MONTHLY', now())$q$);
SELECT pg_temp.expect_fail('Invalid currency code',
  $q$INSERT INTO plans (name, storage_limit_bytes, price_minor, currency, billing_period, updated_at) VALUES ('Cur', 1, 0, 'rs', 'MONTHLY', now())$q$);
SELECT pg_temp.expect_ok('First active subscription',
  $q$INSERT INTO subscriptions (id, school_id, plan_id, status, storage_limit_bytes, price_minor, currency, starts_at, ends_at, updated_at) VALUES (9001, 9001, 9001, 'ACTIVE', 524288000, 250000, 'PKR', '2026-11-01', '2026-12-01', now())$q$);
SELECT pg_temp.expect_fail('Second active subscription for same school',
  $q$INSERT INTO subscriptions (school_id, plan_id, status, storage_limit_bytes, price_minor, currency, starts_at, ends_at, updated_at) VALUES (9001, 9001, 'TRIAL', 524288000, 0, 'PKR', '2026-11-01', '2026-12-01', now())$q$);
SELECT pg_temp.expect_ok('Old expired subscription alongside the active one',
  $q$INSERT INTO subscriptions (school_id, plan_id, status, storage_limit_bytes, price_minor, currency, starts_at, ends_at, updated_at) VALUES (9001, 9001, 'EXPIRED', 524288000, 250000, 'PKR', '2026-10-01', '2026-11-01', now())$q$);
SELECT pg_temp.expect_fail('Subscription ending before it starts',
  $q$INSERT INTO subscriptions (school_id, plan_id, status, storage_limit_bytes, price_minor, currency, starts_at, ends_at, updated_at) VALUES (9002, 9001, 'ACTIVE', 1, 0, 'PKR', '2026-12-01', '2026-11-01', now())$q$);
SELECT pg_temp.expect_fail('Payment by School B against School A subscription',
  $q$INSERT INTO payments (school_id, subscription_id, amount_minor, currency, method, paid_on) VALUES (9002, 9001, 1000, 'PKR', 'CASH', '2026-11-24')$q$);
SELECT pg_temp.expect_fail('Zero or negative payment',
  $q$INSERT INTO payments (school_id, amount_minor, currency, method, paid_on) VALUES (9001, 0, 'PKR', 'CASH', '2026-11-24')$q$);
SELECT pg_temp.expect_ok('Valid payment',
  $q$INSERT INTO payments (school_id, subscription_id, amount_minor, currency, method, paid_on) VALUES (9001, 9001, 250000, 'PKR', 'BANK_TRANSFER', '2026-11-24')$q$);

-- Stop with an error if any check failed.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM test_failures;
  IF n > 0 THEN
    RAISE EXCEPTION '% CHECK(S) FAILED', n;
  END IF;
  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;
\echo '--- Done. All test data rolled back. ---'
