// ---------------------------------------------------------------------------
// i18n cote serveur pour les emails DECLENCHES PAR UNE REQUETE UTILISATEUR.
//
// Objectif: un email envoye a la suite d'une action HTTP de l'utilisateur
// (inscription, creation de compte, invitation, verification email,
// reinitialisation de mot de passe) part dans la langue du demandeur. Les
// emails automatiques (cron: relances de facture, fin d'essai, suspension...)
// restent en francais et n'utilisent PAS ce module.
//
// Regles:
//  - Langue source / defaut = francais ("fr").
//  - Toute cle absente d'une langue retombe sur la valeur francaise, puis
//    sur la cle elle-meme. On ne casse jamais un envoi pour une traduction
//    manquante.
//  - Les traductions sont un simple module TypeScript (objets imbriques),
//    pas des imports JSON.
//  - Les noms de marque (Ajant Bureau), les URLs et la structure HTML des
//    gabarits restent HORS des chaines traduites quand c'est praticable.
// ---------------------------------------------------------------------------

export type EmailLang = "fr" | "tr" | "en" | "es" | "de" | "ar";

export const SUPPORTED_EMAIL_LANGS: readonly EmailLang[] = ["fr", "tr", "en", "es", "de", "ar"];

function isSupportedLang(v: unknown): v is EmailLang {
  return typeof v === "string" && (SUPPORTED_EMAIL_LANGS as readonly string[]).includes(v);
}

/**
 * Determine la langue d'un email a partir de la requete HTTP.
 * Ordre de priorite:
 *   1. req.body.lang
 *   2. req.query.lang
 *   3. En-tete Accept-Language (premier sous-tag de 2 lettres)
 * Retombe sur "fr" si rien de supporte n'est trouve. Defensif: `req` peut
 * etre undefined, l'en-tete peut manquer.
 */
export function resolveEmailLang(req: any): EmailLang {
  try {
    if (!req) return "fr";

    const fromBody = req.body?.lang;
    if (isSupportedLang(fromBody)) return fromBody;

    const fromQuery = req.query?.lang;
    if (isSupportedLang(fromQuery)) return fromQuery;

    // Accept-Language: "fr-FR,fr;q=0.9,en;q=0.8" -> on prend le 1er sous-tag.
    let header: string | undefined;
    if (typeof req.get === "function") {
      header = req.get("accept-language");
    } else if (req.headers) {
      const raw = req.headers["accept-language"] ?? req.headers["Accept-Language"];
      header = Array.isArray(raw) ? raw[0] : raw;
    }
    if (typeof header === "string" && header.length > 0) {
      const primary = header.split(",")[0]?.trim().slice(0, 2).toLowerCase();
      if (isSupportedLang(primary)) return primary;
    }
  } catch {
    // Ne jamais laisser la resolution de langue casser un envoi d'email.
  }
  return "fr";
}

type StringTree = { [key: string]: string | StringTree };

function lookup(tree: StringTree | undefined, dottedKey: string): string | undefined {
  if (!tree) return undefined;
  const parts = dottedKey.split(".");
  let node: string | StringTree | undefined = tree;
  for (const part of parts) {
    if (node && typeof node === "object" && part in node) {
      node = (node as StringTree)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? match : String(v);
  });
}

/**
 * Recherche une cle pointee dans EMAIL_STRINGS[lang]. Repli: langue demandee
 * -> francais -> la cle brute. Supporte l'interpolation `{{var}}`.
 */
export function emailT(lang: EmailLang, key: string, vars?: Record<string, string | number>): string {
  const primary = lookup(EMAIL_STRINGS[lang], key);
  const resolved = primary ?? lookup(EMAIL_STRINGS.fr, key) ?? key;
  return interpolate(resolved, vars);
}

// ---------------------------------------------------------------------------
// Dictionnaire. Structure imbriquee, cles pointees via emailT(...).
//   common.*   -> elements partages (tagline, footer)
//   role.*     -> libelles de roles
//   welcome.*  -> sendWelcomeEmail
//   creds.*    -> sendCredentialsEmail
//   verify.*   -> email de verification (auth.ts)
//   reset.*    -> email de reinitialisation de mot de passe (auth.ts)
// ---------------------------------------------------------------------------

