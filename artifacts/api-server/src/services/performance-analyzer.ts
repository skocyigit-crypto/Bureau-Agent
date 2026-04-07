import { db, usersTable, auditLogsTable, checkinsTable, tasksTable, callsTable, messagesTable, calendarEventsTable, performanceReportsTable } from "@workspace/db";
import { eq, sql, gte, lte, and, count, desc } from "drizzle-orm";

interface UserMetrics {
  userId: number;
  email: string;
  nom: string;
  prenom: string;
  role: string;
  departement: string | null;
  actionsTotal: number;
  connexions: number;
  tachesCreees: number;
  tachesTerminees: number;
  appelsTraites: number;
  messagesEnvoyes: number;
  contactsAjoutes: number;
  evenementsCrees: number;
  pointages: number;
  heuresTravaillees: number;
  pausesMinutes: number;
  derniereActivite: string | null;
}

export async function gatherUserMetrics(dateDebut: Date, dateFin: Date): Promise<UserMetrics[]> {
  const users = await db.select().from(usersTable).where(eq(usersTable.actif, true));

  const metrics: UserMetrics[] = [];

  for (const user of users) {
    const fullName = `${user.prenom} ${user.nom}`;

    const [actionsResult] = await db
      .select({ count: count() })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.userId, user.id),
        gte(auditLogsTable.createdAt, dateDebut),
        lte(auditLogsTable.createdAt, dateFin)
      ));

    const [connexionsResult] = await db
      .select({ count: count() })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.userId, user.id),
        eq(auditLogsTable.action, "login"),
        gte(auditLogsTable.createdAt, dateDebut),
        lte(auditLogsTable.createdAt, dateFin)
      ));

    const [tachesCreees] = await db
      .select({ count: count() })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.userId, user.id),
        eq(auditLogsTable.action, "create"),
        eq(auditLogsTable.resource, "task"),
        gte(auditLogsTable.createdAt, dateDebut),
        lte(auditLogsTable.createdAt, dateFin)
      ));

    const [tachesTerminees] = await db
      .select({ count: count() })
      .from(tasksTable)
      .where(and(
        sql`${tasksTable.assignedTo} ILIKE ${`%${fullName}%`}`,
        eq(tasksTable.status, "terminee"),
        gte(tasksTable.updatedAt, dateDebut),
        lte(tasksTable.updatedAt, dateFin)
      ));

    const [appelsResult] = await db
      .select({ count: count() })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.userId, user.id),
        eq(auditLogsTable.action, "create"),
        eq(auditLogsTable.resource, "call"),
        gte(auditLogsTable.createdAt, dateDebut),
        lte(auditLogsTable.createdAt, dateFin)
      ));

    const [messagesResult] = await db
      .select({ count: count() })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.userId, user.id),
        eq(auditLogsTable.action, "create"),
        eq(auditLogsTable.resource, "message"),
        gte(auditLogsTable.createdAt, dateDebut),
        lte(auditLogsTable.createdAt, dateFin)
      ));

    const [contactsResult] = await db
      .select({ count: count() })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.userId, user.id),
        eq(auditLogsTable.action, "create"),
        eq(auditLogsTable.resource, "contact"),
        gte(auditLogsTable.createdAt, dateDebut),
        lte(auditLogsTable.createdAt, dateFin)
      ));

    const [evenementsResult] = await db
      .select({ count: count() })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.userId, user.id),
        eq(auditLogsTable.action, "create"),
        eq(auditLogsTable.resource, "calendar_event"),
        gte(auditLogsTable.createdAt, dateDebut),
        lte(auditLogsTable.createdAt, dateFin)
      ));

    const pointagesData = await db
      .select()
      .from(checkinsTable)
      .where(and(
        sql`${checkinsTable.employeeName} ILIKE ${`%${fullName}%`}`,
        gte(checkinsTable.checkInAt, dateDebut),
        lte(checkinsTable.checkInAt, dateFin)
      ));

    const heuresTravaillees = pointagesData.reduce((sum, p) => sum + (p.totalMinutes || 0), 0) / 60;
    const pausesMinutes = pointagesData.reduce((sum, p) => sum + (p.breakMinutes || 0), 0);

    const [derniereAction] = await db
      .select({ createdAt: auditLogsTable.createdAt })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.userId, user.id))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(1);

    metrics.push({
      userId: user.id,
      email: user.email,
      nom: user.nom,
      prenom: user.prenom,
      role: user.role,
      departement: user.departement || null,
      actionsTotal: actionsResult?.count || 0,
      connexions: connexionsResult?.count || 0,
      tachesCreees: tachesCreees?.count || 0,
      tachesTerminees: tachesTerminees?.count || 0,
      appelsTraites: appelsResult?.count || 0,
      messagesEnvoyes: messagesResult?.count || 0,
      contactsAjoutes: contactsResult?.count || 0,
      evenementsCrees: evenementsResult?.count || 0,
      pointages: pointagesData.length,
      heuresTravaillees: Math.round(heuresTravaillees * 10) / 10,
      pausesMinutes,
      derniereActivite: derniereAction?.createdAt?.toISOString() || null,
    });
  }

  return metrics;
}

