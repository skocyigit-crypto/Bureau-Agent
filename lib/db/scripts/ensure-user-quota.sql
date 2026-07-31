CREATE OR REPLACE FUNCTION enforce_organisation_user_quota()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE configured_max integer; active_count integer;
BEGIN
  IF NEW.organisation_id IS NULL OR COALESCE(NEW.actif, true) = false THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.organisation_id IS NOT DISTINCT FROM NEW.organisation_id
     AND COALESCE(OLD.actif, true) = true THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(74291, NEW.organisation_id);
  SELECT max_users INTO configured_max FROM organisations WHERE id = NEW.organisation_id FOR UPDATE;
  IF configured_max IS NULL THEN RAISE EXCEPTION 'tenant_not_found:%', NEW.organisation_id USING ERRCODE = '23503'; END IF;
  SELECT count(*) INTO active_count FROM users WHERE organisation_id = NEW.organisation_id AND actif = true;
  IF active_count >= configured_max THEN
    RAISE EXCEPTION 'user_quota_exceeded:%/%', active_count, configured_max USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $func$;
DROP TRIGGER IF EXISTS users_enforce_organisation_quota ON users;
CREATE TRIGGER users_enforce_organisation_quota
BEFORE INSERT OR UPDATE OF organisation_id, actif ON users
FOR EACH ROW EXECUTE FUNCTION enforce_organisation_user_quota();