const fr: StringTree = {
  common: {
    tagline: "Solution professionnelle de gestion",
    needHelp: "Besoin d'aide ? Contactez-nous :",
    rightsReserved: "Tous droits reserves",
  },
  role: {
    super_admin: "Super Administrateur",
    administrateur: "Administrateur",
    agent: "Agent",
    lecture_seule: "Lecture seule",
  },
  welcome: {
    subject: "Bienvenue sur Ajant Bureau - {{orgName}}",
    greeting: "Bienvenue, {{name}} !",
    intro: "Votre compte <strong>Ajant Bureau</strong> pour <strong>{{orgName}}</strong> a ete cree avec succes. Voici toutes les informations pour commencer :",
    loginTitle: "Votre identifiant de connexion",
    emailLabel: "Email",
    loginHint: "Connectez-vous avec le mot de passe que vous avez choisi lors de l'inscription.",
    licenseTitle: "Votre licence",
    orgLabel: "Organisation",
    planLabel: "Plan",
    licenseKeyLabel: "Cle de licence",
    trialWarning: "Votre periode d'essai gratuit se termine le <strong>{{date}}</strong>.",
    webBtn: "Acceder a l'application Web",
    mobileTitle: "Application Mobile",
    mobileDownloadIntro: "Telechargez l'application mobile pour gerer votre bureau depuis votre telephone :",
    mobileDownloadBtn: "Telecharger l'application mobile",
    mobileBrowserIntro: "Accedez a l'application mobile depuis votre navigateur sur telephone :",
    mobileBrowserOpen: "Ouvrez <a href=\"{{url}}\" style=\"color:#f59e0b;font-weight:600;\">{{url}}</a> puis utilisez <strong>\"Ajouter a l'ecran d'accueil\"</strong> pour l'installer comme une application native.",
    importantLabel: "Important :",
    important: "Conservez cet email en lieu sur. Il contient votre cle de licence et vos informations d'acces.",
    startTitle: "Pour commencer",
    step1: "Connectez-vous avec vos identifiants ci-dessus",
    step2: "Changez votre mot de passe dans les parametres",
    step3: "Ajoutez vos premiers contacts",
    step4: "Commencez a gerer vos appels et taches",
    step5: "Invitez vos collaborateurs depuis la gestion des utilisateurs",
    textMobileApp: "- Application Mobile: {{url}}",
    textMobileBrowser: "- Mobile: Ouvrez {{url}} sur votre telephone",
    textBody: `Bienvenue {{name}} !

Votre compte Ajant Bureau pour {{orgName}} a ete cree.

IDENTIFIANT DE CONNEXION:
- Email: {{email}}
- Connectez-vous avec le mot de passe choisi lors de l'inscription.

LICENCE:
- Organisation: {{orgName}}
- Plan: {{plan}}
- Cle de licence: {{licenseKey}}

ACCES:
- Application Web: {{appUrl}}
{{mobileLine}}

POUR COMMENCER:
1. Connectez-vous sur {{appUrl}}
2. Ajoutez vos premiers contacts
3. Gerez vos appels et taches
4. Invitez vos collaborateurs

Conservez cet email - il contient votre licence et informations d'acces.

Support: support@agentdebureau.fr
SK GROUP`,
  },
  creds: {
    subject: "Code de connexion temporaire - Ajant Bureau ({{orgName}})",
    headerSubtitle: "Code de connexion temporaire",
    greeting: "Bonjour {{prenom}} {{nom}},",
    intro: "Un code de connexion temporaire a ete genere pour votre compte <strong>Ajant Bureau</strong> dans l'organisation <strong>{{orgName}}</strong>.",
    codeTitle: "Code de connexion temporaire",
    emailLabel: "Email",
    codeLabel: "Code temporaire",
    roleLabel: "Role",
    warningLabel: "Attention :",
    warning: "Ce code est temporaire. Utilisez-le comme mot de passe pour vous connecter, puis <strong>changez votre mot de passe</strong> immediatement dans les parametres de votre compte.",
    loginBtn: "Se connecter maintenant",
    howTitle: "Comment utiliser",
    how1: "Connectez-vous avec votre email et le code temporaire ci-dessus",
    how2: "Allez dans les parametres de votre compte",
    how3: "Changez immediatement votre mot de passe",
    textBody: `Bonjour {{prenom}} {{nom}},

Un code de connexion temporaire a ete genere pour votre compte Ajant Bureau ({{orgName}}).

CODE DE CONNEXION TEMPORAIRE:
- Email: {{email}}
- Code temporaire: {{password}}
- Role: {{role}}

ATTENTION: Ce code est temporaire. Utilisez-le comme mot de passe pour vous connecter, puis changez votre mot de passe immediatement.

ACCES:
- Application: {{appUrl}}

IMPORTANT: Changez votre mot de passe des votre premiere connexion.

Support: support@agentdebureau.fr
SK GROUP`,
  },
  verify: {
    subject: "Verifiez votre email - Ajant Bureau",
    title: "Verifiez votre adresse email",
    greeting: "Bonjour {{prenom}},",
    intro: "Pour activer votre compte Ajant Bureau, cliquez sur le bouton ci-dessous :",
    btn: "Verifier mon email",
    expiry: "Ce lien est valable pendant <strong>24 heures</strong>. Si vous n'avez pas cree de compte, ignorez cet email.",
    text: "Verifiez votre email: {{link}} (valide 24h)",
  },
  reset: {
    subject: "Reinitialisation de votre mot de passe - Ajant Bureau",
    title: "Reinitialisation de votre mot de passe",
    greeting: "Bonjour {{prenom}},",
    intro: "Vous avez demande la reinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :",
    btn: "Reinitialiser mon mot de passe",
    expiry: "Ce lien est valable pendant <strong>1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email.",
    text: "Bonjour {{prenom}}, reinitialiser votre mot de passe: {{link}} (valide 1h)",
  },
};

