import { Router, type Request, type Response } from "express";
import { db, calendarEventsTable, usersTable, googleOAuthTokensTable, platformConnectionsTable } from "@workspace/db";
import { eq, and, gte, lte, ilike } from "drizzle-orm";
import { google } from "googleapis";
import { getOrgId } from "../middleware/tenant";

const router = Router();

interface CalendarSource {
  id: string;
  name: string;
  type: "interne" | "google" | "logiciel";
  provider: string;
  userId?: number;
  userName?: string;
  color: string;
  connected: boolean;
}

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
  source?: string;
  eventTitle?: string;
}

async function getGoogleAuthClient(userId: number, orgId: number) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const tokens = await db.select().from(googleOAuthTokensTable)
    .where(and(
      eq(googleOAuthTokensTable.userId, userId),
      eq(googleOAuthTokensTable.organisationId, orgId)
    ));
  if (tokens.length === 0) return null;

  const protocol = "https";
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG + ".repl.co";
  const redirectUri = `${protocol}://${domain}/api/google-oauth/callback`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: tokens[0].accessToken,
    refresh_token: tokens[0].refreshToken,
  });
  return oauth2Client;
}

async function verifyUserInOrg(targetUserId: number, orgId: number): Promise<boolean> {
  const [user] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.id, targetUserId), eq(usersTable.organisationId, orgId)));
  return !!user;
}

router.get("/prospect-calendar/sources", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const sources: CalendarSource[] = [];

    const teamMembers = await db.select({
      id: usersTable.id,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
      actif: usersTable.actif,
    }).from(usersTable).where(and(
      eq(usersTable.organisationId, orgId),
      eq(usersTable.actif, true)
    ));

    for (const member of teamMembers) {
      sources.push({
        id: `interne_${member.id}`,
        name: `${member.prenom} ${member.nom}`,
        type: "interne",
        provider: "Agent de Bureau",
        userId: member.id,
        userName: `${member.prenom} ${member.nom}`,
        color: "#6366f1",
        connected: true,
      });

      const googleTokens = await db.select().from(googleOAuthTokensTable)
        .where(and(
          eq(googleOAuthTokensTable.userId, member.id),
          eq(googleOAuthTokensTable.organisationId, orgId)
        ));
      if (googleTokens.length > 0) {
        const scope = googleTokens[0].scope || "";
        if (scope.includes("calendar")) {
          sources.push({
            id: `google_${member.id}`,
            name: `Google Agenda - ${member.prenom} ${member.nom}`,
            type: "google",
            provider: "Google Calendar",
            userId: member.id,
            userName: `${member.prenom} ${member.nom}`,
            color: "#4285F4",
            connected: true,
          });
        }
      }
    }

    const connections = await db.select().from(platformConnectionsTable)
      .where(eq(platformConnectionsTable.status, "connecte"));

    for (const conn of connections) {
      const config = conn.config as any;
      if (config?.hasCalendar || conn.serviceId?.includes("calendar") || conn.serviceId?.includes("agenda") ||
          conn.platform?.includes("outlook") || conn.platform?.includes("office365") ||
          conn.platform?.includes("apple") || conn.platform?.includes("caldav")) {
        sources.push({
          id: `logiciel_${conn.id}`,
          name: `${conn.serviceName} - Calendrier`,
          type: "logiciel",
          provider: conn.platform,
          color: "#f59e0b",
          connected: true,
        });
      }
    }

    res.json({ sources, totalSources: sources.length });
  } catch (err: any) {
    console.error("Erreur sources calendrier:", err);
    res.status(500).json({ error: "Erreur lors de la recherche des calendriers" });
  }
});

