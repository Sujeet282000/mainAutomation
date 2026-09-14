-- Flow versions are immutable to application edits, but they are owned by a flow.
-- Deleting the parent flow must still be able to cascade-delete its historical
-- snapshots. A direct DELETE of a version while its parent flow exists remains
-- blocked. PostgreSQL referential actions execute DELETE on the child table,
-- so the parent-existence check cleanly distinguishes aggregate cleanup from
-- an attempted direct version deletion.
CREATE OR REPLACE FUNCTION internal.prevent_flow_version_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.flows
      WHERE id = OLD.flow_id
        AND org_id = OLD.org_id
    ) THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'flow_versions are immutable' USING errcode = '55000';
END;
$$;
