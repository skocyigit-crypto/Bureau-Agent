# Boîte de support IA — Cloudflare Email Worker

Capte les e-mails envoyés à `support@agentdebureau.fr` (ou toute autre adresse
du domaine) et les envoie à l'API pour un tri automatique par IA (Gemini) :
catégorisation, priorité, et brouillon de réponse déposé dans la file
d'approbation (écran "File d'approbation" du compte super-admin). **Aucun
envoi automatique** — un humain relit et approuve chaque réponse avant
qu'elle ne parte.

Ce chemin évite l'attente d'approbation Google OAuth (Gmail) : Cloudflare
Email Routing + un Worker suffisent, et le domaine `agentdebureau.fr` est
déjà sur Cloudflare.

## Étape 1 — Activer Email Routing (si pas déjà fait)

1. Tableau de bord Cloudflare → domaine `agentdebureau.fr` → **Email** → **Email Routing**.
2. Si ce n'est pas déjà actif, cliquez **Enable Email Routing** (Cloudflare ajoute automatiquement les enregistrements MX nécessaires).

## Étape 2 — Créer le Worker

1. Tableau de bord Cloudflare → **Workers & Pages** → **Create** → **Create Worker**.
2. Donnez-lui un nom, par exemple `support-inbox-triage`.
3. Une fois créé, cliquez **Edit code** (ou "Quick edit").
4. Effacez le code d'exemple et collez le contenu de [`worker.js`](./worker.js) (ce fichier, dans ce même dossier du dépôt).
5. **Deploy**.

## Étape 3 — Configurer les variables du Worker

Dans la page du Worker → **Settings** → **Variables and Secrets** :

| Nom                            | Type    | Valeur |
|---------------------------------|---------|--------|
| `API_URL`                       | Text    | `https://agent-de-bureau-api-qwnwibwdnq-od.a.run.app/api/support-inbox/incoming` |
| `SUPPORT_INBOX_WEBHOOK_SECRET`  | **Secret (encrypt)** | la valeur générée côté serveur — demandez-la si vous ne l'avez pas notée |
| `BACKUP_FORWARD_TO`             | Text (optionnel) | une adresse e-mail réelle où recevoir une copie de secours de chaque message (voir étape 5) |

## Étape 4 — Router l'adresse support@ vers ce Worker

1. **Email** → **Email Routing** → **Email Workers**.
2. **Create address** (ou **Route to a Worker**) → adresse : `support@agentdebureau.fr` (répétez pour `contact@agentdebureau.fr` si vous voulez aussi capter cette adresse).
3. Action : **Send to a Worker** → sélectionnez `support-inbox-triage`.
4. Enregistrez.

## Étape 5 (recommandé) — Adresse de secours

Le Worker envoie **toujours** une copie de chaque e-mail vers `BACKUP_FORWARD_TO`
(en plus de la notification IA), pour ne jamais perdre un message même si
l'API est indisponible. Pour l'activer :

1. **Email Routing** → **Destination addresses** → **Add address** → entrez
   une vraie adresse (ex. votre Gmail personnel).
2. Cliquez le lien de confirmation reçu par e-mail (Cloudflare exige une
   adresse **vérifiée** avant qu'un Worker puisse y transférer du courrier).
3. Renseignez cette adresse dans la variable `BACKUP_FORWARD_TO` du Worker (étape 3).

## Vérification

Envoyez un e-mail de test à `support@agentdebureau.fr`. Dans les 30 secondes :

- Si `BACKUP_FORWARD_TO` est configuré : vous devez le recevoir en copie.
- Une nouvelle proposition doit apparaître dans l'écran "File d'approbation"
  du compte super-admin (`agent-de-bureau-sas`), avec un brouillon de réponse
  généré par l'IA à relire et approuver.

En cas de souci : **Workers & Pages** → votre Worker → **Logs** (onglet
"Real-time Logs" ou "Begin log stream") affiche les erreurs `console.error`
du script en direct pendant que vous renvoyez un e-mail de test.
