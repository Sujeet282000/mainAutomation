-- Serialize version-number allocation per flow. The API historically computes
-- max(version_number)+1 before INSERT; concurrent publishers can otherwise
-- choose the same number. A transaction-scoped advisory lock makes allocation
-- deterministic without requiring every caller to know the locking protocol.
CREATE OR REPLACE FUNCTION public._allocate_flow_version_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.flow_id::text, 0));
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO NEW.version_number
    FROM public.flow_versions
   WHERE flow_id = NEW.flow_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flow_versions_allocate_version_number ON public.flow_versions;
CREATE TRIGGER flow_versions_allocate_version_number
BEFORE INSERT ON public.flow_versions
FOR EACH ROW
EXECUTE FUNCTION public._allocate_flow_version_number();
