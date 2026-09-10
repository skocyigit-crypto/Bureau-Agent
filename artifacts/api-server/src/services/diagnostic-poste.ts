/**
 * diagnostic-poste.ts — lire un rapport d'etat de poste, et le comprendre.
 *
 * POURQUOI CE FICHIER NE PARLE A AUCUNE MACHINE
 *
 * La demande est « savoir ce qu'il y a et ce qu'il manque sur le poste du
 * client, et le reparer a sa place ». La facon evidente de le faire est un
 * agent installe en permanence, qui recoit des ordres du serveur. C'est ce que
 * font les outils RMM, et c'est precisement ce qu'il ne faut pas construire
 * ici:
 *
 *   - un tel agent ferait de ce produit la cible la plus rentable de tout le
 *     systeme. En 2021, la compromission d'un seul serveur RMM (Kaseya VSA) a
 *     chiffre plus de 1 500 organisations en quelques heures, par le canal de
 *     confiance lui-meme. En 2024, une authentification contournable dans
 *     ConnectWise (CVSS 10.0) a ete exploitee en masse en 48 heures. En 2025,
 *     TOUTES les vulnerabilites publiees sur ces plateformes etaient classees
 *     haute ou critique;
 *
 *   - la CNIL exige un accord PREALABLE et PAR OPERATION avant chaque
 *     telemaintenance, un registre horodate de chaque intervention (date,
 *     nature detaillee, auteur), et la possibilite pour la personne devant la
 *     machine d'identifier la source de l'intervention. Un agent qui agit
 *     seul, en continu, ne satisfait aucun de ces trois points. Elle rappelle
 *     aussi qu'un outil de telemaintenance detourne en surveillance de
 *     l'activite du salarie ne respecte ni le principe de proportionnalite ni
 *     celui de finalite.
 *
 * D'ou cette forme: le client execute lui-meme un script de LECTURE SEULE
 * (`artifacts/buro-ajani/public/outils/diagnostic-poste.ps1`, servi a la racine
 * du site sous /outils/), lit ce qu'il envoie, et l'envoie s'il le veut. Ce module ne fait qu'INTERPRETER ce rapport. Aucun canal entrant,
 * aucune execution a distance, rien qui tourne en permanence.
 *
 * Ce que le produit gagne quand meme: le client sait ce qui ne va pas sur son
 * poste, en francais, avec la raison et le geste a faire.
 *
 * Fonction pure: memes entrees, memes sorties, aucune I/O. C'est elle que les
 * tests verrouillent.
 */

/** Ce que le script de collecte remonte. Tous les champs sont optionnels: une machine peut refuser une mesure. */
export interface RapportPoste {
  /** Horodatage de la collecte, ISO 8601. */
  collecteLe?: string | null;
  os?: {
    /** "Windows 10", "Windows 11", "macOS 15"... */
    nom?: string | null;
    /** Numero de version affiche (22H2, 24H2...). */
    version?: string | null;
    build?: string | null;
  } | null;
  /** Dernier redemarrage, ISO 8601. */
  dernierDemarrage?: string | null;
  /** Date d'installation de la derniere mise a jour systeme, ISO 8601. */
  derniereMaj?: string | null;
  disques?: Array<{ lettre?: string | null; totalGo?: number | null; libreGo?: number | null }> | null;
  memoireGo?: number | null;
  antivirus?: { nom?: string | null; actif?: boolean | null; signaturesAJour?: boolean | null } | null;
  parefeu?: { actif?: boolean | null } | null;
  /** Chiffrement du disque systeme (BitLocker, FileVault). */
  chiffrementDisque?: { actif?: boolean | null } | null;
  /** Sauvegarde configuree sur la machine. */
  sauvegarde?: { configuree?: boolean | null; derniereLe?: string | null } | null;
  /** Logiciels installes, nom et version. Aucun contenu de fichier, aucun historique. */
  logiciels?: Array<{ nom?: string | null; version?: string | null }> | null;
}

export type Gravite = "critique" | "elevee" | "moyenne" | "info";

export interface Constat {
  /** Identifiant stable: l'interface s'y accroche, le libelle peut changer. */
  code: string;
  gravite: Gravite;
  /** Ce qui a ete constate, en clair. */
  constat: string;
  /** Pourquoi cela compte pour cette entreprise-la. */
  pourquoi: string;
  /** Le geste a faire. */
  remede: string;
}

export interface Diagnostic {
  constats: Constat[];
  /** Ce qui a ete regarde mais ne figure pas dans le rapport: l'absence de mesure n'est pas une bonne nouvelle. */
  nonMesure: string[];
  /** Note globale, de 0 (rien ne va) a 100. */
  score: number;
}

