import { db, usersTable } from "@workspace/db";
import { sql, inArray } from "drizzle-orm";

export async function resolveUserNames(userIds: (number | null | undefined)[]): Promise<Map<number, string>> {
  const ids = [...new Set(userIds.filter((id): id is number => id != null && id > 0))];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      id: usersTable.id,
      displayName: sql<string>`COALESCE(${usersTable.prenom} || ' ' || SUBSTRING(${usersTable.nom}, 1, 1) || '.', ${usersTable.email})`,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));

  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(row.id, row.displayName);
  }
  return map;
}

export function enrichWithUserNames<T extends Record<string, any>>(
  records: T[],
  userMap: Map<number, string>
): (T & { createdByName?: string; updatedByName?: string })[] {
  return records.map((r) => ({
    ...r,
    createdByName: r.createdBy ? userMap.get(r.createdBy) ?? null : null,
    updatedByName: r.updatedBy ? userMap.get(r.updatedBy) ?? null : null,
  }));
}

export function enrichSingle<T extends Record<string, any>>(
  record: T,
  userMap: Map<number, string>
): T & { createdByName?: string; updatedByName?: string } {
  return {
    ...record,
    createdByName: record.createdBy ? userMap.get(record.createdBy) ?? null : null,
    updatedByName: record.updatedBy ? userMap.get(record.updatedBy) ?? null : null,
  };
}
