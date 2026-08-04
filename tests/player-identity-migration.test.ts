import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260804000000_player_identity_uniqueness/migration.sql"
);

function readCheckedInFile(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function modelBlock(schema: string, modelName: string) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
  return match?.[0] ?? "";
}

function functionBlock(sql: string, functionName: string) {
  const start = sql.indexOf(`CREATE FUNCTION ${functionName}()`);
  const end = start === -1 ? -1 : sql.indexOf("\n$$;", start);
  return start === -1 || end === -1 ? "" : sql.slice(start, end + 4);
}

describe("player identity database migration contract", () => {
  const schema = readCheckedInFile(schemaPath);
  const sql = readCheckedInFile(migrationPath);

  it("declares globally unique player names and aliases in Prisma", () => {
    expect(modelBlock(schema, "Player")).toContain("name                String                @unique");
    expect(modelBlock(schema, "PlayerAlias")).toContain("alias     String    @unique");
    expect(modelBlock(schema, "PlayerAlias")).not.toContain("@@unique([playerId, alias])");
  });

  it("preflights all existing same-table and cross-table conflicts", () => {
    const migrationLock = sql.indexOf(
      'LOCK TABLE "Player", "PlayerAlias" IN SHARE ROW EXCLUSIVE MODE'
    );
    const preflight = sql.indexOf("DO $$");

    expect(migrationLock).toBeGreaterThan(-1);
    expect(preflight).toBeGreaterThan(migrationLock);
    expect(sql).toContain('SELECT "name" FROM "Player" GROUP BY "name" HAVING COUNT(*) > 1');
    expect(sql).toContain(
      'SELECT "alias" FROM "PlayerAlias" GROUP BY "alias" HAVING COUNT(*) > 1'
    );
    expect(sql).toContain('JOIN "PlayerAlias" a ON a."alias" = p."name"');
  });

  it("installs advisory-locking cross-table uniqueness triggers", () => {
    const playerNameFunction = functionBlock(sql, "check_player_name_identity_conflict");
    const playerAliasFunction = functionBlock(sql, "check_player_alias_identity_conflict");
    const playerNameLock = 'pg_advisory_xact_lock(hashtextextended(NEW."name", 0))';
    const playerAliasLock = 'pg_advisory_xact_lock(hashtextextended(NEW."alias", 0))';

    expect(playerNameFunction).toContain(playerNameLock);
    expect(playerAliasFunction).toContain(playerAliasLock);
    expect(playerNameFunction.indexOf(playerNameLock)).toBeLessThan(
      playerNameFunction.indexOf("EXECUTE format(")
    );
    expect(playerAliasFunction.indexOf(playerAliasLock)).toBeLessThan(
      playerAliasFunction.indexOf("EXECUTE format(")
    );
    expect(sql).toContain('CREATE TRIGGER "Player_name_identity_conflict"');
    expect(sql).toContain('CREATE TRIGGER "PlayerAlias_alias_identity_conflict"');
    expect(sql).toContain("ERRCODE = '23505'");
    expect(sql).toContain("CONSTRAINT = 'Player_name_identity_conflict'");
    expect(sql).toContain("CONSTRAINT = 'PlayerAlias_alias_identity_conflict'");
  });

  it("rejects non-READ-COMMITTED writes before snapshot-sensitive checks", () => {
    const functions = [
      functionBlock(sql, "check_player_name_identity_conflict"),
      functionBlock(sql, "check_player_alias_identity_conflict")
    ];

    for (const block of functions) {
      const isolationGuard = block.indexOf("transaction_isolation <> 'read committed'");
      const advisoryLock = block.indexOf("pg_advisory_xact_lock");
      const guardPrefix = block.slice(0, advisoryLock);

      expect(block).toContain("current_setting('transaction_isolation')");
      expect(isolationGuard).toBeGreaterThan(-1);
      expect(advisoryLock).toBeGreaterThan(isolationGuard);
      expect(guardPrefix).toContain("ERRCODE = '25000'");
      expect(guardPrefix).toContain(
        "player identity writes require READ COMMITTED transaction isolation"
      );
      expect(guardPrefix).not.toContain("ERRCODE = '23505'");
    }
  });

  it("queries the peer table through the trigger table's safely quoted schema", () => {
    const playerNameFunction = functionBlock(sql, "check_player_name_identity_conflict");
    const playerAliasFunction = functionBlock(sql, "check_player_alias_identity_conflict");

    expect(playerNameFunction).toContain("FROM %I.%I");
    expect(playerNameFunction).toContain("TG_TABLE_SCHEMA");
    expect(playerNameFunction).toContain("'PlayerAlias'");
    expect(playerNameFunction).toContain('USING NEW."name"');
    expect(playerNameFunction).not.toContain('FROM "PlayerAlias"');

    expect(playerAliasFunction).toContain("FROM %I.%I");
    expect(playerAliasFunction).toContain("TG_TABLE_SCHEMA");
    expect(playerAliasFunction).toContain("'Player'");
    expect(playerAliasFunction).toContain('USING NEW."alias"');
    expect(playerAliasFunction).not.toContain('FROM "Player"');
  });
});