/** Fin du support de Windows 10: 14 octobre 2025. Au-dela, plus aucun correctif de securite. */
const FIN_SUPPORT_WINDOWS_10 = new Date("2025-10-14T00:00:00Z");

const JOUR_MS = 24 * 60 * 60 * 1000;

/** Poids retire au score par gravite. */
const POIDS: Record<Gravite, number> = {
  critique: 30,
  elevee: 15,
  moyenne: 7,
  info: 0,
};

function joursDepuis(iso: string | null | undefined, maintenant: Date): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((maintenant.getTime() - d.getTime()) / JOUR_MS);
}

/**
 * Interprete un rapport de poste.
 *
 * `maintenant` est injectable: un diagnostic qui dependrait de l'horloge
 * reelle ne serait pas testable, et « la mise a jour date de 90 jours » doit
 * pouvoir etre verifie sans attendre 90 jours.
 */
export function analyserPoste(rapport: RapportPoste, maintenant: Date = new Date()): Diagnostic {
  const constats: Constat[] = [];
  const nonMesure: string[] = [];

  // --- Systeme d'exploitation ---------------------------------------------
  const nomOs = rapport.os?.nom ?? null;
  if (!nomOs) {
    nonMesure.push("le systeme d'exploitation");
  } else if (/windows\s*10/i.test(nomOs) && maintenant >= FIN_SUPPORT_WINDOWS_10) {
    constats.push({
      code: "os_hors_support",
      gravite: "critique",
      constat: `${nomOs} ne recoit plus de correctifs de securite depuis le 14 octobre 2025.`,
      pourquoi:
        "Une faille decouverte aujourd'hui ne sera jamais corrigee sur ce poste. " +
        "L'article 32 du RGPD impose des mesures de securite adaptees: un systeme " +
        "sans correctif ne l'est plus, et les donnees de vos clients sont dessus.",
      remede: "Passer a Windows 11 si le poste le supporte, sinon remplacer le poste.",
    });
  }

  // --- Mises a jour --------------------------------------------------------
  const jMaj = joursDepuis(rapport.derniereMaj, maintenant);
  if (jMaj === null) {
    nonMesure.push("la date de la derniere mise a jour");
  } else if (jMaj > 90) {
    constats.push({
      code: "maj_tres_anciennes",
      gravite: "critique",
      constat: `Aucune mise a jour systeme depuis ${jMaj} jours.`,
      pourquoi:
        "Les correctifs de securite paraissent tous les mois. Trois mois de retard, " +
        "c'est une dizaine de failles connues, publiees, et donc outillees.",
      remede: "Lancer Windows Update et redemarrer le poste.",
    });
  } else if (jMaj > 45) {
    constats.push({
      code: "maj_anciennes",
      gravite: "moyenne",
      constat: `Derniere mise a jour systeme il y a ${jMaj} jours.`,
      pourquoi: "Le retard s'accumule, et les redemarrages deviennent plus longs et plus risques.",
      remede: "Lancer Windows Update cette semaine.",
    });
  }

  // --- Redemarrage ---------------------------------------------------------
  const jBoot = joursDepuis(rapport.dernierDemarrage, maintenant);
  if (jBoot !== null && jBoot > 30) {
    constats.push({
      code: "jamais_redemarre",
      gravite: "moyenne",
      constat: `Le poste n'a pas redemarre depuis ${jBoot} jours.`,
      pourquoi:
        "Beaucoup de correctifs ne s'appliquent qu'au redemarrage: ils peuvent etre " +
        "telecharges, installes, et pourtant inactifs.",
      remede: "Redemarrer le poste en fin de journee.",
    });
  }

  // --- Antivirus -----------------------------------------------------------
  if (!rapport.antivirus) {
    nonMesure.push("l'antivirus");
  } else if (rapport.antivirus.actif === false) {
    constats.push({
      code: "antivirus_inactif",
      gravite: "critique",
      constat: `L'antivirus${rapport.antivirus.nom ? ` (${rapport.antivirus.nom})` : ""} est desactive.`,
      pourquoi:
        "Un antivirus desactive l'est souvent depuis longtemps, et personne ne s'en apercoit " +
        "tant que rien n'arrive. Les rancongiciels visent en priorite les TPE du batiment.",
      remede: "Reactiver la protection en temps reel.",
    });
  } else if (rapport.antivirus.signaturesAJour === false) {
    constats.push({
      code: "antivirus_signatures_anciennes",
      gravite: "elevee",
      constat: "L'antivirus fonctionne mais ses signatures ne sont pas a jour.",
      pourquoi: "Il ne reconnait que les menaces d'avant sa derniere mise a jour.",
      remede: "Mettre a jour les definitions de l'antivirus.",
    });
  }

  // --- Pare-feu ------------------------------------------------------------
  if (!rapport.parefeu) {
    nonMesure.push("le pare-feu");
  } else if (rapport.parefeu.actif === false) {
    constats.push({
      code: "parefeu_inactif",
      gravite: "elevee",
      constat: "Le pare-feu est desactive.",
      pourquoi:
        "Sur un chantier ou dans un hotel, le poste se connecte a des reseaux partages " +
        "avec des machines inconnues.",
      remede: "Reactiver le pare-feu Windows.",
    });
  }

  // --- Chiffrement du disque ----------------------------------------------
  if (!rapport.chiffrementDisque) {
    nonMesure.push("le chiffrement du disque");
  } else if (rapport.chiffrementDisque.actif === false) {
    constats.push({
      code: "disque_non_chiffre",
      gravite: "elevee",
      constat: "Le disque n'est pas chiffre.",
      pourquoi:
        "Un portable vole ou perdu livre alors tous les fichiers a qui le trouve — devis, " +
        "coordonnees de clients, contrats. C'est une violation de donnees a notifier a la " +
        "CNIL sous 72 heures. Chiffre, le meme vol n'est qu'une perte de materiel.",
      remede: "Activer BitLocker et conserver la cle de recuperation ailleurs que sur le poste.",
    });
  }

  // --- Sauvegarde ----------------------------------------------------------
  if (!rapport.sauvegarde) {
    nonMesure.push("la sauvegarde");
  } else if (rapport.sauvegarde.configuree === false) {
    constats.push({
      code: "aucune_sauvegarde",
      gravite: "critique",
      constat: "Aucune sauvegarde n'est configuree sur ce poste.",
      pourquoi:
        "Un disque qui lache ou un rancongiciel effacent alors dix ans de devis et de " +
        "factures. Les factures doivent pourtant etre conservees six ans (art. L102 B du " +
        "livre des procedures fiscales).",
      remede: "Configurer une sauvegarde automatique, et en verifier une restauration.",
    });
  } else {
    const jSauv = joursDepuis(rapport.sauvegarde.derniereLe, maintenant);
    if (jSauv !== null && jSauv > 7) {
      constats.push({
        code: "sauvegarde_ancienne",
        gravite: "elevee",
        constat: `La derniere sauvegarde date de ${jSauv} jours.`,
        pourquoi:
          "Une sauvegarde configuree mais arretee est pire qu'une absence de sauvegarde: " +
          "on croit etre protege.",
        remede: "Verifier pourquoi la sauvegarde ne s'execute plus.",
      });
    }
  }

  // --- Espace disque -------------------------------------------------------
  const disques = rapport.disques ?? [];
  if (disques.length === 0) {
    nonMesure.push("l'espace disque");
  }
  for (const d of disques) {
    if (d.totalGo == null || d.libreGo == null || d.totalGo <= 0) continue;
    const pct = (d.libreGo / d.totalGo) * 100;
    if (pct < 5) {
      constats.push({
        code: "disque_plein",
        gravite: "elevee",
        constat: `Le disque ${d.lettre ?? "systeme"} n'a plus que ${d.libreGo} Go libres sur ${d.totalGo}.`,
        pourquoi:
          "Sous 5 %, Windows ne peut plus installer ses mises a jour ni ecrire ses fichiers " +
          "temporaires: le poste ralentit, puis refuse d'enregistrer.",
        remede: "Liberer de l'espace ou ajouter un disque.",
      });
    } else if (pct < 12) {
      constats.push({
        code: "disque_presque_plein",
        gravite: "moyenne",
        constat: `Le disque ${d.lettre ?? "systeme"} est rempli a ${Math.round(100 - pct)} %.`,
        pourquoi: "La prochaine mise a jour importante risque d'echouer faute de place.",
        remede: "Faire du menage avant que cela ne bloque.",
      });
    }
  }

  // --- Memoire -------------------------------------------------------------
  if (rapport.memoireGo != null && rapport.memoireGo > 0 && rapport.memoireGo < 8) {
    constats.push({
      code: "memoire_juste",
      gravite: "moyenne",
      constat: `Le poste dispose de ${rapport.memoireGo} Go de memoire.`,
      pourquoi:
        "En dessous de 8 Go, travailler avec un navigateur, un logiciel de devis et un PDF " +
        "ouverts en meme temps devient penible. Le temps perdu se paie tous les jours.",
      remede: "Ajouter de la memoire: c'est l'amelioration la moins chere d'un poste.",
    });
  }

  const score = Math.max(
    0,
    100 - constats.reduce((total, c) => total + POIDS[c.gravite], 0),
  );

  // L'ordre du rendu est celui de l'urgence, pas celui de la collecte.
  const rang: Record<Gravite, number> = { critique: 0, elevee: 1, moyenne: 2, info: 3 };
  constats.sort((a, b) => rang[a.gravite] - rang[b.gravite]);

  return { constats, nonMesure, score };
}
