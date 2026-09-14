-- Flow versions are immutable to application edits, but they are owned by a flow.
-- Deleting the parent flow must still be able to cascade-delete its historical
-- snapshots. Direct UPDATE/DELETE of a version while its flow exists remains
-- blocked by the immutability trigger.
CREATE OR REPLACE FUNCTION internal.prevent_flow_version_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    -- This DELETE is being reached through a referential-action cascade from
    -- flows -> flow_versions. It is cleanup of an owned aggregate, not an
    -- edit/delete of an individual immutable version.
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'flow_versions are immutable' USING errcode = '55000';
END;
$$;