const tr: StringTree = {
  common: {
    tagline: "Profesyonel yonetim cozumu",
    needHelp: "Yardima mi ihtiyaciniz var? Bize ulasin:",
    rightsReserved: "Tum haklari saklidir",
  },
  role: {
    super_admin: "Super Yonetici",
    administrateur: "Yonetici",
    agent: "Temsilci",
    lecture_seule: "Salt okunur",
  },
  welcome: {
    subject: "Ajant Bureau'ya hos geldiniz - {{orgName}}",
    greeting: "Hos geldiniz, {{name}}!",
    intro: "<strong>{{orgName}}</strong> icin <strong>Ajant Bureau</strong> hesabiniz basariyla olusturuldu. Baslamak icin tum bilgiler asagida:",
    loginTitle: "Giris kimlik bilginiz",
    emailLabel: "E-posta",
    loginHint: "Kayit sirasinda sectiginiz parola ile giris yapin.",
    licenseTitle: "Lisansiniz",
    orgLabel: "Kurulus",
    planLabel: "Plan",
    licenseKeyLabel: "Lisans anahtari",
    trialWarning: "Ucretsiz deneme sureniz <strong>{{date}}</strong> tarihinde sona eriyor.",
    webBtn: "Web uygulamasina eris",
    mobileTitle: "Mobil Uygulama",
    mobileDownloadIntro: "Buronuzu telefonunuzdan yonetmek icin mobil uygulamayi indirin:",
    mobileDownloadBtn: "Mobil uygulamayi indir",
    mobileBrowserIntro: "Mobil uygulamaya telefonunuzdaki tarayicidan erisin:",
    mobileBrowserOpen: "<a href=\"{{url}}\" style=\"color:#f59e0b;font-weight:600;\">{{url}}</a> adresini acin ve yerel bir uygulama gibi yuklemek icin <strong>\"Ana ekrana ekle\"</strong> secenegini kullanin.",
    importantLabel: "Onemli:",
    important: "Bu e-postayi guvenli bir yerde saklayin. Lisans anahtarinizi ve erisim bilgilerinizi icerir.",
    startTitle: "Baslamak icin",
    step1: "Yukaridaki kimlik bilgilerinizle giris yapin",
    step2: "Ayarlardan parolanizi degistirin",
    step3: "Ilk kisilerinizi ekleyin",
    step4: "Aramalarinizi ve gorevlerinizi yonetmeye baslayin",
    step5: "Kullanici yonetiminden calisma arkadaslarinizi davet edin",
    textMobileApp: "- Mobil Uygulama: {{url}}",
    textMobileBrowser: "- Mobil: {{url}} adresini telefonunuzda acin",
    textBody: `Hos geldiniz {{name}}!

{{orgName}} icin Ajant Bureau hesabiniz olusturuldu.

GIRIS KIMLIK BILGISI:
- E-posta: {{email}}
- Kayit sirasinda sectiginiz parola ile giris yapin.

LISANS:
- Kurulus: {{orgName}}
- Plan: {{plan}}
- Lisans anahtari: {{licenseKey}}

ERISIM:
- Web uygulamasi: {{appUrl}}
{{mobileLine}}

BASLAMAK ICIN:
1. {{appUrl}} adresinden giris yapin
2. Ilk kisilerinizi ekleyin
3. Aramalarinizi ve gorevlerinizi yonetin
4. Calisma arkadaslarinizi davet edin

Bu e-postayi saklayin - lisansinizi ve erisim bilgilerinizi icerir.

Destek: support@agentdebureau.fr
SK GROUP`,
  },
  creds: {
    subject: "Gecici giris kodu - Ajant Bureau ({{orgName}})",
    headerSubtitle: "Gecici giris kodu",
    greeting: "Merhaba {{prenom}} {{nom}},",
    intro: "<strong>{{orgName}}</strong> kurulusundaki <strong>Ajant Bureau</strong> hesabiniz icin gecici bir giris kodu olusturuldu.",
    codeTitle: "Gecici giris kodu",
    emailLabel: "E-posta",
    codeLabel: "Gecici kod",
    roleLabel: "Rol",
    warningLabel: "Dikkat:",
    warning: "Bu kod gecicidir. Giris yapmak icin parola olarak kullanin, ardindan hesap ayarlarinizdan <strong>parolanizi hemen degistirin</strong>.",
    loginBtn: "Simdi giris yap",
    howTitle: "Nasil kullanilir",
    how1: "E-postaniz ve yukaridaki gecici kod ile giris yapin",
    how2: "Hesap ayarlariniza gidin",
    how3: "Parolanizi hemen degistirin",
    textBody: `Merhaba {{prenom}} {{nom}},

Ajant Bureau hesabiniz ({{orgName}}) icin gecici bir giris kodu olusturuldu.

GECICI GIRIS KODU:
- E-posta: {{email}}
- Gecici kod: {{password}}
- Rol: {{role}}

DIKKAT: Bu kod gecicidir. Giris yapmak icin parola olarak kullanin, ardindan parolanizi hemen degistirin.

ERISIM:
- Uygulama: {{appUrl}}

ONEMLI: Ilk girisinizde parolanizi degistirin.

Destek: support@agentdebureau.fr
SK GROUP`,
  },
  verify: {
    subject: "E-postanizi dogrulayin - Ajant Bureau",
    title: "E-posta adresinizi dogrulayin",
    greeting: "Merhaba {{prenom}},",
    intro: "Ajant Bureau hesabinizi etkinlestirmek icin asagidaki dugmeye tiklayin:",
    btn: "E-postami dogrula",
    expiry: "Bu baglanti <strong>24 saat</strong> gecerlidir. Bir hesap olusturmadiysaniz bu e-postayi yok sayin.",
    text: "E-postanizi dogrulayin: {{link}} (24 saat gecerli)",
  },
  reset: {
    subject: "Parolanizi sifirlayin - Ajant Bureau",
    title: "Parolanizi sifirlayin",
    greeting: "Merhaba {{prenom}},",
    intro: "Parolanizi sifirlamayi talep ettiniz. Yeni bir parola secmek icin asagidaki dugmeye tiklayin:",
    btn: "Parolami sifirla",
    expiry: "Bu baglanti <strong>1 saat</strong> gecerlidir. Bu talebi siz yapmadiysaniz bu e-postayi yok sayin.",
    text: "Merhaba {{prenom}}, parolanizi sifirlayin: {{link}} (1 saat gecerli)",
  },
};