router.get("/prospect-calendar/team-members", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);

    const teamMembers = await db.select({
      id: usersTable.id,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
    }).from(usersTable).where(and(
      eq(usersTable.organisationId, orgId),
      eq(usersTable.actif, true)
    ));

    const membersWithSync = await Promise.all(teamMembers.map(async (member) => {
      const googleTokens = await db.select().from(googleOAuthTokensTable)
        .where(and(
          eq(googleOAuthTokensTable.userId, member.id),
          eq(googleOAuthTokensTable.organisationId, orgId)
        ));
      const hasGoogleSync = googleTokens.length > 0 && (googleTokens[0].scope || "").includes("calendar");
      return { ...member, hasGoogleSync };
    }));

    res.json({ members: membersWithSync });
  } catch (err: any) {
    console.error("Erreur team-members:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/prospect-calendar/availability", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const targetUserId = req.query.userId ? parseInt(req.query.userId as string) : null;
    const dateStr = req.query.date as string;
    const daysAhead = parseInt(req.query.days as string) || 7;

    if (!targetUserId) { res.status(400).json({ error: "userId requis" }); return; }

    if (!(await verifyUserInOrg(targetUserId, orgId))) {
      res.status(403).json({ error: "Utilisateur non autorise" }); return;
    }

    const startDate = dateStr ? new Date(dateStr) : new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    endDate.setHours(23, 59, 59, 999);

    const busySlots: Array<{ start: Date; end: Date; source: string; title: string }> = [];

    const internalEvents = await db.select().from(calendarEventsTable).where(and(
      eq(calendarEventsTable.organisationId, orgId),
      eq(calendarEventsTable.createdBy, targetUserId),
      gte(calendarEventsTable.startDate, startDate),
      lte(calendarEventsTable.endDate, endDate)
    ));

    for (const evt of internalEvents) {
      busySlots.push({
        start: new Date(evt.startDate),
        end: new Date(evt.endDate),
        source: "Agent de Bureau",
        title: evt.title,
      });
    }

    try {
      const auth = await getGoogleAuthClient(targetUserId, orgId);
      if (auth) {
        const calendar = google.calendar({ version: "v3", auth });
        const response = await calendar.events.list({
          calendarId: "primary",
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 100,
        });

        for (const evt of response.data.items || []) {
          const evtStart = evt.start?.dateTime || evt.start?.date;
          const evtEnd = evt.end?.dateTime || evt.end?.date;
          if (evtStart && evtEnd) {
            busySlots.push({
              start: new Date(evtStart),
              end: new Date(evtEnd),
              source: "Google Agenda",
              title: evt.summary || "(Sans titre)",
            });
          }
        }
      }
    } catch (e: any) {
      console.warn("Google Calendar non accessible pour user", targetUserId, e.message);
    }

    const availableSlots: TimeSlot[] = [];
    const WORK_START = 9;
    const WORK_END = 18;
    const SLOT_MINUTES = 30;

    for (let d = 0; d < daysAhead; d++) {
      const day = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
      const dayOfWeek = day.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      for (let h = WORK_START; h < WORK_END; h++) {
        for (let m = 0; m < 60; m += SLOT_MINUTES) {
          const slotStart = new Date(day);
          slotStart.setHours(h, m, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60 * 1000);

          if (slotStart < new Date()) continue;

          const conflict = busySlots.find(b =>
            slotStart < b.end && slotEnd > b.start
          );

          availableSlots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            available: !conflict,
            source: conflict?.source,
            eventTitle: conflict?.title,
          });
        }
      }
    }

    const freeSlots = availableSlots.filter(s => s.available);
    const suggestedSlots = freeSlots.slice(0, 10);

    res.json({
      userId: targetUserId,
      period: { start: startDate.toISOString(), end: endDate.toISOString() },
      totalSlots: availableSlots.length,
      freeSlots: freeSlots.length,
      busySlots: busySlots.length,
      suggestedSlots,
      allSlots: availableSlots,
    });
  } catch (err: any) {
    console.error("Erreur disponibilite:", err);
    res.status(500).json({ error: "Erreur lors de la verification de disponibilite" });
  }
});

router.post("/prospect-calendar/schedule", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const { prospectId, prospectTitle, assignedUserId, startDate, endDate, title, description, type, syncGoogle, contactName, contactEmail, contactPhone, company } = req.body;

    if (!assignedUserId || !startDate || !endDate) {
      res.status(400).json({ error: "Champs requis: assignedUserId, startDate, endDate" }); return;
    }

    if (!(await verifyUserInOrg(assignedUserId, orgId))) {
      res.status(403).json({ error: "Utilisateur non autorise" }); return;
    }

    const eventTitle = title || `RDV Prospect: ${prospectTitle || "Sans titre"}`;
    const eventDescription = [
      description || "",
      `\n--- Prospect ---`,
      `[prospect_id:${prospectId || ""}]`,
      prospectTitle ? `Titre: ${prospectTitle}` : "",
      contactName ? `Contact: ${contactName}` : "",
      company ? `Societe: ${company}` : "",
      contactEmail ? `Email: ${contactEmail}` : "",
      contactPhone ? `Tel: ${contactPhone}` : "",
    ].filter(Boolean).join("\n");

    const [calEvent] = await db.insert(calendarEventsTable).values({
      organisationId: orgId,
      title: eventTitle,
      description: eventDescription,
      type: type || "rendez_vous",
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      allDay: false,
      color: "#6366f1",
      contactName: contactName || null,
      contactPhone: contactPhone || null,
      contactEmail: contactEmail || null,
      contactCompany: company || null,
      status: "confirme",
      priority: "normale",
      createdBy: assignedUserId,
    }).returning();

    let googleEventId: string | null = null;
    if (syncGoogle) {
      try {
        const auth = await getGoogleAuthClient(assignedUserId, orgId);
        if (auth) {
          const calendar = google.calendar({ version: "v3", auth });
          const googleEvent = await calendar.events.insert({
            calendarId: "primary",
            requestBody: {
              summary: eventTitle,
              description: eventDescription,
              start: { dateTime: new Date(startDate).toISOString(), timeZone: "Europe/Paris" },
              end: { dateTime: new Date(endDate).toISOString(), timeZone: "Europe/Paris" },
              attendees: contactEmail ? [{ email: contactEmail }] : undefined,
              reminders: { useDefault: false, overrides: [
                { method: "popup", minutes: 30 },
                { method: "email", minutes: 60 },
              ] },
            },
          });
          googleEventId = googleEvent.data.id || null;
        }
      } catch (e: any) {
        console.warn("Google Calendar sync echoue:", e.message);
      }
    }

    res.status(201).json({
      calendarEvent: calEvent,
      googleEventId,
      synced: {
        interne: true,
        google: !!googleEventId,
      },
    });
  } catch (err: any) {
    console.error("Erreur planification prospect:", err);
    res.status(500).json({ error: "Erreur lors de la planification" });
  }
});

