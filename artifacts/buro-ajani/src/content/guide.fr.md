# Agent de Bureau - Guide d'utilisation

## Table des matieres

1. [Introduction](#1-introduction)
2. [Gestion du compte](#2-gestion-du-compte)
3. [Tableau de bord](#3-tableau-de-bord)
4. [Gestion des appels](#4-gestion-des-appels)
5. [Gestion des contacts (CRM)](#5-gestion-des-contacts-crm)
6. [Gestion des taches](#6-gestion-des-taches)
7. [Messages](#7-messages)
8. [Prospects (Prospects / Pipeline CRM)](#8-prospects-prospects-pipeline-crm)
9. [Facturation](#9-facturation)
10. [Gestion des projets](#10-gestion-des-projets)
11. [Gestion des stocks](#11-gestion-des-stocks)
12. [Calendrier](#12-calendrier)
13. [Analyses et rapports](#13-analyses-et-rapports)
14. [Fonctionnalites d'intelligence artificielle](#14-fonctionnalites-dintelligence-artificielle)
15. [File d'approbation](#15-file-dapprobation)
16. [Assistant vocal ("Hey Bureau")](#16-assistant-vocal-hey-bureau)
17. [Systeme telephonique](#17-systeme-telephonique)
18. [Automatisation](#18-automatisation)
19. [Integration Google Workspace](#19-integration-google-workspace)
20. [Intelligence documentaire](#20-intelligence-documentaire)
21. [Reconnaissance faciale](#21-reconnaissance-faciale)
22. [Suivi du personnel (Pointage)](#22-suivi-du-personnel-pointage)
23. [Panneau d'administration](#23-panneau-dadministration)
24. [Parametres](#24-parametres)
25. [Application mobile](#25-application-mobile)
26. [Foire aux questions](#26-foire-aux-questions)

---

## 1. Introduction

**Agent de Bureau** est une plateforme complete de gestion de bureau alimentee par l'intelligence artificielle, developpee pour les marches francophones. Elle vous permet de gerer depuis un seul endroit vos appels, contacts, taches, factures, projets, stocks et bien plus encore.

### Fonctionnalites de la plateforme
- Application web (tous les navigateurs)
- Application mobile (iOS et Android)
- Support PWA (installation sur le bureau)
- Architecture multi-locataire (plusieurs organisations)
- Integration de l'intelligence artificielle (Gemini, OpenAI, Anthropic)
- Systeme de commandes vocales

### Configuration requise
- Un navigateur web moderne (Chrome, Firefox, Safari, Edge)
- Mobile : iOS 15+ ou Android 12+
- Pour les commandes vocales : navigateur Chrome (meilleure prise en charge)

---

## 2. Gestion du compte

### Se connecter
1. Ouvrez l'application web
2. Saisissez votre adresse e-mail dans le champ **Adresse email**
3. Saisissez votre mot de passe dans le champ **Mot de passe**
4. Cliquez sur le bouton **Se connecter**

### Creer un nouveau compte
1. Sur l'ecran de connexion, cliquez sur le bouton **Creer un compte gratuit**
2. Remplissez les informations requises (nom, prenom, e-mail, mot de passe)
3. Creez votre compte

### Premiere connexion (Onboarding)
Lors de votre premiere connexion, un ecran d'accueil s'affiche. Depuis cet ecran :
- Effectuez vos reglages de base
- Ou cliquez sur le bouton **Passer** pour l'ignorer

### Roles utilisateurs
| Role | Droits |
|-----|-------|
| **Super Admin** | Gestion complete du systeme, gestion des organisations |
| **Administrateur** | Droits complets au sein de l'organisation |
| **Agent** | Droits d'utilisation standard |
| **Lecture seule** | Droit de lecture uniquement |

---

## 3. Tableau de bord

Apres vous etre connecte, vous voyez le tableau de bord principal. Sur cet ecran :

### Cartes recapitulatives
- **Total des appels** : nombre d'appels quotidiens
- **Total des contacts** : nombre de contacts enregistres
- **Taches en attente** : taches non terminees
- **Messages** : messages non lus

### Comparaison hebdomadaire
Affiche l'evolution des performances par rapport a la semaine precedente, en pourcentage.

### Dernieres activites
Liste chronologique des dernieres operations effectuees.

### Previsions
Previsions et recommandations hebdomadaires generees par l'intelligence artificielle.

### Graphiques de performance
- Repartition horaire des performances
- Statistiques des taches
- Rapport hebdomadaire

---

## 4. Gestion des appels

**Acces :** menu de gauche **Appels** ou icone d'appel dans le menu superieur

### Liste des appels
- Liste de tous les appels avec date, duree, statut et informations de contact
- Filtres de statut : Termine, Manque, Entrant, Sortant

### Nouvel enregistrement d'appel
1. Cliquez sur le bouton **Nouvelle appel**
2. Saisissez les informations de contact (nom, telephone)
3. Choisissez le type d'appel (entrant/sortant)
4. Ajoutez vos notes
5. Enregistrez

### Detail d'un appel
Cliquez sur un appel pour acceder a sa page de detail :
- Duree et heure de l'appel
- Informations du contact associe
- Notes de l'appel
- Analyse par l'intelligence artificielle

---

## 5. Gestion des contacts (CRM)

**Acces :** menu de gauche **Contacts**

### Liste des contacts
- Informations de tous les contacts : nom, societe, telephone et e-mail
- Recherche et filtrage
- Boutons d'acces rapide

### Ajouter un nouveau contact
1. Cliquez sur le bouton **Nouveau contact**
2. Remplissez les champs obligatoires :
   - Nom et prenom
   - Numero de telephone
   - E-mail
   - Societe (facultatif)
3. Enregistrez avec **Enregistrer**

### Detail d'un contact
Cliquez sur un contact pour l'afficher :
- Coordonnees
- Historique des appels
- Taches associees
- Notes et etiquettes

---

## 6. Gestion des taches

**Acces :** menu de gauche **Taches**

### Liste des taches
Les taches peuvent etre filtrees par statut :
- **En attente**
- **En cours**
- **Termine**

### Creer une nouvelle tache
1. Cliquez sur le bouton **Nouvelle tache**
2. Saisissez le titre de la tache
3. Choisissez la priorite :
   - **Haute**
   - **Moyenne**
   - **Basse**
4. Ajoutez une description
5. Definissez une date d'echeance
6. Enregistrez

### Mettre a jour le statut d'une tache
- Cliquez sur la tache pour modifier son statut
- Deplacez-la entre les statuts par glisser-deposer

---

## 7. Messages

**Acces :** menu de gauche **Messages**

- Systeme de messagerie interne
- Notes vocales
- Communication au sein de l'equipe

---

## 8. Prospects (Prospects / Pipeline CRM)

**Acces :** menu de gauche **Prospects** ou sur mobile **Prospection CRM**

### Vue Pipeline
Les prospects sont suivis a travers les etapes suivantes :
- **Nouveau**
- **Contact** (contact etabli)
- **Qualification**
- **Proposition** (offre soumise)
- **Negociation**
- **Gagne**
- **Perdu**

### Notation des leads
L'intelligence artificielle attribue automatiquement un score a chaque prospect (0-100) :
- **A** (80-100) : potentiel tres eleve
- **B** (60-79) : potentiel eleve
- **C** (40-59) : potentiel moyen
- **D** (20-39) : potentiel faible
- **F** (0-19) : potentiel tres faible

### Ajouter un nouveau prospect
1. Cliquez sur le bouton **Nouveau prospect**
2. Saisissez les informations du contact/de la societe
3. Definissez la valeur estimee
4. Choisissez l'etape du pipeline
5. Enregistrez

---

## 9. Facturation

**Acces :** menu de gauche **Comptes Clients** ou sur mobile **Factures**

### Statuts des factures
- **Brouillon** : pas encore envoyee
- **Envoyee** : envoyee au client
- **Payee** : paiement recu
- **Annulee** : annulee

### Creer une nouvelle facture
1. Cliquez sur le bouton **Nouvelle facture**
2. Choisissez le client
3. Ajoutez les lignes (produit/service, quantite, prix unitaire)
4. Definissez le taux de TVA
5. Choisissez la date d'echeance
6. Enregistrez ou envoyez

### Fonctionnalites de la facturation
- **Multi-devises** : EUR, USD, GBP, CHF, TRY, CAD, MAD, XOF
- **Interets de retard** : calcul automatique selon la loi francaise (10 % par an + 40 EUR d'indemnite forfaitaire)
- **Relance de paiement automatique** : pour les factures echues, chaque matin
  une relance est **preparee** et deposee dans l'ecran **File d'approbation** (voir
  section 15). Apres avoir lu le texte et l'avoir corrige si necessaire, approuvez-le ;
  ce n'est qu'a ce moment-la qu'il est envoye au client. Une deuxieme relance
  n'est pas emise pour la meme facture dans un delai de 7 jours.
  Vous pouvez desactiver entierement cette fonctionnalite au niveau de l'organisation.
- **Generation de PDF** : PDF de facture professionnel

### Sante du compte client
Un score de sante automatique pour chaque compte client :
- Analyse de l'historique des paiements
- Classification des risques
- Suivi de la limite de credit

---

## 10. Gestion des projets

**Acces :** menu de gauche **Projets** ou sur mobile **Projets**

### Statuts des projets
- **Planifie**
- **En cours**
- **En pause**
- **Termine**
- **Annule**

### Creer un nouveau projet
1. Cliquez sur le bouton **Nouveau projet**
2. Saisissez le nom et la description du projet
3. Choisissez les dates de debut et de fin
4. Definissez le budget
5. Choisissez la priorite
6. Enregistrez

### Suivi du projet
- Barre de progression (pourcentage)
- Taux d'utilisation du budget
- Nombre de jours restants
- Taches associees

---

## 11. Gestion des stocks

**Acces :** menu de gauche **Stock** ou sur mobile **Stock**

### Liste des stocks
- Nom du produit, reference, code-barres
- Quantite actuelle et quantite minimale
- Prix unitaire et fournisseur
- Statut : En stock / Stock faible / Rupture de stock

### Ajouter un nouvel article
1. Cliquez sur le bouton **Nouvel article**
2. Remplissez les informations du produit
3. Definissez le seuil de stock minimal (pour l'alerte automatique)
4. Enregistrez

### Alertes de stock
Une alerte automatique est declenchee lorsque la quantite passe en dessous du seuil minimal.

---

## 12. Calendrier

**Acces :** menu de gauche **Calendrier** ou sur mobile **Calendrier**

### Types d'evenements
- **Rendez-vous**
- **Reunion**
- **Rappel**
- **Tache**

### Ajouter un nouvel evenement
1. Cliquez sur un jour dans le calendrier
2. Saisissez le titre, la description, l'heure
3. Choisissez le delai de rappel (15 min, 30 min, 1 heure)
4. Configurez la recurrence (facultatif)
5. Enregistrez

### Synchronisation avec Google Agenda
Vous pouvez etablir une synchronisation bidirectionnelle avec Google Agenda en vous connectant via Parametres > Plateformes > Google.

---

## 13. Analyses et rapports

### Page Analyse
**Acces :** menu de gauche **Analyse**
- Statistiques des appels, taches et contacts
- Graphiques et tableaux
- Analyse des tendances

### Rapports
**Acces :** menu de gauche **Rapports**
- Rapports d'activite generaux
- Comparaisons par periode

### Rapport de direction
**Acces :** menu de gauche **Rapport Executif**
- Synthese d'activite de haut niveau
- KPI et objectifs
- Recommandations strategiques

### Page Performance
**Acces :** menu de gauche **Performance**
- Metriques de performance par collaborateur
- Comparaisons entre equipes
- Analyse de la productivite

### Analyse predictive
Previsions alimentees par l'intelligence artificielle :
- Prevision des appels de la semaine a venir
- Prevision d'achevement des taches
- Projection des revenus
- Alertes de risque

---

## 14. Fonctionnalites d'intelligence artificielle

Agent de Bureau utilise plusieurs moteurs d'intelligence artificielle (Gemini, OpenAI, Anthropic).

### Assistant d'intelligence artificielle (AI SUPREME)
**Acces :** bouton violet en bas a droite sur le web / **Assistant IA** sur mobile

Un assistant ultra-puissant capable d'effectuer 43 actions differentes :
- Creation/mise a jour de taches, contacts, evenements
- Creation de factures et enregistrement de paiements
- Prevision de tresorerie et de revenus
- Analyse client a 360 degres
- Briefing quotidien
- Preparation de reunions
- Analyse des risques
- Audit de performance
- Recommandations de campagnes intelligentes

### Agents d'intelligence artificielle
**Acces :** menu de gauche **Agents IA** ou sur mobile **Agents IA**

10 agents specialises couvrant differents roles de bureau :
- Analyste commercial
- Specialiste de la relation client
- Auditeur de performance
- Gestionnaire des risques
- Et bien plus encore...

### Commandant IA
**Acces :** menu de gauche **Commandant IA**

Moteur central d'orchestration de l'intelligence artificielle dote de 20 capacites :
- Reponse intelligente aux appels
- Creation automatique de taches/rendez-vous
- Reponse intelligente aux e-mails
- Relance des factures en retard
- Briefing quotidien de l'intelligence artificielle
- Analyse de texte (6 modes)

### Moteur de correction automatique
L'intelligence artificielle, de maniere automatique :
- Rattache les appels orphelins aux contacts concernes
- Fait remonter les taches en retard
- Detecte les contacts en doublon
- Effectue une categorisation automatique
- Corrige les stocks negatifs

---

## 15. File d'approbation

**Acces :** menu de gauche **File d'approbation** · sur mobile **Plus > File d'approbation**

Cet ecran est la traduction de la **regle de securite fondamentale** de l'application :

> L'intelligence artificielle prepare une action, vous la montre et ne l'**execute pas** tant que vous ne l'avez pas approuvee.

Si l'intelligence artificielle doit envoyer un e-mail ou un SMS a un client, annuler
un rendez-vous ou emettre une relance de paiement, elle depose d'abord une
**proposition** ici. Rien de ce que vous n'approuvez pas ne sort.

### Ce que vous voyez dans une proposition

- **Titre et resume** — ce qui va etre fait
- **"Pourquoi"** — la raison pour laquelle l'intelligence artificielle le propose (l'evenement declencheur)
- **Le contenu reel** — l'integralite du texte qui sera envoye au client. Le corps de
  l'e-mail, le texte du SMS, les informations du rendez-vous... Pas un resume, mais
  la version exacte qui sera envoyee.

### Vous pouvez corriger avant d'approuver

Les champs de texte sont **modifiables**. Si l'e-mail redige par l'intelligence artificielle
ne vous convient pas, corrigez-le, puis approuvez-le : c'est votre version finale qui sera
envoyee. La fenetre de confirmation affiche aussi les dernieres valeurs, ce qui fait que
vous voyez exactement ce qui sera envoye avant de cliquer sur envoyer.

### Boutons

| Bouton | Ce qu'il fait |
|---|---|
| **Approuver** | Execute l'action immediatement (envoie l'e-mail, annule le rendez-vous...) |
| **Rejeter** | Supprime la proposition, rien n'est fait |
| **Lancer l'analyse** | Demande a l'intelligence artificielle de generer immediatement de nouvelles propositions |

Les propositions accompagnees d'une alerte rouge sont des operations **irreversibles**
(par exemple l'annulation d'un rendez-vous) — relisez-les deux fois avant de les approuver.

### Onglets

- **En attente** : celles en attente de decision. Le chiffre dans le menu de gauche les compte.
- **Historique** : celles que vous avez approuvees, rejetees et leurs resultats.

> Les propositions de plus de 14 jours restees intactes passent automatiquement a
> "expiree" et disparaissent de la liste. Si la situation concernee est toujours
> d'actualite, l'intelligence artificielle propose a nouveau avec des informations a jour.

### Ce qui arrive ici, et ce qui n'y arrive pas

**Demande une approbation** (actions qui sortent, difficiles a annuler) :
- E-mails et SMS aux clients
- Annulation de rendez-vous demandee par telephone
- Relances de paiement/de creance
- Messages envoyes aux clients par les regles d'automatisation

**Ne demande pas d'approbation** (actions internes, sans consequence) :
- Notifications dans l'application
- Creation de taches
- Mises a jour d'enregistrements

Vous pouvez modifier cette distinction pour les regles d'automatisation — voir section 18.

---

## 16. Assistant vocal ("Hey Bureau")

### Dans l'application web
Une fois connecte, vous voyez un bouton microphone rond dans le **coin inferieur gauche** de l'ecran.

#### Utilisation manuelle
1. Cliquez sur le bouton microphone
2. Le panneau s'ouvre ; lorsque vous voyez le message "Je vous ecoute...", commencez a parler
3. Enoncez votre commande
4. L'intelligence artificielle repond et vous redirige vers la page concernee

#### Mode "Hey Bureau"
1. Ouvrez le panneau
2. Cliquez sur le bouton **Mode "Hey Bureau"**
3. Vous etes desormais en mode mains libres : activez l'assistant en disant "Hey Bureau"
4. Enoncez ensuite votre commande

#### Commandes vocales disponibles
| Commande | Action |
|-------|-------|
| "Briefing du jour" | Donne le resume de la journee |
| "Combien d'appels aujourd'hui" | Indique le nombre d'appels du jour |
| "Taches en attente" | Indique le nombre de taches en attente |
| "Factures en retard" | Donne les informations sur les factures en retard |
| "Derniers appels" | Liste les 5 derniers appels |
| "Taches urgentes" | Indique les taches de haute priorite |
| "Cree une tache [titre]" | Cree une nouvelle tache |
| "Appelle [nom]" | Trouve le contact et lance l'appel |
| "Cherche [texte]" | Recherche dans les contacts et les taches |
| "Agenda du jour" | Liste les evenements du jour |
| "Prospects" | Donne un resume du pipeline CRM |
| "Projets" | Donne un resume des projets |
| "Stock" | Indique l'etat des stocks |
| "Performance" | Donne les statistiques hebdomadaires |
| "Aide" | Affiche la liste des commandes |

#### Vue d'aide
Lorsque le panneau est ouvert, cliquez sur l'icone **?** en haut a droite pour voir la liste de toutes les commandes.

### Dans l'application mobile
**Acces :** Plus > Intelligence Artificielle > **Assistant Vocal**

1. Appuyez sur le grand bouton microphone
2. Enoncez votre commande
3. Vous voyez une reponse sous forme de conversation
4. La reponse est lue a voix haute
5. Vous etes automatiquement redirige vers la page concernee

**Remarque :** le mode "Hey Bureau" fonctionne actuellement au mieux dans le navigateur web (Chrome). Dans l'application mobile native, un acces rapide via la liste de commandes est disponible.

---

## 17. Systeme telephonique

**Acces :** menu de gauche **Telephonie** ou sur mobile **Telephonie**

### Fournisseurs pris en charge
Twilio, Vonage, Telnyx, Plivo, Sinch, Bandwidth

### Fonctionnalites
- Configuration du fournisseur
- Lancement d'appels et envoi de SMS
- Historique des appels et des SMS
- Panneau de statistiques

### Ajouter un fournisseur

1. Sur la page **Telephonie**, allez dans l'onglet **Providers** et cliquez sur le bouton **Ajouter un fournisseur**
2. Choisissez un fournisseur dans la liste
3. Saisissez les informations demandees selon le fournisseur :
   - **Twilio :** Account SID, Auth Token, numero Expediteur
   - **Vonage :** API Key, API Secret, numero Expediteur
   - **Telnyx :** API Key, Connection ID, numero Expediteur
   - **Plivo :** Auth ID, Auth Token, numero Expediteur
   - **Sinch :** Project ID, API Token, Service Plan ID, numero Expediteur
   - **Bandwidth :** Account ID, Username, Password, Application ID, numero Expediteur
4. Enregistrez avec **Configurer**, puis verifiez la connexion avec le bouton **Test**

> **A propos du bouton Test :** ce test ne se connecte pas au fournisseur — il verifie
> seulement que les champs que vous avez saisis sont complets. Un Auth Token errone
> apparaitra aussi comme "reussi". La verification reelle apparaitra lors du premier
> essai d'appel ou de SMS.

### Integration webhook

Les fournisseurs notifient automatiquement les mises a jour de statut des appels via webhook. Adresse du webhook : `/api/telephony/webhook/{nom_du_fournisseur}`

### Secretaire vocale et annulation de rendez-vous

La secretaire par intelligence artificielle repond aux appels entrants, prend des rendez-vous et enregistre des messages.

**Si un appelant souhaite annuler un rendez-vous**, la secretaire n'effectue pas
l'annulation elle-meme. Elle depose la demande dans l'ecran **File d'approbation** et
dit a l'appelant "j'ai transmis votre demande, nous la confirmerons sous peu". Le
rendez-vous n'est annule qu'apres votre approbation.

**Pourquoi cela :** l'identite de la personne au telephone se limite au nom qu'elle
enonce et au numero appelant ; les deux peuvent etre usurpes. Or l'annulation d'un
rendez-vous est irreversible et affecte directement le client. C'est pourquoi la
decision est laissee a un humain.

Les demandes d'annulation apparaissent dans la file d'approbation avec une **alerte rouge**. Voir section 15.

---

## 18. Automatisation

**Acces :** menu de gauche **Automatisations** ou sur mobile **Automations**

Creez des regles pour automatiser les operations recurrentes :
- Choisissez un evenement declencheur (ex. : nouvel appel, retard de tache)
- Definissez les conditions
- Definissez l'action (ex. : envoyer une notification, creer une tache)

### Politique d'approbation

Chaque regle possede un badge sur sa carte. En **cliquant dessus**, vous pouvez
modifier la politique — trois options defilent tour a tour :

| Badge | Signification |
|---|---|
| **Envois a valider** (par defaut) | Les e-mails/SMS destines aux clients passent dans la file d'approbation ; les notifications et la creation de taches s'executent automatiquement |
| **Tout a valider** | Tout est en attente d'approbation, y compris les operations internes |
| **Tout automatique** | Rien n'attend d'approbation, la regle s'applique directement |

**Pourquoi cette valeur par defaut :** vous ecrivez une regle une seule fois, mais
cette regle s'execute ensuite **d'elle-meme toutes les 5 minutes**. Chaque message
envoye au client pourrait n'avoir ete lu par personne. Le reglage par defaut fait
passer sous les yeux d'un humain ce qui sort de l'entreprise, sans ralentir les
operations internes.

Les actions de regle en attente d'approbation apparaissent dans l'ecran **File
d'approbation** avec la version finale du texte a envoyer (nom du client, date, etc.
deja remplis) — pas le modele, mais la version exacte qui sera envoyee. Voir section 15.

---

## 19. Integration Google Workspace

**Acces :** menu de gauche **Google Workspace**

Integration a 14 services Google :
- **Gmail** : envoi et reception d'e-mails
- **Google Agenda** : synchronisation des evenements
- **Google Drive** : sauvegarde et gestion de fichiers
- Et bien plus encore...

### Etablir la connexion
1. Rendez-vous sur la page Google Workspace
2. Choisissez le service concerne
3. Autorisez avec votre compte Google
4. Demarrez la synchronisation

---

## 20. Intelligence documentaire

**Acces :** menu de gauche **Document IA**

Systeme intelligent d'analyse de documents :
1. Televersez le document (PDF, image, texte)
2. L'intelligence artificielle analyse le document
3. Elle extrait les donnees (dates, montants, noms)
4. Elle propose une action (creer une facture, ajouter un contact, assigner une tache)
5. Approuvez les propositions ou corrigez-les avant de les appliquer

---

## 21. Reconnaissance faciale

**Acces :** sur mobile **Reconnaissance faciale**

- Numerisation du visage par la camera
- Enregistrement de profil et correspondance de contact
- Detection de l'etat emotionnel
- Evaluation du niveau de securite
- Historique et statistiques de reconnaissance

---

## 22. Suivi du personnel (Pointage)

**Acces :** menu de gauche **Pointage** ou sur mobile **Pointage**

- Enregistrement des entrees/sorties des collaborateurs
- Synchronisation avec Google Agenda
- Suivi des absences
- Rapports de synthese

---

## 23. Panneau d'administration

### Organisations (Super Admin uniquement)
**Acces :** menu de gauche **Organisations**
- Ajout, modification, suppression d'organisations
- Generation de cles de licence
- Gestion des abonnements

#### Creer une nouvelle organisation

Commencez a saisir le nom de l'entreprise dans le champ **Nom de l'organisation**
(au moins 2 lettres). L'application effectue une recherche dans le registre officiel
des entreprises francaises et ouvre une liste. Lorsque vous en selectionnez une dans
la liste, la **raison sociale officielle, l'adresse et le SIRET** se remplissent automatiquement.

Si le registre est inaccessible, la liste reste vide — vous pouvez continuer a saisir
manuellement, rien n'est bloque.

Lorsque vous finalisez le formulaire avec **Creer et envoyer**, l'organisation est creee
et la cle de licence + les identifiants de connexion administrateur sont envoyes par e-mail.

#### Si l'e-mail n'arrive pas

L'organisation est creee mais une **alerte rouge** apparait et indique la **cause reelle**
(par exemple, le nom de domaine de l'expediteur n'est pas verifie, cle API manquante).
La fenetre se ferme — car l'organisation a deja ete creee, et renvoyer le formulaire
creerait un doublon.

La licence n'est pas perdue : avec le bouton **Renvoyer la licence** situe sur la ligne
de l'organisation concernee dans la liste, vous pouvez la renvoyer une fois le probleme corrige.

#### Factures mensuelles (approbation des brouillons)

Les factures de la plateforme sont generees automatiquement chaque mois mais restent en
attente sous forme de **brouillon** ; elles n'entrent dans aucun calcul de creance/retard.
Elles ne sont definitives qu'apres examen et approbation par le super admin. Ceci est
concu pour que les documents financiers ne parviennent pas au client sans qu'un humain les ait vus.

> Remarque : les brouillons de factures n'apparaissent pas dans la file d'approbation
> (section 15) — cette file est propre a l'organisation, et le locataire approuverait sa
> propre facture. L'approbation des brouillons releve du super admin.

### Gestion de licence (Admin uniquement)
**Acces :** menu de gauche **Gestion Licence**
- Statut de l'abonnement
- Alertes de securite
- Gestion des factures et suivi des paiements

### Gestion des utilisateurs
**Acces :** menu de gauche **Utilisateurs**
- Ajout/retrait d'utilisateurs
- Attribution de roles
- Gestion du statut des comptes

### Controle de sante / Sante technique (Super Admin uniquement)
**Acces :** menu de gauche > Super Admin > **Sante technique**

7 agents qui inspectent en continu l'**infrastructure** de l'application. Chaque agent
est responsable de son propre domaine et s'execute automatiquement toutes les 15 minutes.
Avec **Verifier maintenant**, vous pouvez aussi les lancer manuellement a tout moment.

| Agent | Ce qu'il controle |
|---|---|
| **Base de donnees** | Saturation du pool de connexions, latence des requetes, nombre de connexions Postgres |
| **Services externes** | Test de connexion **reel** a Resend / Gemini / Twilio / Stripe / Google |
| **Configuration** | Variable d'environnement manquante, adresse OAuth erronee, NODE_ENV |
| **Taches planifiees** | Suivi de l'activite des taches planifiees (detection des cron morts) |
| **Taux d'erreurs** | Taux de reponses 500 et 429 |
| **Ressources serveur** | Memoire, saturation du processeur, temps de fonctionnement |
| **Integrite des donnees** | Enregistrements orphelins, incoherences structurelles |

Chaque constat est dans l'un des trois etats suivants : **OK** (vert), **Degrade**
(orange, attention requise), **En panne** (rouge, defaillant). Pour les constats
problematiques, **ce qu'il faut faire** est aussi indique.

**Pourquoi cet ecran existe :** les controles des donnees metier (taches en retard,
clients silencieux) ne peuvent pas voir une panne d'infrastructure. Exemples vecus :
la saturation du pool de connexions de la base de donnees avait fait tomber toutes les
pages en erreur 500 ; a cause d'un nom de domaine non verifie, des e-mails n'etaient pas
partis silencieusement ; une limite de requetes mal configuree avait verrouille toute
l'application avec des erreurs 429. Cet ecran attrape ce type de pannes avant meme que
l'utilisateur ne s'en apercoive.

### Journal d'audit
**Acces :** menu de gauche **Audit**
- Enregistrement chronologique de toutes les activites du systeme
- Suivi des evenements de securite
- Filtrage par utilisateur

---

## 24. Parametres

**Acces :** menu de gauche **Parametres**

### Onglets
| Onglet | Description |
|-------|----------|
| **Abonnement** | Gestion du plan et de l'abonnement |
| **Plateformes** | Integrations externes (Google, etc.) |
| **Appels** | Preferences telephoniques |
| **Sauvegardes** | Sauvegardes de donnees |
| **Installation** | Reglages PWA et plateforme |
| **Notifications** | Preferences de notification |
| **Facturation** | Factures et moyens de paiement |
| **Securite** | Protocoles de securite et MFA |
| **Mises a jour** | Journaux des mises a jour du systeme |

### Installation PWA
Vous pouvez installer l'application sur le bureau en tant qu'application haute performance :
1. Rendez-vous dans Parametres > Installation
2. Cliquez sur le bouton **Installer**
3. Le navigateur demandera une autorisation, confirmez-la

---

## 25. Application mobile

### Onglets principaux (menu inferieur)
| Onglet | Action |
|-------|-------|
| **Accueil** | Tableau de bord principal |
| **Appels** | Gestion des appels |
| **Contacts** | Liste des contacts |
| **Taches** | Liste des taches |
| **Plus** | Toutes les autres fonctionnalites |

### Categories du menu "Plus"

#### Commercial
- **Prospection CRM** : pipeline des prospects
- **Factures** : factures et paiements
- **Projets** : suivi des projets

#### Communication
- **Messages** : messagerie interne
- **Telephonie** : VoIP et SMS

#### Outils
- **Analytique** : analyse des donnees
- **Calendrier** : calendrier
- **Stock** : gestion de l'inventaire
- **Pointage** : suivi du personnel

#### Intelligence Artificielle
- **File d'approbation** : les operations preparees par l'intelligence artificielle,
  en attente de votre approbation. Le chiffre a cote indique le nombre en attente.
  Vous pouvez aussi approuver depuis le telephone, corriger le texte ou le rejeter —
  exactement la meme fonction que sur le bureau (voir section 15).
- **Assistant IA** : intelligence artificielle conversationnelle
- **Assistant Vocal** : systeme de commande vocale
- **Agents IA** : agents d'intelligence artificielle specialises
- **Reconnaissance faciale** : reconnaissance faciale
- **Automations** : regles d'automatisation

#### Administration
- **Rapports Admin** : rapports de direction
- **Utilisateurs** : gestion des utilisateurs
- **Journal d'audit** : journal d'audit
- **Integrations** : integrations externes
- **Organisations** : gestion des organisations

#### Compte
- **Parametres** : reglages de l'application
- **Tema** : Clair / Sombre / Systeme

### Changer le theme sur mobile
1. Rendez-vous dans Plus > Parametres
2. Choisissez l'une des options de theme :
   - **Systeme** : suit le reglage de l'appareil
   - **Clair** : theme clair
   - **Sombre** : theme sombre

---

## 26. Foire aux questions

### J'ai oublie mon mot de passe, que dois-je faire ?
Sur l'ecran de connexion, contactez votre administrateur systeme. Le Super Admin peut reinitialiser votre mot de passe.

### L'intelligence artificielle envoie-t-elle des e-mails ou des SMS aux clients d'elle-meme ?
Non. Rien de ce qui sort de l'entreprise n'est envoye sans votre approbation.
L'intelligence artificielle prepare le texte et le depose dans l'ecran **File
d'approbation** ; vous le lisez, le corrigez si necessaire, puis vous l'approuvez
(voir section 15). La meme regle s'applique aux annulations de rendez-vous demandees
par telephone et aux relances de paiement.

Les operations **internes** comme les notifications dans l'application et la creation
de taches n'attendent pas d'approbation — elles ne parviennent pas a l'exterieur. Si
vous le souhaitez, vous pouvez aussi les soumettre a approbation en passant les regles
d'automatisation en "Tout a valider" (section 18).

### Il y a des elements en attente dans la file d'approbation mais je ne les remarque pas ?
Le nombre en attente est indique a cote de **File d'approbation** dans le menu de gauche ;
sur mobile, le meme chiffre apparait dans le menu **Plus**. Les propositions restees
intactes pendant 14 jours disparaissent automatiquement — si la situation est toujours
d'actualite, l'intelligence artificielle propose a nouveau avec des informations a jour.

### L'e-mail de licence n'est pas parti, que dois-je faire ?
Si une alerte rouge est apparue apres la creation de l'organisation, le texte de cette
alerte indique la **cause reelle** (le plus souvent, le nom de domaine de l'expediteur
n'est pas verifie ou une cle API est manquante). Une fois la cause resolue, renvoyez-le
avec le bouton **Renvoyer la licence** situe sur la ligne de l'organisation — la licence n'est pas perdue.

### Si les commandes vocales ne fonctionnent pas ?
- Assurez-vous d'utiliser le navigateur Chrome
- Verifiez l'autorisation du microphone (icone de cadenas dans la barre d'adresse du navigateur)
- Essayez de parler en francais (le systeme effectue la reconnaissance en francais)

### Pourquoi l'assistant vocal ne fonctionne-t-il pas dans l'application mobile ?
La reconnaissance vocale fonctionne actuellement au mieux dans le navigateur web. Dans l'application mobile native, vous pouvez utiliser les memes fonctions en effectuant une selection dans la liste de commandes.

### Mes donnees sont-elles securisees ?
Oui. La plateforme utilise une architecture de securite a 9 couches :
- Authentification et autorisation
- En-tetes de securite Helmet
- Limitation du debit
- Politique CORS stricte
- Chiffrement AES-256-GCM (pour les sauvegardes)
- Journal d'audit

### Comment generer le PDF d'une facture ?
Sur la page de detail de la facture, cliquez sur **Telecharger PDF** ou sur l'icone d'impression.

### Comment se connecter a Google Agenda ?
Etablissez la connexion via Parametres > Plateformes > Google avec l'autorisation OAuth2.

### Comment gerer plusieurs organisations ?
Si vous disposez du role Super Admin, vous pouvez ajouter et gerer plusieurs organisations depuis la page **Organisations**. Chaque organisation dispose d'un locataire isole.

### L'application se charge tres lentement ?
- Apres le premier chargement, elle s'accelere grace au cache
- Vous pouvez obtenir un acces plus rapide en l'installant en tant que PWA
- Vous pouvez diagnostiquer les requetes lentes depuis Chrome DevTools > onglet Network

### Qui contacter pour obtenir de l'aide ?
Contactez votre administrateur systeme ou l'equipe de support d'Agent de Bureau SAS.

---

*Agent de Bureau SAS - Solution professionnelle de gestion*
*Ce guide a ete redige pour Agent de Bureau v1.0.*