const en: StringTree = {
  common: {
    tagline: "Professional management solution",
    needHelp: "Need help? Contact us:",
    rightsReserved: "All rights reserved",
  },
  role: {
    super_admin: "Super Administrator",
    administrateur: "Administrator",
    agent: "Agent",
    lecture_seule: "Read only",
  },
  welcome: {
    subject: "Welcome to Ajant Bureau - {{orgName}}",
    greeting: "Welcome, {{name}}!",
    intro: "Your <strong>Ajant Bureau</strong> account for <strong>{{orgName}}</strong> has been created successfully. Here is everything you need to get started:",
    loginTitle: "Your login credentials",
    emailLabel: "Email",
    loginHint: "Log in with the password you chose during sign-up.",
    licenseTitle: "Your license",
    orgLabel: "Organization",
    planLabel: "Plan",
    licenseKeyLabel: "License key",
    trialWarning: "Your free trial ends on <strong>{{date}}</strong>.",
    webBtn: "Open the web app",
    mobileTitle: "Mobile App",
    mobileDownloadIntro: "Download the mobile app to manage your office from your phone:",
    mobileDownloadBtn: "Download the mobile app",
    mobileBrowserIntro: "Access the mobile app from your phone's browser:",
    mobileBrowserOpen: "Open <a href=\"{{url}}\" style=\"color:#f59e0b;font-weight:600;\">{{url}}</a> then use <strong>\"Add to Home Screen\"</strong> to install it like a native app.",
    importantLabel: "Important:",
    important: "Keep this email in a safe place. It contains your license key and access details.",
    startTitle: "Getting started",
    step1: "Log in with your credentials above",
    step2: "Change your password in the settings",
    step3: "Add your first contacts",
    step4: "Start managing your calls and tasks",
    step5: "Invite your colleagues from user management",
    textMobileApp: "- Mobile App: {{url}}",
    textMobileBrowser: "- Mobile: Open {{url}} on your phone",
    textBody: `Welcome {{name}}!

Your Ajant Bureau account for {{orgName}} has been created.

LOGIN CREDENTIALS:
- Email: {{email}}
- Log in with the password you chose during sign-up.

LICENSE:
- Organization: {{orgName}}
- Plan: {{plan}}
- License key: {{licenseKey}}

ACCESS:
- Web app: {{appUrl}}
{{mobileLine}}

GETTING STARTED:
1. Log in at {{appUrl}}
2. Add your first contacts
3. Manage your calls and tasks
4. Invite your colleagues

Keep this email - it contains your license and access details.

Support: support@agentdebureau.fr
SK GROUP`,
  },
  creds: {
    subject: "Temporary login code - Ajant Bureau ({{orgName}})",
    headerSubtitle: "Temporary login code",
    greeting: "Hello {{prenom}} {{nom}},",
    intro: "A temporary login code has been generated for your <strong>Ajant Bureau</strong> account in the organization <strong>{{orgName}}</strong>.",
    codeTitle: "Temporary login code",
    emailLabel: "Email",
    codeLabel: "Temporary code",
    roleLabel: "Role",
    warningLabel: "Warning:",
    warning: "This code is temporary. Use it as your password to log in, then <strong>change your password</strong> immediately in your account settings.",
    loginBtn: "Log in now",
    howTitle: "How to use it",
    how1: "Log in with your email and the temporary code above",
    how2: "Go to your account settings",
    how3: "Change your password immediately",
    textBody: `Hello {{prenom}} {{nom}},

A temporary login code has been generated for your Ajant Bureau account ({{orgName}}).

TEMPORARY LOGIN CODE:
- Email: {{email}}
- Temporary code: {{password}}
- Role: {{role}}

WARNING: This code is temporary. Use it as your password to log in, then change your password immediately.

ACCESS:
- App: {{appUrl}}

IMPORTANT: Change your password on your first login.

Support: support@agentdebureau.fr
SK GROUP`,
  },
  verify: {
    subject: "Verify your email - Ajant Bureau",
    title: "Verify your email address",
    greeting: "Hello {{prenom}},",
    intro: "To activate your Ajant Bureau account, click the button below:",
    btn: "Verify my email",
    expiry: "This link is valid for <strong>24 hours</strong>. If you did not create an account, ignore this email.",
    text: "Verify your email: {{link}} (valid 24h)",
  },
  reset: {
    subject: "Reset your password - Ajant Bureau",
    title: "Reset your password",
    greeting: "Hello {{prenom}},",
    intro: "You requested to reset your password. Click the button below to choose a new password:",
    btn: "Reset my password",
    expiry: "This link is valid for <strong>1 hour</strong>. If you did not make this request, ignore this email.",
    text: "Hello {{prenom}}, reset your password: {{link}} (valid 1h)",
  },
};

