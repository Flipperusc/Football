BEGIN;

-- Keep the preflight, index replacement, and trigger installation in one
-- write-free window so an application write cannot introduce a conflict
-- between the checks and the new guards becoming active.
LOCK TABLE "Player", "PlayerAlias" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT "name" FROM "Player" GROUP BY "name" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Player identity uniqueness migration blocked: duplicate player names exist.',
      HINT = 'Resolve duplicate/conflicting identities before rerunning the migration; this migration does not rename, delete, or merge data.';
  END IF;

  IF EXISTS (
    SELECT "alias" FROM "PlayerAlias" GROUP BY "alias" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Player identity uniqueness migration blocked: duplicate player aliases exist.',
      HINT = 'Resolve duplicate/conflicting identities before rerunning the migration; this migration does not rename, delete, or merge data.';
  END IF;

  IF EXISTS (
    SELECT p."name"
    FROM "Player" p
    JOIN "PlayerAlias" a ON a."alias" = p."name"
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Player identity uniqueness migration blocked: a player name is also stored as an alias.',
      HINT = 'Resolve duplicate/conflicting identities before rerunning the migration; aliases may not equal any player name, including their owner''s name.';
  END IF;
END
$$;

DROP INDEX "PlayerAlias_playerId_alias_key";
CREATE UNIQUE INDEX "Player_name_key" ON "Player"("name");
CREATE UNIQUE INDEX "PlayerAlias_alias_key" ON "PlayerAlias"("alias");

CREATE FUNCTION check_player_name_identity_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_isolation TEXT := current_setting('transaction_isolation');
  identity_conflict BOOLEAN;
BEGIN
  -- This advisory-lock protocol depends on READ COMMITTED taking a fresh
  -- snapshot for the peer-table lookup after a lock wait. Fixed-snapshot
  -- isolation could miss the transaction that just released the lock, so
  -- reject it explicitly instead of allowing a cross-table conflict through.
  IF transaction_isolation <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE = 'player identity writes require READ COMMITTED transaction isolation',
      DETAIL = format('Current transaction isolation is %s.', transaction_isolation),
      HINT = 'Retry the player identity write in a READ COMMITTED transaction.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."name", 0));

  -- TG_TABLE_SCHEMA targets the actual trigger table's schema. Identifier
  -- placeholders prevent search_path/pg_temp shadowing, while USING keeps the
  -- identity value out of the SQL string.
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE "alias" = $1)',
    TG_TABLE_SCHEMA,
    'PlayerAlias'
  )
  INTO identity_conflict
  USING NEW."name";

  IF identity_conflict THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'duplicate player identity value rejected by player-name trigger',
      CONSTRAINT = 'Player_name_identity_conflict',
      TABLE = 'Player',
      COLUMN = 'name';
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION check_player_alias_identity_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_isolation TEXT := current_setting('transaction_isolation');
  identity_conflict BOOLEAN;
BEGIN
  -- This advisory-lock protocol depends on READ COMMITTED taking a fresh
  -- snapshot for the peer-table lookup after a lock wait. Fixed-snapshot
  -- isolation could miss the transaction that just released the lock, so
  -- reject it explicitly instead of allowing a cross-table conflict through.
  IF transaction_isolation <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE = 'player identity writes require READ COMMITTED transaction isolation',
      DETAIL = format('Current transaction isolation is %s.', transaction_isolation),
      HINT = 'Retry the player identity write in a READ COMMITTED transaction.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."alias", 0));

  -- TG_TABLE_SCHEMA targets the actual trigger table's schema. Identifier
  -- placeholders prevent search_path/pg_temp shadowing, while USING keeps the
  -- identity value out of the SQL string.
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE "name" = $1)',
    TG_TABLE_SCHEMA,
    'Player'
  )
  INTO identity_conflict
  USING NEW."alias";

  IF identity_conflict THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'duplicate player identity value rejected by player-alias trigger',
      CONSTRAINT = 'PlayerAlias_alias_identity_conflict',
      TABLE = 'PlayerAlias',
      COLUMN = 'alias';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "Player_name_identity_conflict"
BEFORE INSERT OR UPDATE OF "name" ON "Player"
FOR EACH ROW
EXECUTE FUNCTION check_player_name_identity_conflict();

CREATE TRIGGER "PlayerAlias_alias_identity_conflict"
BEFORE INSERT OR UPDATE OF "alias" ON "PlayerAlias"
FOR EACH ROW
EXECUTE FUNCTION check_player_alias_identity_conflict();

COMMIT;
