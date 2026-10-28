CREATE FUNCTION "lock_username_claim"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	old_name text;
	new_name text;
	locked_name text;
BEGIN
	IF TG_OP <> 'INSERT' THEN old_name := lower(OLD."username"); END IF;
	IF TG_OP <> 'DELETE' THEN new_name := lower(NEW."username"); END IF;
	-- Claims and releases share transaction locks; ordering avoids opposite-rename deadlocks.
	FOR locked_name IN SELECT DISTINCT name FROM unnest(ARRAY[old_name, new_name]) AS names(name)
		WHERE name IS NOT NULL ORDER BY name
	LOOP
		PERFORM pg_advisory_xact_lock(hashtextextended('username:' || locked_name, 0));
	END LOOP;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	IF (TG_OP = 'INSERT' OR new_name IS DISTINCT FROM old_name) AND EXISTS (
		SELECT 1 FROM "released_username"
		WHERE "username" = new_name AND "released_at" > clock_timestamp() - interval '30 days'
			AND "user_id" IS DISTINCT FROM NEW."id"
	) THEN
		RAISE unique_violation USING MESSAGE = 'Username is temporarily reserved', CONSTRAINT = 'user_username_unique';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_username_claim" BEFORE INSERT OR UPDATE OF "username" OR DELETE ON "user"
	FOR EACH ROW EXECUTE FUNCTION "lock_username_claim"();
