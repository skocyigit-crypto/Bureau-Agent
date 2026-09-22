# Notice d'utilisation — évaluation d'activité des salariés assistée par IA

*Notice du fournisseur au déployeur (règlement (UE) 2024/1689 sur l'intelligence artificielle,
article 13). Elle décrit ce que font réellement les fonctions d'évaluation d'Ajant Bureau, ce
qu'elles ne savent pas faire, et comment les superviser. Elle ne constitue pas un avis juridique.*

## 1. Fournisseur

**SK GROUP**, éditeur d'Ajant Bureau — coordonnées complètes dans les
[mentions légales](https://agentdebureau.fr/mentions-legales). Contact :
support@agentdebureau.fr.

## 2. Statut au regard du règlement sur l'IA

Les fonctions décrites ici produisent une appréciation individuelle de l'activité de salariés.
Elles relèvent **vraisemblablement** de l'annexe III, point 4 b, du règlement (systèmes destinés
à évaluer les performances et le comportement de personnes dans une relation de travail), donc
des systèmes à haut risque. Les obligations correspondantes du fournisseur et du déployeur
s'appliquent à compter du **2 décembre 2027** (calendrier modifié par le règlement (UE)
2026/1744). L'obligation de transparence de l'article 50 s'applique depuis le 2 août 2026.

L'entreprise cliente est le **déployeur** ; l'éditeur est le **fournisseur**.

## 3. Destination

Aider un responsable à **repérer** des situations qui méritent une attention — surcharge, tâches
en retard, inactivité inhabituelle — et à préparer un échange avec la personne concernée.

**Ne pas utiliser** pour : fonder seul une sanction, un licenciement, une évaluation annuelle, une
rémunération ou une promotion ; classer des salariés entre eux à des fins de sélection ;
surveiller en continu une personne. Le logiciel ne prend aucune décision : il affiche un rapport.

## 4. Les quatre fonctions et leurs données d'entrée

| Fonction | Données utilisées | Conservation du résultat |
|---|---|---|
| Rapports de performance | par salarié : actions dans le logiciel, connexions, tâches créées et terminées, appels saisis, messages, contacts ajoutés, événements, pointages (heures, pauses) | table des rapports, durée à fixer par l'employeur |
| Agent d'équipe (quatre phases) | par salarié, sur 7 jours : appels (répondus, manqués), tâches terminées et en retard, notes, connexions, dernier accès | table des rapports d'agents |
| Intelligence d'équipe | mêmes volumes sur 7 jours | aucune (calculé à l'affichage) |
| Qualité d'équipe (Commandant) | tâches, pointages, actions, appels, messages sur la période choisie | aucune (calculé à l'affichage) |

**Le score est une formule fixe, pas un jugement du modèle.** Il additionne des volumes plafonnés
(appels traités, taux de réponse, tâches terminées, notes, actions) et retranche les tâches en
retard. Le modèle d'IA reçoit ces chiffres et rédige un commentaire ; il ne mesure rien lui-même.

## 5. Limites connues — à lire avant tout usage

- **Seule l'activité enregistrée dans le logiciel est comptée.** Un travail de chantier, un appel
  passé depuis un autre téléphone, une réunion, un travail de qualité mais peu fréquent ne se
  voient pas. Les postes de terrain sont mécaniquement sous-notés par rapport aux postes de bureau.
- **Absences, temps partiel, congés, arrêts** ne sont pas pris en compte : un salarié absent
  légitimement paraît « inactif ».
- **La formule n'a jamais été validée** contre une mesure réelle de la performance. Aucun taux
  d'exactitude ne peut être annoncé.
- **Le commentaire de l'IA peut être faux** : il peut sur-interpréter un chiffre, inventer une cause
  ou proposer une action inadaptée. Plusieurs fournisseurs de modèles peuvent être interrogés ; leurs
  réponses peuvent diverger.
- **Petites équipes** : même pseudonymisé, un chiffre peut désigner une personne identifiable par
  le responsable.

## 6. Ce que le logiciel garantit (vérifié dans le code)

- Accès réservé aux administrateurs ; chaque génération est tracée dans le journal d'audit (qui,
  quand, sur combien de personnes).
- Les fournisseurs d'IA ne reçoivent **aucune identité** : « Salarie-1, Salarie-2… », sans nom,
  sans service, sans le nom du responsable ; les noms sont rétablis sur le serveur.
- Aucune décision automatique (RGPD, art. 22).
- Reconnaissance faciale désactivée.

## 7. Supervision humaine (article 14) — ce que doit faire le responsable

1. Lire le rapport comme une **hypothèse à vérifier**, jamais comme un constat.
2. Avant toute suite, **échanger avec la personne** : elle peut expliquer ce que les chiffres ne
   voient pas (section 5).
3. Ne jamais reprendre tel quel un commentaire de l'IA dans un document RH.
4. En cas de doute sur le système, **ne pas l'utiliser** : aucune fonction du logiciel n'en dépend.

## 8. Obligations de l'entreprise cliente (déployeur, article 26)

- Informer **les représentants du personnel et les salariés concernés** avant la mise en service —
  voir le [dossier de consultation du CSE](dossier-consultation-cse.md) et la
  [note d'information](note-information-salaries.md).
- Confier la supervision à des personnes formées et habilitées (voir section 7).
- Conserver les journaux produits par le système au moins six mois, lorsqu'ils sont sous son
  contrôle.
- Réaliser l'analyse d'impact exigée par le RGPD — voir la [trame d'AIPD](trame-aipd.md).
- Signaler à l'éditeur tout incident ou tout résultat manifestement erroné :
  support@agentdebureau.fr.

## 9. Journalisation (article 12)

Chaque génération écrit une entrée d'audit (`evaluation_salaries`) avec l'auteur, la date et le
nombre de personnes concernées. Les rapports de performance et ceux de l'agent d'équipe sont
conservés avec leur date.
