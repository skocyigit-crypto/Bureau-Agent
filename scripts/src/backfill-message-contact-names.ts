/**
 * One-time, idempotent backfill for `messages.contact_name`.
 *
 * Context: Task #264 makes NEW messages copy the linked contact's display name
 * into `contact_name` at creation time. Messages created before that fix that
 * are linked to a contact (`contact_id` set) but have an empty `contact_name`
 * still render as "Inconnu" in the web + mobile list/detail views.
 *
 * This script sets `contact_name` to `first_name + last_name` of the linked
 * contact for every message where:
 *   - `contact_id` is set, AND
 *   - `contact_name` is NULL or blank (whitespace-only), AND
 *   - the linked contact belongs to the SAME organisation as the message
 *     (org isolation — mirrors routes/messages.ts resolution logic).
 *
 * Messages with no linked contact are left untouched. The resolved display name
 * is the trimmed `first_name + ' ' + last_name`; rows where that would still be
 * blank are skipped (NULLIF(...,'') guard). Re-running is a no-op because the
 * WHERE clause excludes rows that already have a non-blank `contact_name`.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill-message-contact-names
 *   (add --dry-run to only count affected rows without writing)
 */
import { pool } from "@workspace/db";

const SELECT_AFFECTED = `
  SELECT count(*)::int AS count
  FROM messages m
  JOIN contacts c
    ON c.id = m.contact_id
   AND c.organisation_id = m.organisation_id
  WHERE m.contact_id IS NOT NULL
    AND (m.contact_name IS NULL OR btrim(m.contact_name) = '')
    AND nullif(btrim(c.first_name || ' ' || c.last_name), '') IS NOT NULL
`;

const UPDATE_AFFECTED = `
  UPDATE messages m
  SET contact_name = nullif(btrim(c.first_name || ' ' || c.last_name), '')
  FROM contacts c
  WHERE c.id = m.contact_id
    AND c.organisation_id = m.organisation_id
    AND m.contact_id IS NOT NULL
    AND (m.contact_name IS NULL OR btrim(m.contact_name) = '')
    AND nullif(btrim(c.first_name || ' ' || c.last_name), '') IS NOT NULL
`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const before = await pool.query<{ count: number }>(SELECT_AFFECTED);
  const toUpdate = before.rows[0]?.count ?? 0;

  if (dryRun) {
    console.log(`[dry-run] ${toUpdate} message(s) would be updated.`);
    return;
  }

  if (toUpdate === 0) {
    console.log("Nothing to backfill — all linked messages already have a name.");
    return;
  }

  const result = await pool.query(UPDATE_AFFECTED);
  console.log(`Backfill complete: ${result.rowCount ?? 0} message(s) updated.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