export async function generatePerformanceReport(
  periode: "jour" | "semaine" | "mois",
  userId?: number
): Promise<any> {
  const now = new Date();
  let dateDebut: Date;

  if (periode === "jour") {
    dateDebut = new Date(now);
    dateDebut.setHours(0, 0, 0, 0);
  } else if (periode === "semaine") {
    dateDebut = new Date(now);
    dateDebut.setDate(dateDebut.getDate() - 7);
  } else {
    dateDebut = new Date(now);
    dateDebut.setMonth(dateDebut.getMonth() - 1);
  }

  let allMetrics = await gatherUserMetrics(dateDebut, now);

  if (userId) {
    allMetrics = allMetrics.filter(m => m.userId === userId);
  }

  if (allMetrics.length === 0) {
    return {
      periode,
      dateDebut: dateDebut.toISOString(),
      dateFin: now.toISOString(),
      employes: [],
      analyseIA: null,
      message: "Aucun employe actif trouve pour cette periode.",
    };
  }

  const metricsJSON = JSON.stringify(allMetrics, null, 2);
  const periodeStr = `${dateDebut.toLocaleDateString("fr-FR")} au ${now.toLocaleDateString("fr-FR")}`;

  const [geminiResult, openaiResult, anthropicResult] = await Promise.all([
    analyzeWithGemini(metricsJSON, periodeStr),
    analyzeWithOpenAI(metricsJSON, periodeStr),
    analyzeWithAnthropic(metricsJSON, periodeStr),
  ]);

  const sourcesUtilisees: string[] = [];
  if (geminiResult) sourcesUtilisees.push("Gemini");
  if (openaiResult) sourcesUtilisees.push("OpenAI");
  if (anthropicResult) sourcesUtilisees.push("Anthropic");

  const analyseIA = fusionnerAnalyses(geminiResult, openaiResult, anthropicResult, sourcesUtilisees);

  for (const empAnalysis of (analyseIA.employes || [])) {
    const empMetrics = allMetrics.find(m => m.userId === empAnalysis.userId);
    if (!empMetrics) continue;

    await db.insert(performanceReportsTable).values({
      userId: empMetrics.userId,
      userEmail: empMetrics.email,
      userName: `${empMetrics.prenom} ${empMetrics.nom}`,
      periode,
      dateDebut,
      dateFin: now,
      scoreGlobal: empAnalysis.score || 0,
      metriques: empMetrics as any,
      analyseIA: empAnalysis.recommandation || "",
      pointsForts: empAnalysis.pointsForts || [],
      pointsAmelioration: empAnalysis.pointsAmelioration || [],
      recommandations: analyseIA.recommandationsEquipe || [],
      comparaison: analyseIA.comparaison || null,
    });
  }

  return {
    periode,
    dateDebut: dateDebut.toISOString(),
    dateFin: now.toISOString(),
    metriques: allMetrics,
    analyseIA,
  };
}

export async function getPerformanceHistory(limit = 20): Promise<any[]> {
  return db
    .select()
    .from(performanceReportsTable)
    .orderBy(desc(performanceReportsTable.createdAt))
    .limit(limit);
}

const GEMINI_PROMPT = (metricsJSON: string, periodeStr: string) => `Tu es le directeur des ressources humaines d'un bureau professionnel en France (Agent de Bureau).
Tu analyses les performances de l'equipe sur la periode du ${periodeStr}.

DONNEES DES EMPLOYES:
${metricsJSON}

ANALYSE DEMANDEE:
1. Pour chaque employe, attribue un score de performance sur 100 base sur:
   - Volume d'activite (actions, appels, taches)
   - Regularite (connexions, pointages)
   - Productivite (taches terminees vs creees)
   - Engagement (heures travaillees, contacts ajoutes)

2. Identifie 3 points forts et 3 points a ameliorer pour chaque employe.

3. Fournis des recommandations concretes pour ameliorer la performance de l'equipe.

4. Compare les employes entre eux si il y en a plusieurs (qui est le plus productif, le plus assidu, etc.)

5. Genere un resume executif de 3-4 phrases sur l'etat general de l'equipe.

6. Ajoute une petite blague legere et bienveillante en rapport avec le travail de bureau pour detendre l'atmosphere.

Reponds UNIQUEMENT en JSON:
{
  "resumeExecutif": "string",
  "employes": [
    {
      "userId": number,
      "nom": "string",
      "score": number,
      "niveau": "excellent|bon|moyen|insuffisant",
      "pointsForts": ["string"],
      "pointsAmelioration": ["string"],
      "recommandation": "string"
    }
  ],
  "recommandationsEquipe": [
    {"priorite": "haute|moyenne|basse", "action": "string", "impact": "string"}
  ],
  "comparaison": {
    "plusProductif": "string",
    "plusAssidu": "string",
    "meilleurScore": "string"
  },
  "tendances": ["string"],
  "blague": "string"
}`;

