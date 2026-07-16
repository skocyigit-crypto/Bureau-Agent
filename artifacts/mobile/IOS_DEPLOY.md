# Publication iPhone (App Store) — Guide pas-a-pas

> Ce guide est en français-sans-accents pour rester coherent avec le reste
> du projet. Le proprietaire (skocyigit) doit faire les etapes Apple lui-meme
> (compte personnel + carte bancaire), l'agent peut ensuite automatiser la
> build + le submit avec `eas`.

## Etat actuel du projet

- `app.json` : bundle iOS = `fr.agentdebureau.mobile`, permissions
  (localisation, camera) deja configurees en francais.
- `eas.json` : profils `development`, `preview`, `production` crees. La
  section `submit.production.ios` contient 3 placeholders a remplir une
  fois le compte Apple cree.
- `eas-cli` : pas installe globalement. On utilise `npx eas-cli` (Node
  >=18 suffit, pas besoin de Mac).

## Etape 1 — Compte Apple Developer (a faire par le proprietaire)

1. Aller sur https://developer.apple.com/programs/enroll/
2. Se connecter avec un Apple ID (ou en creer un)
3. Choisir "Individual" si vous publiez en votre nom, "Organization" si
   vous publiez au nom d'une societe (necessite un numero D-U-N-S).
4. Payer **99 USD / an** (carte bancaire ou Apple Pay)
5. Attendre la validation Apple (24h a 48h en general)
6. Une fois actif, noter :
   - **Apple ID** (email de connexion)
   - **Apple Team ID** : visible sur https://developer.apple.com/account
     dans "Membership details" (10 caracteres alphanumeriques)

## Etape 2 — Creer l'app dans App Store Connect

1. Aller sur https://appstoreconnect.apple.com
2. Menu "Mes Apps" → "+" → "Nouvelle App"
3. Remplir :
   - Plateforme : **iOS**
   - Nom : **Ajant Bureau** (ou "Buro Ajani" selon votre choix)
   - Langue principale : **Francais** (ou Turc)
   - Bundle ID : selectionner `fr.agentdebureau.mobile` (sera cree
     automatiquement par EAS au premier build, ou le creer maintenant
     dans "Certificates, Identifiers & Profiles")
   - SKU : `agent-de-bureau-ios` (interne, libre)
   - Acces utilisateur : Acces complet
4. Apres creation, noter l'**App Store Connect App ID** (numero a 10
   chiffres visible dans l'URL : `apps/<ASCAPPID>/...`).

## Etape 3 — Remplir `eas.json`

Editer `artifacts/mobile/eas.json` et remplacer les 3 placeholders dans
`submit.production.ios` :

```json
"appleId": "votre.email@exemple.com",
"ascAppId": "1234567890",
"appleTeamId": "ABCDE12345"
```

## Etape 4 — Creer un mot de passe d'application

EAS a besoin de ce mot de passe pour uploader sur App Store Connect sans
ouvrir le navigateur a chaque build.

1. Aller sur https://appleid.apple.com
2. Section "Securite" → "Mots de passe pour app" → "+"
3. Nom : `EAS Submit` → Generer
4. Copier le mot de passe (format `xxxx-xxxx-xxxx-xxxx`)
5. Lors du premier `eas submit`, EAS demandera ce mot de passe (il sera
   stocke chiffre sur les serveurs EAS).

## Etape 5 — Compte Expo (gratuit)

1. Si pas deja fait : https://expo.dev/signup
2. Dans le terminal Replit :
   ```bash
   pnpm --filter @workspace/mobile exec eas login
   ```
3. Lier le projet :
   ```bash
   pnpm --filter @workspace/mobile exec eas init
   ```
   Ceci ajoutera un champ `extra.eas.projectId` dans `app.json`.

## Etape 6 — Premiere build production

```bash
pnpm --filter @workspace/mobile exec eas build --platform ios --profile production
```

EAS va :
- Demander de configurer la signature (choisir "Let EAS handle" pour la
  premiere fois — il genere certificats et profils automatiquement)
- Compiler dans le cloud Apple-MacOS d'Expo (gratuit jusqu'a 30 builds/mois
  sur le plan Free, sinon 99 USD/mois pour le plan Production)
- Produire un `.ipa` (~10-20 min)

## Etape 7 — Premiere soumission (TestFlight)

```bash
pnpm --filter @workspace/mobile exec eas submit --platform ios --profile production --latest
```

- Upload le `.ipa` sur App Store Connect
- L'app passe en validation TestFlight (~30 min)
- Vous pourrez tester en interne avant de soumettre au review App Store

## Etape 8 — Ajouter les meta-donnees dans App Store Connect

Avant de soumettre pour review (apres TestFlight) :

- **Captures d'ecran** obligatoires (6.7", 6.5", 5.5" pour iPhone — 3 a 10)
- **Icone** 1024x1024 PNG (sans transparence)
- **Description** (4000 caracteres max)
- **Mots-cles** (100 caracteres)
- **URL politique de confidentialite** — DOIT etre accessible publiquement
  (ex: https://agentdebureau.fr/confidentialite). Sans cette URL, Apple
  refuse systematiquement.
- **Categorie** : "Productivite" ou "Business"
- **Classement par age** : questionnaire (probablement 4+)
- **Reponses au "App Privacy"** : declarer ce que l'app collecte
  (localisation, contacts, donnees d'usage) — important pour Apple.

## Etape 9 — Soumission review App Store

Dans App Store Connect :
- Onglet "App Store" → "Prepare for submission"
- Cocher "Submit for Review"
- Repondre aux questions sur les comptes test (creer un compte demo
  pour les reviewers Apple)
- Soumettre

Delai Apple : **24 heures a 3 jours** en general. Si refuse, ils
expliquent le motif, on corrige, on re-soumet.

## Erreurs frequentes

| Erreur | Solution |
|---|---|
| "Missing privacy policy URL" | Ajouter une page accessible publiquement |
| "App icon contains alpha channel" | Re-exporter l'icone en PNG sans transparence |
| "Background location not justified" | Bien decrire l'usage dans la fiche App Store (deja fait dans `app.json`) |
| "Invalid bundle ID" | Le bundle ID doit etre cree d'abord dans Apple Developer Portal |

## Recap des couts

- **Apple Developer Program** : 99 USD/an
- **EAS Free plan** : 0 USD (suffit pour publier, limite a 30 builds iOS/mois)
- **EAS Production plan** (optionnel) : 99 USD/mois si vous depassez les
  quotas du free
- **Total annuel minimum** : 99 USD (Apple)
