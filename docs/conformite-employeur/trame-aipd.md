# Trame d'analyse d'impact (AIPD) — suivi et évaluation des salariés dans Ajant Bureau

*Structure conforme au contenu minimal de l'article 35.7 du RGPD et à la méthode PIA de la CNIL.
Les éléments techniques sont pré-remplis à partir du logiciel ; les appréciations de risque et les
décisions restent celles de l'employeur. Outil gratuit de la CNIL : logiciel PIA.*

## A. Faut-il une AIPD ?

La CNIL inscrit sur sa liste des traitements soumis à AIPD ceux qui ont pour finalité de
**surveiller de manière constante l'activité des employés**, et l'**évaluation systématique
d'aspects personnels** fait partie des critères retenus. Le suivi de présence sur zone et les
rapports d'évaluation assistés par IA s'en approchent : l'AIPD est recommandée, et requise
lorsque deux critères sont réunis (par exemple personnes vulnérables du fait du lien de
subordination, et évaluation ou surveillance systématique).

Décision : [requise / non requise — justification].

## B. Description systématique (art. 35.7.a)

| Élément | Pointage | Présence sur zone | Rapports d'évaluation |
|---|---|---|---|
| Finalité | [à compléter] | [à compléter] | [à compléter] |
| Données | horaires, pauses, lieu déclaré, vérification de zone, IP | entrée/sortie de zone, heure, batterie (pas de GPS conservé) | nom, rôle, service, volumes d'activité, heures, pauses, appréciation IA |
| Personnes concernées | salariés | salariés équipés de l'application | salariés utilisateurs |
| Destinataires | le salarié (ses données), administrateurs | administrateurs | administrateurs |
| Sous-traitants | éditeur, hébergeur UE | éditeur, hébergeur UE | éditeur, hébergeur UE, fournisseurs d'IA (données pseudonymisées) |
| Conservation | [à définir] | 30 jours (automatique) | [à définir] |

## C. Nécessité et proportionnalité (art. 35.7.b)

- Base légale retenue : [par traitement].
- Minimisation : coordonnées GPS non conservées ; collecte bornée aux horaires ; identités pseudonymisées vers l'IA ; pas de profil comportemental.
- Information : note individuelle [date] ; notice dans l'application avant toute collecte.
- Droits : [procédure] ; l'export RGPD du logiciel inclut les données de présence de la personne.
- Consultation du CSE : [date / avis].

## D. Risques pour les personnes (art. 35.7.c)

| Risque | Sources | Gravité | Vraisemblance |
|---|---|---|---|
| Accès illégitime aux horaires ou aux présences d'un salarié | compte administrateur compromis, partage d'export | [ ] | [ ] |
| Surveillance excessive, pression sur les salariés | usage des rapports hors finalité | [ ] | [ ] |
| Appréciation erronée d'une personne | données incomplètes, biais du modèle d'IA | [ ] | [ ] |
| Décision prise sur le seul rapport | absence de revue humaine | [ ] | [ ] |
| Conservation au-delà du nécessaire | absence de purge des pointages et des rapports | [ ] | [ ] |

## E. Mesures (art. 35.7.d)

Mesures déjà présentes dans le logiciel :

- contrôle d'accès par rôle (salarié : ses données ; équipe et exports : administrateurs) ;
- journal d'audit des rapports d'évaluation et des exports ;
- rattachement exact des pointages à la personne (pas de rapprochement par nom approchant) ;
- pseudonymisation avant envoi aux fournisseurs d'IA ; aucune décision automatique ;
- géolocalisation : horaires bornés, zone seulement, 30 jours, pas de GPS conservé ;
- reconnaissance faciale désactivée.

Mesures à décider par l'employeur :

- durée de conservation des pointages et des rapports : [ ] ;
- règle d'usage des rapports (jamais seuls pour une sanction ou une évaluation annuelle) : [ ] ;
- revue périodique des comptes administrateurs : [ ] ;
- [autres].

## F. Validation

- Avis du DPO : [ ] — date : [ ]
- Avis du CSE : [ ] — date : [ ]
- Décision du responsable du traitement : [ ] — date : [ ] — revue prévue le : [ ]