const es: StringTree = {
  common: {
    tagline: "Solucion profesional de gestion",
    needHelp: "Necesita ayuda? Contactenos:",
    rightsReserved: "Todos los derechos reservados",
  },
  role: {
    super_admin: "Superadministrador",
    administrateur: "Administrador",
    agent: "Agente",
    lecture_seule: "Solo lectura",
  },
  welcome: {
    subject: "Bienvenido a Ajant Bureau - {{orgName}}",
    greeting: "Bienvenido, {{name}}!",
    intro: "Su cuenta de <strong>Ajant Bureau</strong> para <strong>{{orgName}}</strong> se ha creado correctamente. Aqui tiene toda la informacion para empezar:",
    loginTitle: "Sus datos de acceso",
    emailLabel: "Correo electronico",
    loginHint: "Inicie sesion con la contrasena que eligio durante el registro.",
    licenseTitle: "Su licencia",
    orgLabel: "Organizacion",
    planLabel: "Plan",
    licenseKeyLabel: "Clave de licencia",
    trialWarning: "Su prueba gratuita termina el <strong>{{date}}</strong>.",
    webBtn: "Acceder a la aplicacion web",
    mobileTitle: "Aplicacion movil",
    mobileDownloadIntro: "Descargue la aplicacion movil para gestionar su oficina desde su telefono:",
    mobileDownloadBtn: "Descargar la aplicacion movil",
    mobileBrowserIntro: "Acceda a la aplicacion movil desde el navegador de su telefono:",
    mobileBrowserOpen: "Abra <a href=\"{{url}}\" style=\"color:#f59e0b;font-weight:600;\">{{url}}</a> y luego use <strong>\"Anadir a la pantalla de inicio\"</strong> para instalarla como una aplicacion nativa.",
    importantLabel: "Importante:",
    important: "Conserve este correo en un lugar seguro. Contiene su clave de licencia y sus datos de acceso.",
    startTitle: "Para empezar",
    step1: "Inicie sesion con sus datos de acceso anteriores",
    step2: "Cambie su contrasena en los ajustes",
    step3: "Anada sus primeros contactos",
    step4: "Empiece a gestionar sus llamadas y tareas",
    step5: "Invite a sus colaboradores desde la gestion de usuarios",
    textMobileApp: "- Aplicacion movil: {{url}}",
    textMobileBrowser: "- Movil: Abra {{url}} en su telefono",
    textBody: `Bienvenido {{name}}!

Su cuenta de Ajant Bureau para {{orgName}} se ha creado.

DATOS DE ACCESO:
- Correo electronico: {{email}}
- Inicie sesion con la contrasena que eligio durante el registro.

LICENCIA:
- Organizacion: {{orgName}}
- Plan: {{plan}}
- Clave de licencia: {{licenseKey}}

ACCESO:
- Aplicacion web: {{appUrl}}
{{mobileLine}}

PARA EMPEZAR:
1. Inicie sesion en {{appUrl}}
2. Anada sus primeros contactos
3. Gestione sus llamadas y tareas
4. Invite a sus colaboradores

Conserve este correo: contiene su licencia y sus datos de acceso.

Soporte: support@agentdebureau.fr
SK GROUP`,
  },
  creds: {
    subject: "Codigo de acceso temporal - Ajant Bureau ({{orgName}})",
    headerSubtitle: "Codigo de acceso temporal",
    greeting: "Hola {{prenom}} {{nom}},",
    intro: "Se ha generado un codigo de acceso temporal para su cuenta de <strong>Ajant Bureau</strong> en la organizacion <strong>{{orgName}}</strong>.",
    codeTitle: "Codigo de acceso temporal",
    emailLabel: "Correo electronico",
    codeLabel: "Codigo temporal",
    roleLabel: "Rol",
    warningLabel: "Atencion:",
    warning: "Este codigo es temporal. Uselo como contrasena para iniciar sesion y luego <strong>cambie su contrasena</strong> de inmediato en los ajustes de su cuenta.",
    loginBtn: "Iniciar sesion ahora",
    howTitle: "Como usarlo",
    how1: "Inicie sesion con su correo y el codigo temporal anterior",
    how2: "Vaya a los ajustes de su cuenta",
    how3: "Cambie su contrasena de inmediato",
    textBody: `Hola {{prenom}} {{nom}},

Se ha generado un codigo de acceso temporal para su cuenta de Ajant Bureau ({{orgName}}).

CODIGO DE ACCESO TEMPORAL:
- Correo electronico: {{email}}
- Codigo temporal: {{password}}
- Rol: {{role}}

ATENCION: Este codigo es temporal. Uselo como contrasena para iniciar sesion y luego cambie su contrasena de inmediato.

ACCESO:
- Aplicacion: {{appUrl}}

IMPORTANTE: Cambie su contrasena en su primer inicio de sesion.

Soporte: support@agentdebureau.fr
SK GROUP`,
  },
  verify: {
    subject: "Verifique su correo - Ajant Bureau",
    title: "Verifique su direccion de correo",
    greeting: "Hola {{prenom}},",
    intro: "Para activar su cuenta de Ajant Bureau, haga clic en el boton de abajo:",
    btn: "Verificar mi correo",
    expiry: "Este enlace es valido durante <strong>24 horas</strong>. Si no creo una cuenta, ignore este correo.",
    text: "Verifique su correo: {{link}} (valido 24h)",
  },
  reset: {
    subject: "Restablezca su contrasena - Ajant Bureau",
    title: "Restablezca su contrasena",
    greeting: "Hola {{prenom}},",
    intro: "Ha solicitado restablecer su contrasena. Haga clic en el boton de abajo para elegir una nueva contrasena:",
    btn: "Restablecer mi contrasena",
    expiry: "Este enlace es valido durante <strong>1 hora</strong>. Si no realizo esta solicitud, ignore este correo.",
    text: "Hola {{prenom}}, restablezca su contrasena: {{link}} (valido 1h)",
  },
};

