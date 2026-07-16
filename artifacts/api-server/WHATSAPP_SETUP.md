# Integration WhatsApp (Twilio)

Cette integration permet a chaque utilisateur d'Ajant Bureau de
discuter avec l'assistant IA via WhatsApp. L'assistant est le meme que
celui de l'app web/mobile : il peut creer des contacts, taches, devis,
envoyer des emails, repondre aux questions, etc.

## Comment ca marche

```
[Utilisateur WhatsApp] --> Twilio --> POST /api/whatsapp/twilio/inbound
                                              |
                                              v
                                      runAssistantTurn (Gemini + outils)
                                              |
                                              v
                                      TwiML <Response><Message>...
                                              |
                                              v
                                      Twilio renvoie la reponse a WhatsApp
```

Identification multi-tenant :
1. **Organisation** : reconnue via `AccountSid` Twilio (table
   `telephony_providers`, meme mecanique que la telephonie vocale).
2. **Utilisateur** : reconnu via le numero `From` (compare au champ
   `users.telephone`, match sur les 9 derniers chiffres pour ignorer
   les formats 06 vs +33 6).
3. **Conversation** : on reprend la derniere conversation assistant
   de l'utilisateur, ou on en cree une nouvelle nommee "WhatsApp".

Securite :
- Signature Twilio verifiee a chaque webhook (HMAC-SHA1 avec
  `authToken` stocke dans le provider).
- Si l'expediteur n'est lie a aucun utilisateur, l'assistant repond
  qu'il faut lier le numero dans le profil.

## Activation cote Twilio

### 1. Sandbox (test, gratuit, 5 minutes)

Pour tester immediatement sans demarche commerciale :
1. Console Twilio -> **Messaging** -> **Try it out** -> **Send a
   WhatsApp message**.
2. Envoyez `join <code-sandbox>` au numero indique (+1 415 523 8886)
   depuis le WhatsApp d'un utilisateur dont le numero est dans son
   profil Ajant Bureau.
3. Console Twilio -> sandbox settings : reglez le webhook
   **"When a message comes in"** sur :
   ```
   https://<votre-domaine>/api/whatsapp/twilio/inbound
   ```
   Methode : **POST**.

### 2. Production

Pour un numero WhatsApp officiel :
1. Faire approuver un **WhatsApp Business Sender** dans Twilio (delai
   Meta : 1 a 3 jours).
2. Une fois approuve, parametrer le webhook sur le numero WhatsApp
   approuve avec la meme URL :
   ```
   https://<votre-domaine>/api/whatsapp/twilio/inbound
   ```
3. Cote Ajant Bureau (table `telephony_providers`), l'organisation
   doit avoir un fournisseur Twilio actif avec le bon `accountSid` et
   `authToken` (deja le cas si l'org utilise deja la telephonie
   vocale Twilio).

## Tester en local

1. Exposer le serveur via le domaine de developpement Replit
   (`$REPLIT_DEV_DOMAIN`).
2. Mettre cette URL dans la sandbox Twilio :
   ```
   https://$REPLIT_DEV_DOMAIN/api/whatsapp/twilio/inbound
   ```
3. Envoyer un message WhatsApp et observer les logs du serveur
   (`refresh_all_logs`).

## Limites connues (v1)

- **Texte uniquement** : les pieces jointes (audio, image, document)
  sont rejetees poliment.
- **Confirmations** : lorsque l'assistant veut executer une action
  necessitant confirmation (envoi d'email/SMS), il annonce l'action
  mais ne peut pas demander d'OUI/NON inline comme dans l'app. Pour
  cette v1 l'utilisateur doit reformuler en mode imperatif clair.
- **Longueur** : reponses limitees a 1500 caracteres (limite WhatsApp).

## Autres canaux du meme type

La meme architecture peut etre dupliquee pour :
- **SMS** (Twilio Messaging classique) : changer le webhook Twilio
  vers `/api/whatsapp/twilio/inbound` fonctionne deja, le `From`
  n'aura juste pas le prefixe `whatsapp:`.
- **Telegram** : creer un bot, parametrer son webhook vers une
  nouvelle route `routes/telegram.ts` qui suit le meme pattern
  (identifier l'utilisateur via son `telegram_user_id` ou un code
  d'invitation, puis appeler `runAssistantTurn`).
- **Messenger / Instagram** : pattern identique avec verification
  signature Meta.

## TODO durcissement multi-instance

L'idempotency in-memory (MessageSid cache 10 min) protege contre les
rejeus Twilio sur une instance unique. Si l'API server est deploye en
mode multi-replicas (load balancer devant plusieurs Node.js), passer
ce cache en table Postgres avec `UNIQUE(message_sid)` pour garantir
qu'un meme MessageSid n'est traite qu'une seule fois cross-instance.

De meme, pour eviter tout risque de mauvais routage entre tenants si
deux organisations partagent par erreur le meme AccountSid Twilio,
ajouter une contrainte d'unicite sur `telephony_providers.config->>'accountSid'`
ou matcher en plus le numero `To` recu contre `phoneNumbers` du provider.

## Notifications sortantes (push WhatsApp)

En plus de la conversation entrante, l'app envoie automatiquement des
notifications WhatsApp lors d'evenements importants. **Opt-in** : chaque
utilisateur active les categories qu'il veut recevoir dans son profil.

### Categories supportees

| Cle | Evenement |
|---|---|
| `task` | Nouvelle tache assignee a l'utilisateur |
| `call` | Nouvel appel entrant (a brancher dans une prochaine iteration) |
| `appointment` | Nouveau rendez-vous (a brancher) |
| `message` | Nouveau message interne (a brancher) |

### Activation pour un utilisateur

Les preferences sont stockees dans `users.preferences` (jsonb) :
```json
{
  "whatsappNotifications": {
    "task": true,
    "call": false,
    "appointment": true,
    "message": false
  }
}
```

L'utilisateur doit aussi avoir un `telephone` rempli dans son profil
(meme champ que celui utilise pour identifier les messages entrants).

### Numero expediteur

Le helper `sendWhatsAppNotification` choisit le `From` dans cet ordre :
1. `telephony_providers.config.whatsappFromNumber` (override par tenant
   — utile si une org a son propre numero WhatsApp Business approuve).
2. Variable d'env `TWILIO_WHATSAPP_FROM` (fallback global — typiquement
   `whatsapp:+14155238886` pour la sandbox Twilio en dev).
3. `telephony_providers.config.fromNumber` (dernier recours, ne marchera
   que si ce numero est aussi enregistre cote WhatsApp).

### Fail-soft

L'envoi est non bloquant : si Twilio renvoie une erreur, si l'utilisateur
n'a pas opte, ou si la config est absente, on logge un warning et on
poursuit. L'evenement metier (creation de tache, etc.) reussit toujours.

### TODO

- Brancher `call`, `appointment`, `message` (memes patterns que pour
  `task` dans `routes/tasks.ts`).
- Ajouter une UI utilisateur pour cocher les categories (actuellement
  les preferences se modifient via `PUT /api/user-preferences`).
- Permettre a l'org admin de configurer `whatsappFromNumber` depuis
  l'ecran "Telephonie" (champ optionnel a cote de `fromNumber`).
