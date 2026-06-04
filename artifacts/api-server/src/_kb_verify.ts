import { db } from "@workspace/db";
import { organisationsTable, documentsTable, documentChunksTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { indexOrganisation, answerFromKnowledge, searchKnowledge, getKnowledgeStatus } from "./services/knowledge-base";

async function main() {
  const [org] = await db.select({ id: organisationsTable.id, name: organisationsTable.name }).from(organisationsTable).limit(1);
  if (!org) { console.error("Aucune organisation."); process.exit(1); }
  console.log("org:", org);

  const docA = `Politique de congés payés d'Agent de Bureau.
Chaque salarié à temps plein acquiert 2,5 jours de congés payés par mois travaillé, soit 30 jours ouvrables par an.
Les demandes de congés doivent être soumises au moins 3 semaines à l'avance via l'application.
Le solde de congés non pris peut être reporté jusqu'au 31 mai de l'année suivante.
Le remboursement des frais de déplacement professionnel se fait sur présentation des justificatifs, dans la limite de 0,60 € par kilomètre.`;

  const docB = `Procédure de remboursement client.
En cas de réclamation, le client dispose de 14 jours pour demander un remboursement après la livraison.
Le remboursement est traité sous 5 jours ouvrés et crédité sur le moyen de paiement d'origine.
Les frais de port ne sont pas remboursables sauf en cas d'erreur de notre part.`;

  const inserted = await db.insert(documentsTable).values([
    { organisationId: org.id, fileName: "kb_test_conges.txt", originalName: "Politique congés.txt", mimeType: "text/plain", fileSize: docA.length, extractedText: docA, status: "ready", aiProcessed: true },
    { organisationId: org.id, fileName: "kb_test_remboursement.txt", originalName: "Procédure remboursement.txt", mimeType: "text/plain", fileSize: docB.length, extractedText: docB, status: "ready", aiProcessed: true },
  ]).returning({ id: documentsTable.id });
  const ids = inserted.map((r) => r.id);
  console.log("inserted test docs:", ids);

  try {
    const idx = await indexOrganisation(org.id, { force: true });
    console.log("index result:", idx);

    const status = await getKnowledgeStatus(org.id);
    console.log("status:", status);

    const hits = await searchKnowledge(org.id, "Combien de jours de congés par an ?", { topK: 3 });
    console.log("search hits:", hits.map((h) => ({ doc: h.fileName, score: Number(h.score.toFixed(3)), c: h.content.slice(0, 60) })));

    const ans1 = await answerFromKnowledge(org.id, "Combien de jours de congés payés ai-je par an et quel est le délai pour poser une demande ?");
    console.log("\n=== ANSWER 1 ===\n", ans1.answer, "\nsources:", ans1.sources.map((s) => `[${s.ref}] ${s.fileName} (${s.score})`));

    const ans2 = await answerFromKnowledge(org.id, "Sous combien de temps un client est-il remboursé ?");
    console.log("\n=== ANSWER 2 ===\n", ans2.answer, "\nsources:", ans2.sources.map((s) => `[${s.ref}] ${s.fileName} (${s.score})`));

    const ans3 = await answerFromKnowledge(org.id, "Quelle est la capitale de l'Australie ?");
    console.log("\n=== ANSWER 3 (hors sujet) ===\n", ans3.answer, "grounded:", ans3.grounded);
  } finally {
    // cleanup: cascade deletes chunks
    await db.delete(documentChunksTable).where(inArray(documentChunksTable.documentId, ids));
    await db.delete(documentsTable).where(inArray(documentsTable.id, ids));
    const leftDocs = await db.select({ id: documentsTable.id }).from(documentsTable).where(eq(documentsTable.organisationId, org.id));
    console.log("\ncleanup done. remaining docs for org:", leftDocs.length);
  }
  process.exit(0);
}
main().catch((e) => { console.error("VERIFY FAILED:", e); process.exit(1); });