const de: StringTree = {
  common: {
    tagline: "Professionelle Verwaltungsloesung",
    needHelp: "Brauchen Sie Hilfe? Kontaktieren Sie uns:",
    rightsReserved: "Alle Rechte vorbehalten",
  },
  role: {
    super_admin: "Superadministrator",
    administrateur: "Administrator",
    agent: "Agent",
    lecture_seule: "Nur Lesen",
  },
  welcome: {
    subject: "Willkommen bei Ajant Bureau - {{orgName}}",
    greeting: "Willkommen, {{name}}!",
    intro: "Ihr <strong>Ajant Bureau</strong>-Konto fuer <strong>{{orgName}}</strong> wurde erfolgreich erstellt. Hier finden Sie alle Informationen zum Loslegen:",
    loginTitle: "Ihre Anmeldedaten",
    emailLabel: "E-Mail",
    loginHint: "Melden Sie sich mit dem Passwort an, das Sie bei der Registrierung gewaehlt haben.",
    licenseTitle: "Ihre Lizenz",
    orgLabel: "Organisation",
    planLabel: "Tarif",
    licenseKeyLabel: "Lizenzschluessel",
    trialWarning: "Ihre kostenlose Testphase endet am <strong>{{date}}</strong>.",
    webBtn: "Zur Web-Anwendung",
    mobileTitle: "Mobile App",
    mobileDownloadIntro: "Laden Sie die mobile App herunter, um Ihr Buero vom Telefon aus zu verwalten:",
    mobileDownloadBtn: "Mobile App herunterladen",
    mobileBrowserIntro: "Greifen Sie ueber den Browser Ihres Telefons auf die mobile App zu:",
    mobileBrowserOpen: "Oeffnen Sie <a href=\"{{url}}\" style=\"color:#f59e0b;font-weight:600;\">{{url}}</a> und verwenden Sie dann <strong>\"Zum Startbildschirm hinzufuegen\"</strong>, um sie wie eine native App zu installieren.",
    importantLabel: "Wichtig:",
    important: "Bewahren Sie diese E-Mail sicher auf. Sie enthaelt Ihren Lizenzschluessel und Ihre Zugangsdaten.",
    startTitle: "Erste Schritte",
    step1: "Melden Sie sich mit Ihren obigen Zugangsdaten an",
    step2: "Aendern Sie Ihr Passwort in den Einstellungen",
    step3: "Fuegen Sie Ihre ersten Kontakte hinzu",
    step4: "Beginnen Sie mit der Verwaltung Ihrer Anrufe und Aufgaben",
    step5: "Laden Sie Ihre Mitarbeiter ueber die Benutzerverwaltung ein",
    textMobileApp: "- Mobile App: {{url}}",
    textMobileBrowser: "- Mobil: Oeffnen Sie {{url}} auf Ihrem Telefon",
    textBody: `Willkommen {{name}}!

Ihr Ajant Bureau-Konto fuer {{orgName}} wurde erstellt.

ANMELDEDATEN:
- E-Mail: {{email}}
- Melden Sie sich mit dem bei der Registrierung gewaehlten Passwort an.

LIZENZ:
- Organisation: {{orgName}}
- Tarif: {{plan}}
- Lizenzschluessel: {{licenseKey}}

ZUGANG:
- Web-Anwendung: {{appUrl}}
{{mobileLine}}

ERSTE SCHRITTE:
1. Melden Sie sich unter {{appUrl}} an
2. Fuegen Sie Ihre ersten Kontakte hinzu
3. Verwalten Sie Ihre Anrufe und Aufgaben
4. Laden Sie Ihre Mitarbeiter ein

Bewahren Sie diese E-Mail auf - sie enthaelt Ihre Lizenz und Zugangsdaten.

Support: support@agentdebureau.fr
SK GROUP`,
  },
  creds: {
    subject: "Temporaerer Anmeldecode - Ajant Bureau ({{orgName}})",
    headerSubtitle: "Temporaerer Anmeldecode",
    greeting: "Hallo {{prenom}} {{nom}},",
    intro: "Fuer Ihr <strong>Ajant Bureau</strong>-Konto in der Organisation <strong>{{orgName}}</strong> wurde ein temporaerer Anmeldecode erstellt.",
    codeTitle: "Temporaerer Anmeldecode",
    emailLabel: "E-Mail",
    codeLabel: "Temporaerer Code",
    roleLabel: "Rolle",
    warningLabel: "Achtung:",
    warning: "Dieser Code ist temporaer. Verwenden Sie ihn als Passwort zum Anmelden und <strong>aendern Sie Ihr Passwort</strong> anschliessend sofort in den Kontoeinstellungen.",
    loginBtn: "Jetzt anmelden",
    howTitle: "So verwenden Sie ihn",
    how1: "Melden Sie sich mit Ihrer E-Mail und dem obigen temporaeren Code an",
    how2: "Gehen Sie zu Ihren Kontoeinstellungen",
    how3: "Aendern Sie Ihr Passwort sofort",
    textBody: `Hallo {{prenom}} {{nom}},

Fuer Ihr Ajant Bureau-Konto ({{orgName}}) wurde ein temporaerer Anmeldecode erstellt.

TEMPORAERER ANMELDECODE:
- E-Mail: {{email}}
- Temporaerer Code: {{password}}
- Rolle: {{role}}

ACHTUNG: Dieser Code ist temporaer. Verwenden Sie ihn als Passwort zum Anmelden und aendern Sie Ihr Passwort anschliessend sofort.

ZUGANG:
- Anwendung: {{appUrl}}

WICHTIG: Aendern Sie Ihr Passwort bei der ersten Anmeldung.

Support: support@agentdebureau.fr
SK GROUP`,
  },
  verify: {
    subject: "Bestaetigen Sie Ihre E-Mail - Ajant Bureau",
    title: "Bestaetigen Sie Ihre E-Mail-Adresse",
    greeting: "Hallo {{prenom}},",
    intro: "Um Ihr Ajant Bureau-Konto zu aktivieren, klicken Sie auf die Schaltflaeche unten:",
    btn: "Meine E-Mail bestaetigen",
    expiry: "Dieser Link ist <strong>24 Stunden</strong> gueltig. Wenn Sie kein Konto erstellt haben, ignorieren Sie diese E-Mail.",
    text: "Bestaetigen Sie Ihre E-Mail: {{link}} (24h gueltig)",
  },
  reset: {
    subject: "Passwort zuruecksetzen - Ajant Bureau",
    title: "Passwort zuruecksetzen",
    greeting: "Hallo {{prenom}},",
    intro: "Sie haben angefordert, Ihr Passwort zuruecksetzen. Klicken Sie auf die Schaltflaeche unten, um ein neues Passwort zu waehlen:",
    btn: "Mein Passwort zuruecksetzen",
    expiry: "Dieser Link ist <strong>1 Stunde</strong> gueltig. Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.",
    text: "Hallo {{prenom}}, setzen Sie Ihr Passwort zurueck: {{link}} (1h gueltig)",
  },
};

