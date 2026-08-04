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

describe("player identity database migration contract", () => {
  const schema = readCheckedInFile(schemaPath);
  const sql = readCheckedInFile(migrationPath);

  it("declares globally unique player names and aliases in Prisma", () => {
    expect(modelBlock(schema, "Player")).toContain("name                String                @unique");
    expect(modelBlock(schema, "PlayerAlias")).toContain("alias     String    @unique");
    expect(modelBlock(schema, "PlayerAlias")).not.toContain("@@unique([playerId, alias])");
  });

  it("preflights all existing same-table and cross-table conflicts", () => {
    expect(sql).toContain('SELECT "name" FROM "Player" GROUP BY "name" HAVING COUNT(*) > 1');
    expect(sql).toContain(
      'SELECT "alias" FROM "PlayerAlias" GROUP BY "alias" HAVING COUNT(*) > 1'
    );
    expect(sql).toContain('JOIN "PlayerAlias" a ON a."alias" = p."name"');
  });

  it("installs advisory-locking cross-table uniqueness triggers", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain('CREATE TRIGGER "Player_name_identity_conflict"');
    expect(sql).toContain('CREATE TRIGGER "PlayerAlias_alias_identity_conflict"');
    expect(sql).toContain("ERRCODE = '23505'");
    expect(sql).toContain("CONSTRAINT = 'Player_name_identity_conflict'");
    expect(sql).toContain("CONSTRAINT = 'PlayerAlias_alias_identity_conflict'");
  });
});
