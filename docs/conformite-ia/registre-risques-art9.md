# Registre des risques — évaluation d'activité des salariés (AI Act, article 9)

*Document interne du fournisseur, ouvert le 22 septembre 2026. Chaque risque porte une mesure
déjà en place (vérifiée dans le code) ou une action datée. Revue : à chaque modification des
fonctions et au moins une fois par trimestre.*

| N° | Risque pour la personne | Cause | Mesure en place | Risque résiduel | Action |
|---|---|---|---|---|---|
| R-1 | Décision RH prise sur le seul rapport | responsable pressé, rapport perçu comme objectif | aucune décision automatique ; notice (sections 3 et 7) ; avis de conformité sur les écrans de suivi | faible | R-1a fait (22/09/2026) : chaque rapport affiche « hypothèse à vérifier, pas un constat » (cadreEvaluation, web et mobile) |
| R-2 | Salarié de terrain jugé « peu actif » | seule l'activité dans le logiciel est comptée | limite écrite dans la notice et dans le kit | élevé | R-2a : permettre au déployeur d'exclure des rôles (terrain) du calcul — avant 30/06/2027 |
| R-3 | Score sans lien démontré avec la performance réelle | formule jamais validée | limite écrite ; score présenté comme volume d'activité | élevé | R-3a : protocole d'évaluation avec équipes volontaires, résultats publiés dans la notice — avant 30/09/2027 |
| R-4 | Salarié absent (congé, arrêt) signalé comme inactif | absences non prises en compte | limite écrite | élevé | R-4a : exclure les jours d'absence déclarés du calcul — avant 30/06/2027 |
| R-5 | Commentaire d'IA faux ou inventé | modèle de langage | pseudonymisation ; commentaire séparé du score ; notice section 5 | faible | R-5a fait (22/09/2026) : le rapport se présente comme rédigé par une IA (article 50) |
| R-6 | Identité transmise au fournisseur d'IA | prompt nominatif | pseudonymisation vérifiée par test sur les vraies routes (`evaluation-sans-identite-chez-l-ia.test.ts`) | faible | — |
| R-7 | Consultation par une personne non habilitée | droits d'accès | rôle administrateur exigé ; journal d'audit | faible | — |
| R-8 | Ré-identification dans une petite équipe | effectif faible | limite écrite dans la notice | faible | R-8a fait (22/09/2026) : avertissement sous 5 personnes (SEUIL_PETITE_EQUIPE) |
| R-9 | Surveillance excessive, pression sur les équipes | usage hors destination | usages interdits listés ; obligations CSE / AIPD dans le kit | moyen | suivi des signalements (surveillance après commercialisation) |

## Suivi

- 22/09/2026 : registre ouvert ; R-6 et R-7 traités (code et tests).
- 22/09/2026 : R-1a, R-5a et R-8a réalisés — cadreEvaluation renvoyé par les quatre surfaces, affiché sur le web et le mobile (cadre-evaluation.test.ts). Restent R-2a, R-3a, R-4a (risques élevés, actions datées).
