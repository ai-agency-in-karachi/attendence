-- =====================================================================
--  Row-Level Security: the database's own wall between schools.
--
--  The app declares who is asking at the start of every transaction:
--     set_config('app.role', 'school_admin' | 'super_admin' | 'system', true)
--     set_config('app.school_id', '<id>', true)       -- school_admin only
--  (`true` = transaction-local: the values vanish at COMMIT/ROLLBACK, so
--   they can never leak to the next request on a pooled connection.)
--
--  No context set  =>  every protected table looks EMPTY (fails closed).
--
--  FORCE ROW LEVEL SECURITY makes the rules apply to the table owner too
--  (the app currently connects as the owner).
--
--  NOTE for future data migrations: plain INSERT/UPDATE/DELETE inside a
--  migration must first run:  SELECT set_config('app.role', 'system', true);
-- =====================================================================

-- ---------- Context helper functions ----------

-- The school the current request belongs to (NULL if none).
CREATE FUNCTION app_current_school_id() RETURNS integer
  LANGUAGE sql STABLE
  AS $$ SELECT CASE WHEN current_setting('app.role', true) = 'school_admin'
                    THEN nullif(current_setting('app.school_id', true), '')::integer
               END $$;

-- The current request's role ('school_admin', 'super_admin', 'system' or NULL).
CREATE FUNCTION app_current_role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.role', true), '') $$;

-- Super Admin requests and internal system tasks see the whole platform.
CREATE FUNCTION app_is_platform() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(app_current_role() IN ('super_admin', 'system'), false) $$;

-- Policies use "(SELECT fn())" so PostgreSQL evaluates the function once
-- per query instead of once per row (keeps indexes fast).

-- ---------- Turn RLS on (and force it for the owner) ----------
ALTER TABLE "schools"       ENABLE ROW LEVEL SECURITY; ALTER TABLE "schools"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "users"         ENABLE ROW LEVEL SECURITY; ALTER TABLE "users"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "plans"         ENABLE ROW LEVEL SECURITY; ALTER TABLE "plans"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payments"      ENABLE ROW LEVEL SECURITY; ALTER TABLE "payments"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "class_groups"  ENABLE ROW LEVEL SECURITY; ALTER TABLE "class_groups"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "students"      ENABLE ROW LEVEL SECURITY; ALTER TABLE "students"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance"    ENABLE ROW LEVEL SECURITY; ALTER TABLE "attendance"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "sessions"      ENABLE ROW LEVEL SECURITY; ALTER TABLE "sessions"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"    ENABLE ROW LEVEL SECURITY; ALTER TABLE "audit_logs"    FORCE ROW LEVEL SECURITY;

-- ---------- Platform (Super Admin + system): full access ----------
-- (except sessions and audit_logs, handled separately below)
CREATE POLICY platform_all ON "schools"       USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY platform_all ON "users"         USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY platform_all ON "plans"         USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY platform_all ON "subscriptions" USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY platform_all ON "payments"      USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY platform_all ON "class_groups"  USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY platform_all ON "students"      USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY platform_all ON "attendance"    USING ((SELECT app_is_platform())) WITH CHECK ((SELECT app_is_platform()));

-- ---------- School Admin: READ-ONLY access to own school's account data ----------
CREATE POLICY school_read ON "schools"       FOR SELECT USING ("id"        = (SELECT app_current_school_id()));
CREATE POLICY school_read ON "users"         FOR SELECT USING ("school_id" = (SELECT app_current_school_id()));
CREATE POLICY school_read ON "subscriptions" FOR SELECT USING ("school_id" = (SELECT app_current_school_id()));
CREATE POLICY school_read ON "payments"      FOR SELECT USING ("school_id" = (SELECT app_current_school_id()));
-- Plans are the public price list: any School Admin may read them.
CREATE POLICY school_read ON "plans"         FOR SELECT USING ((SELECT app_current_school_id()) IS NOT NULL);

-- ---------- School Admin: FULL access to own school's working data ----------
CREATE POLICY school_all ON "class_groups"
  USING ("school_id" = (SELECT app_current_school_id()))
  WITH CHECK ("school_id" = (SELECT app_current_school_id()));
CREATE POLICY school_all ON "students"
  USING ("school_id" = (SELECT app_current_school_id()))
  WITH CHECK ("school_id" = (SELECT app_current_school_id()));
CREATE POLICY school_all ON "attendance"
  USING ("school_id" = (SELECT app_current_school_id()))
  WITH CHECK ("school_id" = (SELECT app_current_school_id()));

-- ---------- Sessions: only the internal login system ----------
CREATE POLICY system_all ON "sessions"
  USING ((SELECT app_current_role()) = 'system')
  WITH CHECK ((SELECT app_current_role()) = 'system');

-- ---------- Audit log: add and read only. Nobody can edit or delete. ----------
CREATE POLICY platform_read ON "audit_logs" FOR SELECT USING ((SELECT app_is_platform()));
CREATE POLICY platform_insert ON "audit_logs" FOR INSERT WITH CHECK ((SELECT app_is_platform()));
CREATE POLICY school_read ON "audit_logs" FOR SELECT
  USING ("school_id" = (SELECT app_current_school_id()));
CREATE POLICY school_insert ON "audit_logs" FOR INSERT
  WITH CHECK ("school_id" = (SELECT app_current_school_id()));
-- (No UPDATE or DELETE policy exists, so both are always refused.)
