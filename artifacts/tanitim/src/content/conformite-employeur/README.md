# Kit de conformité employeur — Ajant Bureau

Ce kit s'adresse aux **entreprises clientes** qui utilisent Ajant Bureau pour leurs salariés.
L'entreprise cliente est **responsable du traitement** des données de ses salariés ;
l'éditeur d'Ajant Bureau agit comme **sous-traitant** (voir le DPA).

Trois fonctionnalités traitent des données personnelles de salariés et relèvent du
contrôle de l'activité au sens du Code du travail :

| Fonctionnalité | Ce qui est traité | Conservation appliquée par le logiciel |
|---|---|---|
| Pointage | Arrivée, départ, pauses, lieu déclaré, vérification de présence sur zone, adresse IP | Aucune purge automatique (à définir par l'employeur ; le registre intégré indique 5 ans) |
| Géolocalisation de présence | Entrée / sortie de zones de travail, heure du dernier relevé, batterie — uniquement pendant les horaires définis | 30 jours, purge automatique. Les coordonnées GPS ne sont **pas** conservées |
| Évaluation d'activité (rapports de performance, analyse d'équipe) | Nom, rôle, service, volumes d'activité, heures et pauses, appréciation générée par IA | Durée du contrat (aucune purge automatique) |

Avant la mise en service de ces fonctionnalités, trois démarches incombent à l'employeur :

1. **Consulter le CSE** (Code du travail, art. L2312-38), s'il en existe un — [dossier de consultation](dossier-consultation-cse.md).
2. **Informer chaque salarié** préalablement (art. L1222-4 ; RGPD art. 13) — [note d'information](note-information-salaries.md).
3. **Réaliser une analyse d'impact (AIPD)** lorsque le traitement le requiert (RGPD art. 35 ; liste CNIL) — [trame d'AIPD](trame-aipd.md).

Ces documents sont des **modèles** : les passages entre crochets `[…]` sont à compléter par
l'employeur. Ils ne constituent pas un avis juridique.

## Ce que le logiciel garantit déjà (vérifié dans le code, septembre 2026)

- Un salarié ne voit et ne modifie **que ses propres pointages** ; l'équipe et l'export sont réservés aux administrateurs.
- Aucune coordonnée GPS n'est conservée ; la collecte s'arrête hors des horaires définis.
- Les rapports d'évaluation sont réservés aux administrateurs et tracés dans le journal d'audit (qui, quand, sur qui).
- Les identités des salariés sont **pseudonymisées** avant tout envoi à un fournisseur d'IA.
- La reconnaissance faciale est **désactivée** (donnée biométrique, art. 9 RGPD).
- Aucune décision n'est prise automatiquement : les rapports sont une aide à la décision (art. 22 RGPD).

## Points à arbitrer par l'employeur

- **Conservation des pointages et des rapports** : le logiciel n'applique pas de purge automatique ; fixez une durée et documentez-la.
- **Synchronisation d'agenda Google** : si elle est activée, des pointages peuvent être créés à partir de l'agenda professionnel ; mentionnez-le dans la note d'information.

## Sources officielles

- CNIL — [Listes des traitements pour lesquels une AIPD est requise ou non](https://www.cnil.fr/fr/listes-des-traitements-pour-lesquels-une-aipd-est-requise-ou-non)
- CNIL — [L'analyse d'impact relative à la protection des données (AIPD)](https://www.cnil.fr/fr/RGPD-analyse-impact-protection-des-donnees-aipd)
- CNIL — [La géolocalisation des véhicules des salariés](https://www.cnil.fr/fr/la-geolocalisation-des-vehicules-des-salaries)
- CNIL — [L'écoute et l'enregistrement des appels sur le lieu de travail](https://www.cnil.fr/fr/lecoute-et-lenregistrement-des-appels-sur-le-lieu-de-travail)
- Légifrance — [Code du travail, art. L2312-38](https://www.legifrance.gouv.fr/codes/id/LEGISCTA000035610273)
- Légifrance — [Code du travail, art. L1222-4](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006900861)
