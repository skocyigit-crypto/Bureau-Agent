/**
 * location-cleanup-cron.ts — KVKK 30 gun retention.
 *
 * Wave 3 slice 4. Kullanici talebi: gecmis 30 gun saklanir, sonra silinir.
 * Backend zaten okuma sirasinda 30g cap uyguluyor (defansif), ama disk
 * dolmasin diye gunluk DELETE shipliyoruz.
 *
 * Tek instance varsayimi: process basina bir setInterval. Cross-instance
 * deploy'a gecilirse bir advisory lock eklenmeli (billing-cron pattern).
 */

import { lt, sql } from "drizzle-orm";
import { db, locationEventsTable, userLocationStateTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { withHeartbeat } from "./health-agents";

/** Lue aussi par l'inventaire RGPD : une duree annoncee doit etre celle appliquee. */
export const RETENTION_DAYS = 30;
const TICK_MS = 6 * 60 * 60 * 1000; // 6 saatte bir
let timer: NodeJS.Timeout | null = null;

/**
 * Minimisation (17/09) : efface les coordonnees encore presentes. Depuis cette
 * date plus aucune n'est ecrite ; ce passage retire celles d'avant. Idempotent.
 */
export async function effacerCoordonnees(): Promise<{ evenements: number; etats: number }> {
  const evenements = await db
    .update(locationEventsTable)
    .set({ lat: null, lng: null, accuracyM: null })
    .where(sql`${locationEventsTable.lat} is not null or ${locationEventsTable.lng} is not null`)
    .returning({ id: locationEventsTable.id });
  const etats = await db
    .update(userLocationStateTable)
    .set({ lastLat: null, lastLng: null, lastAccuracyM: null })
    .where(sql`${userLocationStateTable.lastLat} is not null or ${userLocationStateTable.lastLng} is not null`)
    .returning({ userId: userLocationStateTable.userId });
  if (evenements.length > 0 || etats.length > 0) {
    logger.info({ evenements: evenements.length, etats: etats.length }, "[location-cleanup-cron] coordonnees effacees");
  }
  return { evenements: evenements.length, etats: etats.length };
}

async function tick(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    // Olay tablosu: gecmis 30g'den eski tum kayitlar.
    const eventsRes = await db
      .delete(locationEventsTable)
      .where(lt(locationEventsTable.at, cutoff))
      .returning({ id: locationEventsTable.id });
    // State tablosu: 30g'den uzun zamandir ping atmamis kullanicilarin
    // son durumu artik yarari olmadigi icin temizlenir (yeni ping
    // gelirse upsert yeniden olusturur).
    const stateRes = await db
      .delete(userLocationStateTable)
      .where(lt(userLocationStateTable.lastAt, cutoff))
      .returning({ userId: userLocationStateTable.userId });
    await effacerCoordonnees();
    if (eventsRes.length > 0 || stateRes.length > 0) {
      logger.info(
        { events: eventsRes.length, states: stateRes.length, retentionDays: RETENTION_DAYS },
        "[location-cleanup-cron] purged",
      );
    }
  } catch (err) {
    logger.error({ err }, "[location-cleanup-cron] tick failed");
  }
}

export function startLocationCleanupCron(): void {
  if (timer) return;
  // Sunucu acilirken bir kez ve sonra her TICK_MS'de bir.
  // ilk tick 60s gecikmeli — boot trafigini etkilemesin.
  setTimeout(() => {
    void tick();
  }, 60_000);
  timer = setInterval(withHeartbeat("location-cleanup", TICK_MS, tick), TICK_MS);
  // unref: cron kapanis sirasinda process'i bloke etmesin.
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ retentionDays: RETENTION_DAYS, tickMs: TICK_MS }, "[location-cleanup-cron] started");
  // Ensure sql import non-unused (placeholder for future tenant-scoped purge)
  void sql;
}