router.get("/prospect-calendar/events/:prospectId", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const prospectId = String(req.params.prospectId);

    const events = await db.select().from(calendarEventsTable).where(and(
      eq(calendarEventsTable.organisationId, orgId),
      ilike(calendarEventsTable.description, `%[prospect_id:${prospectId}]%`)
    ));

    res.json({ events });
  } catch (err: any) {
    console.error("Erreur evenements prospect:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/prospect-calendar/team-availability", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const dateStr = req.query.date as string;
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const teamMembers = await db.select({
      id: usersTable.id,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
    }).from(usersTable).where(and(
      eq(usersTable.organisationId, orgId),
      eq(usersTable.actif, true)
    ));

    const teamAvailability: Array<{
      userId: number;
      userName: string;
      role: string;
      eventsCount: number;
      freeSlots: number;
      nextAvailable: string | null;
      hasGoogleSync: boolean;
    }> = [];

    for (const member of teamMembers) {
      const events = await db.select().from(calendarEventsTable).where(and(
        eq(calendarEventsTable.organisationId, orgId),
        eq(calendarEventsTable.createdBy, member.id),
        gte(calendarEventsTable.startDate, targetDate),
        lte(calendarEventsTable.endDate, dayEnd)
      ));

      const googleTokens = await db.select().from(googleOAuthTokensTable)
        .where(and(
          eq(googleOAuthTokensTable.userId, member.id),
          eq(googleOAuthTokensTable.organisationId, orgId)
        ));
      const hasGoogleSync = googleTokens.length > 0 && (googleTokens[0].scope || "").includes("calendar");

      let googleEventsCount = 0;
      if (hasGoogleSync) {
        try {
          const auth = await getGoogleAuthClient(member.id, orgId);
          if (auth) {
            const calendar = google.calendar({ version: "v3", auth });
            const resp = await calendar.events.list({
              calendarId: "primary",
              timeMin: targetDate.toISOString(),
              timeMax: dayEnd.toISOString(),
              singleEvents: true,
              maxResults: 50,
            });
            googleEventsCount = resp.data.items?.length || 0;
          }
        } catch { }
      }

      const totalEvents = events.length + googleEventsCount;
      const totalWorkSlots = 18;
      const freeSlots = Math.max(0, totalWorkSlots - totalEvents);

      let nextAvailable: string | null = null;
      const now = new Date();
      const WORK_START = 9;
      const WORK_END = 18;
      for (let h = WORK_START; h < WORK_END; h++) {
        for (let m = 0; m < 60; m += 30) {
          const slotStart = new Date(targetDate);
          slotStart.setHours(h, m, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
          if (slotStart < now) continue;
          const conflict = events.some(e =>
            slotStart < new Date(e.endDate) && slotEnd > new Date(e.startDate)
          );
          if (!conflict) {
            nextAvailable = slotStart.toISOString();
            break;
          }
        }
        if (nextAvailable) break;
      }

      teamAvailability.push({
        userId: member.id,
        userName: `${member.prenom} ${member.nom}`,
        role: member.role,
        eventsCount: totalEvents,
        freeSlots,
        nextAvailable,
        hasGoogleSync,
      });
    }

    teamAvailability.sort((a, b) => b.freeSlots - a.freeSlots);

    res.json({ date: targetDate.toISOString(), team: teamAvailability });
  } catch (err: any) {
    console.error("Erreur disponibilite equipe:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

export default router;
