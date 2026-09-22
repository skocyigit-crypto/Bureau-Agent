# Dossier technique — évaluation d'activité des salariés (AI Act, annexe IV)

*Document interne du fournisseur (SK GROUP). Ouvert le 22 septembre 2026, à tenir à jour à chaque
modification des fonctions concernées. Échéance réglementaire : 2 décembre 2027 (règlement
(UE) 2026/1744). Les faits techniques sont vérifiés par `notice-ia-verite.test.ts` et
`dossier-ia-verite.test.ts` ; la qualification juridique reste à confirmer par un conseil.*

**Décision du fournisseur (22/09/2026)** : conserver les fonctions d'évaluation et constituer dès
maintenant le dossier exigé pour un système à haut risque (annexe III, point 4 b), plutôt que de
les retirer ou de les réduire à des indicateurs d'équipe. Motif : ce sont des fonctions vendues ;
leur retrait serait une perte commerciale, leur conservation sans dossier une infraction à
compter de l'échéance. Le dossier ci-dessous est la voie qui préserve les deux.

## 1. Description générale (annexe IV, point 1)

- **Destination** : aider un responsable d'équipe à repérer surcharge, retards et inactivité
  inhabituelle, et à préparer un échange avec la personne. Usages interdits : sanction,
  licenciement, rémunération, promotion, classement à des fins de sélection, surveillance continue.
- **Fournisseur** : SK GROUP. **Déployeurs** : les entreprises clientes (employeurs).
- **Quatre fonctions** : rapports de performance (`services/performance-analyzer.ts`), agent
  d'équipe (`routes/workforce-agent.ts`), intelligence d'équipe (`routes/workforce-intelligence.ts`),
  qualité d'équipe du Commandant (`routes/ai-commandant.ts`, `/commandant/employee-quality`).
- **Interaction avec d'autres systèmes** : fournisseurs de modèles de langage externes, appelés par
  API — par défaut Gemini (`gemini-3.1-pro-preview`), OpenAI (`gpt-5.2`), Anthropic
  (`claude-sonnet-4-6`), configurables par variables d'environnement ou par clés propres du client.
- **Interface** : écrans d'administration de l'application web et mobile ; réservés aux rôles
  administrateur et super-administrateur.

## 2. Éléments du système et processus de développement (point 2)

1. **Collecte** : volumes d'activité enregistrés dans le logiciel (appels, tâches, notes, actions,
   connexions, pointages), par salarié actif de l'organisation, sur la période choisie.
2. **Score** : formule déterministe `scoreActivite` (`services/performance-garde-fous.ts`) —
   composantes plafonnées (appels 30, taux de réponse 20, tâches 25, notes 10, actions 15), retards
   retranchés (20 au plus), borné à 0..100. Aucun apprentissage, aucun paramètre entraîné.
3. **Pseudonymisation** : le modèle reçoit « Salarie-N », sans nom, service ni responsable
   (`pseudonymiser`, `pseudonyme`) ; les noms sont rétablis côté serveur (`reidentifier`,
   `reidentifierNoms`).
4. **Commentaire** : un ou plusieurs modèles rédigent une analyse à partir des chiffres ; pour les
   rapports de performance, les réponses de plusieurs fournisseurs sont fusionnées
   (`fusionnerAnalyses`).
5. **Restitution** : rapport affiché ; conservé pour les rapports de performance et l'agent
   d'équipe, calculé à l'affichage pour les deux autres.

Choix de conception : pas de modèle entraîné par le fournisseur, pas de données d'entraînement
propres ; les modèles sont des modèles d'IA à usage général de tiers.

## 3. Surveillance, fonctionnement et contrôle (point 3)

- **Supervision humaine** : décrite dans la notice (section 7) ; aucune décision automatique ;
  accès limité aux administrateurs.
- **Limites connues** : activité hors logiciel invisible ; absences non prises en compte ; formule
  non validée ; commentaire d'IA faillible ; petites équipes ré-identifiables. Voir le registre des
  risques.
- **Journalisation** : entrée d'audit `evaluation_salaries` à chaque génération (auteur, date,
  nombre de personnes).

## 4. Pertinence des mesures de performance (point 4)

**Aucune mesure d'exactitude n'existe à ce jour.** La formule n'a pas été confrontée à une
appréciation humaine de référence. Action R-3 du registre : définir un protocole d'évaluation
(échantillon d'équipes volontaires, comparaison au jugement de leurs responsables) avant l'échéance.

## 5. Système de gestion des risques (point 5, article 9)

Voir [registre-risques-art9.md](registre-risques-art9.md).

## 6. Modifications au cours du cycle de vie (point 6)

L'historique Git du dépôt fait foi. Toute modification des fichiers listés en section 1 doit
mettre à jour ce dossier ; le test `dossier-ia-verite.test.ts` échoue si les faits décrits ici
cessent d'être vrais (formule, pseudonymisation, journalisation, modèles par défaut).

## 7. Normes harmonisées (point 7)

Aucune norme harmonisée publiée au 22/09/2026 pour ce cas. À réexaminer avant l'échéance.

## 8. Déclaration UE de conformité (point 8)

À établir avant la mise sur le marché postérieure au 2 décembre 2027 (article 47), après
l'évaluation de conformité par contrôle interne (article 43, annexe VI).

## 9. Surveillance après commercialisation (point 9, article 72)

Canal de signalement : support@agentdebureau.fr (indiqué aux déployeurs dans la notice, section 8).
Plan : revue trimestrielle des signalements et des rapports marqués comme erronés ; incident
grave notifié à l'autorité compétente (article 73).