const ar: StringTree = {
  common: {
    tagline: "حل احترافي للإدارة",
    needHelp: "هل تحتاج إلى مساعدة؟ اتصل بنا:",
    rightsReserved: "جميع الحقوق محفوظة",
  },
  role: {
    super_admin: "مدير عام",
    administrateur: "مدير",
    agent: "وكيل",
    lecture_seule: "قراءة فقط",
  },
  welcome: {
    subject: "مرحباً بك في Ajant Bureau - {{orgName}}",
    greeting: "مرحباً، {{name}}!",
    intro: "تم إنشاء حسابك في <strong>Ajant Bureau</strong> الخاص بـ <strong>{{orgName}}</strong> بنجاح. إليك كل المعلومات للبدء:",
    loginTitle: "بيانات تسجيل الدخول الخاصة بك",
    emailLabel: "البريد الإلكتروني",
    loginHint: "سجّل الدخول بكلمة المرور التي اخترتها عند التسجيل.",
    licenseTitle: "ترخيصك",
    orgLabel: "المؤسسة",
    planLabel: "الخطة",
    licenseKeyLabel: "مفتاح الترخيص",
    trialWarning: "تنتهي فترتك التجريبية المجانية في <strong>{{date}}</strong>.",
    webBtn: "الوصول إلى تطبيق الويب",
    mobileTitle: "تطبيق الهاتف",
    mobileDownloadIntro: "حمّل تطبيق الهاتف لإدارة مكتبك من هاتفك:",
    mobileDownloadBtn: "تحميل تطبيق الهاتف",
    mobileBrowserIntro: "ادخل إلى تطبيق الهاتف من متصفح هاتفك:",
    mobileBrowserOpen: "افتح <a href=\"{{url}}\" style=\"color:#f59e0b;font-weight:600;\">{{url}}</a> ثم استخدم <strong>\"إضافة إلى الشاشة الرئيسية\"</strong> لتثبيته كتطبيق أصلي.",
    importantLabel: "مهم:",
    important: "احتفظ بهذا البريد في مكان آمن. فهو يحتوي على مفتاح الترخيص وبيانات الوصول الخاصة بك.",
    startTitle: "للبدء",
    step1: "سجّل الدخول ببيانات الاعتماد أعلاه",
    step2: "غيّر كلمة المرور من الإعدادات",
    step3: "أضف جهات الاتصال الأولى",
    step4: "ابدأ بإدارة مكالماتك ومهامك",
    step5: "ادعُ زملاءك من إدارة المستخدمين",
    textMobileApp: "- تطبيق الهاتف: {{url}}",
    textMobileBrowser: "- الهاتف: افتح {{url}} على هاتفك",
    textBody: `مرحباً {{name}}!

تم إنشاء حسابك في Ajant Bureau الخاص بـ {{orgName}}.

بيانات تسجيل الدخول:
- البريد الإلكتروني: {{email}}
- سجّل الدخول بكلمة المرور التي اخترتها عند التسجيل.

الترخيص:
- المؤسسة: {{orgName}}
- الخطة: {{plan}}
- مفتاح الترخيص: {{licenseKey}}

الوصول:
- تطبيق الويب: {{appUrl}}
{{mobileLine}}

للبدء:
1. سجّل الدخول عبر {{appUrl}}
2. أضف جهات الاتصال الأولى
3. أدر مكالماتك ومهامك
4. ادعُ زملاءك

احتفظ بهذا البريد - فهو يحتوي على ترخيصك وبيانات الوصول.

الدعم: support@agentdebureau.fr
SK GROUP`,
  },
  creds: {
    subject: "رمز دخول مؤقت - Ajant Bureau ({{orgName}})",
    headerSubtitle: "رمز دخول مؤقت",
    greeting: "مرحباً {{prenom}} {{nom}}،",
    intro: "تم إنشاء رمز دخول مؤقت لحسابك في <strong>Ajant Bureau</strong> ضمن مؤسسة <strong>{{orgName}}</strong>.",
    codeTitle: "رمز دخول مؤقت",
    emailLabel: "البريد الإلكتروني",
    codeLabel: "الرمز المؤقت",
    roleLabel: "الدور",
    warningLabel: "تنبيه:",
    warning: "هذا الرمز مؤقت. استخدمه ككلمة مرور لتسجيل الدخول، ثم <strong>غيّر كلمة المرور</strong> فوراً من إعدادات حسابك.",
    loginBtn: "سجّل الدخول الآن",
    howTitle: "كيفية الاستخدام",
    how1: "سجّل الدخول ببريدك الإلكتروني والرمز المؤقت أعلاه",
    how2: "اذهب إلى إعدادات حسابك",
    how3: "غيّر كلمة المرور فوراً",
    textBody: `مرحباً {{prenom}} {{nom}}،

تم إنشاء رمز دخول مؤقت لحسابك في Ajant Bureau ({{orgName}}).

رمز الدخول المؤقت:
- البريد الإلكتروني: {{email}}
- الرمز المؤقت: {{password}}
- الدور: {{role}}

تنبيه: هذا الرمز مؤقت. استخدمه ككلمة مرور لتسجيل الدخول، ثم غيّر كلمة المرور فوراً.

الوصول:
- التطبيق: {{appUrl}}

مهم: غيّر كلمة المرور عند أول تسجيل دخول.

الدعم: support@agentdebureau.fr
SK GROUP`,
  },
  verify: {
    subject: "تحقق من بريدك الإلكتروني - Ajant Bureau",
    title: "تحقق من عنوان بريدك الإلكتروني",
    greeting: "مرحباً {{prenom}}،",
    intro: "لتفعيل حسابك في Ajant Bureau، انقر على الزر أدناه:",
    btn: "التحقق من بريدي",
    expiry: "هذا الرابط صالح لمدة <strong>24 ساعة</strong>. إذا لم تنشئ حساباً، تجاهل هذا البريد.",
    text: "تحقق من بريدك الإلكتروني: {{link}} (صالح 24 ساعة)",
  },
  reset: {
    subject: "إعادة تعيين كلمة المرور - Ajant Bureau",
    title: "إعادة تعيين كلمة المرور",
    greeting: "مرحباً {{prenom}}،",
    intro: "لقد طلبت إعادة تعيين كلمة المرور. انقر على الزر أدناه لاختيار كلمة مرور جديدة:",
    btn: "إعادة تعيين كلمة المرور",
    expiry: "هذا الرابط صالح لمدة <strong>ساعة واحدة</strong>. إذا لم تقم بهذا الطلب، تجاهل هذا البريد.",
    text: "مرحباً {{prenom}}، أعد تعيين كلمة المرور: {{link}} (صالح ساعة واحدة)",
  },
};

export const EMAIL_STRINGS: Record<EmailLang, StringTree> = { fr, tr, en, es, de, ar };