async function analyzeWithGemini(metricsJSON: string, periodeStr: string): Promise<any | null> {
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: GEMINI_PROMPT(metricsJSON, periodeStr) }] }],
      config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
    });
    return JSON.parse(response.text ?? "{}");
  } catch (error: any) {
    console.error("[Performance] Gemini analysis error:", error.message);
    return null;
  }
}

async function analyzeWithOpenAI(metricsJSON: string, periodeStr: string): Promise<any | null> {
  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content: `Tu es un analyste RH senior specialise dans l'evaluation de la performance des employes en France. Tu fournis une seconde opinion independante, en te concentrant sur les risques, les anomalies et les opportunites de developpement. Reponds en JSON: {"perspectiveOpenAI": "string (resume en 3-4 phrases)", "risquesIdentifies": [{"employe": "string", "risque": "string", "severite": "haute|moyenne|basse"}], "opportunitesDeveloppement": [{"employe": "string", "formation": "string", "beneficeAttendu": "string"}], "alertes": [{"type": "string", "description": "string"}], "scoreMoralEquipe": number, "conseilDirection": "string"}`,
        },
        {
          role: "user",
          content: `Analyse ces donnees de performance des employes pour la periode du ${periodeStr}:\n${metricsJSON}`,
        },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "{}";
    return JSON.parse(text);
  } catch (error: any) {
    console.error("[Performance] OpenAI analysis error:", error.message);
    return null;
  }
}

async function analyzeWithAnthropic(metricsJSON: string, periodeStr: string): Promise<any | null> {
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Tu es un coach d'equipe professionnel et stratege RH en France. Tu fournis une analyse strategique complementaire sur la performance de l'equipe d'un bureau professionnel (Agent de Bureau) pour la periode du ${periodeStr}.

DONNEES DES EMPLOYES:
${metricsJSON}

Fournis une analyse strategique en JSON:
{
  "perspectiveAnthropic": "string (vision strategique en 3-4 phrases)",
  "profilsComportementaux": [{"employe": "string", "profil": "string", "motivation": "string", "conseil": "string"}],
  "dynamiqueEquipe": {"cohesion": "forte|moyenne|faible", "analyse": "string", "recommandations": ["string"]},
  "planAction30Jours": [{"semaine": number, "action": "string", "responsable": "string", "objectif": "string"}],
  "benchmarkSectoriel": "string",
  "citationMotivante": "string"
}`,
        },
      ],
    });
    const block = message.content[0];
    const text = block.type === "text" ? block.text : "{}";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch (error: any) {
    console.error("[Performance] Anthropic analysis error:", error.message);
    return null;
  }
}

function fusionnerAnalyses(
  gemini: any | null,
  openai: any | null,
  anthropic: any | null,
  sources: string[]
): any {
  const base = gemini || {
    resumeExecutif: "Analyse de performance generee.",
    employes: [],
    recommandationsEquipe: [],
    comparaison: null,
    tendances: [],
    blague: null,
  };

  base.sourcesIA = sources;
  base.analyseMultiIA = sources.length > 1;

  if (openai) {
    base.perspectiveOpenAI = openai.perspectiveOpenAI || null;
    base.risquesIdentifies = openai.risquesIdentifies || [];
    base.opportunitesDeveloppement = openai.opportunitesDeveloppement || [];
    base.alertes = openai.alertes || [];
    base.scoreMoralEquipe = openai.scoreMoralEquipe ?? null;
    base.conseilDirection = openai.conseilDirection || null;
  }

  if (anthropic) {
    base.perspectiveAnthropic = anthropic.perspectiveAnthropic || null;
    base.profilsComportementaux = anthropic.profilsComportementaux || [];
    base.dynamiqueEquipe = anthropic.dynamiqueEquipe || null;
    base.planAction30Jours = anthropic.planAction30Jours || [];
    base.benchmarkSectoriel = anthropic.benchmarkSectoriel || null;
    base.citationMotivante = anthropic.citationMotivante || null;
  }

  return base;
}
