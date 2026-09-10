/**
 * remise-en-etat.ts — transformer des constats en un script que le client relit.
 *
 * C'est la deuxieme moitie de la demande: « et le reparer a sa place ». La
 * premiere moitie (`diagnostic-poste.ts`) explique pourquoi il n'y a pas
 * d'agent qui execute a distance. La meme raison vaut ici, avec une
 * consequence de plus.
 *
 * Un diagnostic qui se trompe fait perdre du temps. Une REPARATION qui se
 * trompe casse un poste de travail dont depend une entreprise. La difference
 * de consequence impose une difference de forme:
 *
 *   - le script est GENERE, affiche, et remis au client. C'est lui qui le
 *     lance, quand il veut, sur la machine qu'il regarde;
 *
 *   - chaque commande est precedee de la raison qui la justifie, en francais.
 *     Un script que personne ne peut relire n'est pas relu, et « faites-moi
 *     confiance » n'est pas une garantie;
 *
 *   - ce qui est REVERSIBLE et sans perte est propose. Ce qui detruit,
 *     desinstalle, ou change une configuration lourde ne l'est jamais — pas
 *     meme avec confirmation. Liberer de l'espace disque en supprimant des
 *     fichiers, par exemple, n'a rien a faire dans un script automatique: la
 *     seule personne qui sait ce qui est jetable est celle qui a mis les
 *     fichiers la.
 *
 * Un constat sans remede automatique n'est pas un echec: il ressort en
 * consigne ecrite, a faire a la main. Mieux vaut un geste humain qu'une
 * commande approximative lancee sur une machine qu'on ne voit pas.
 */
import type { Constat } from "./diagnostic-poste";

export interface EtapeRemise {
  /** Le code du constat auquel cette etape repond. */
  code: string;
  /** Ce que fait l'etape, en francais, avant la commande. */
  explication: string;
  /** La commande PowerShell. Vide si le geste doit rester manuel. */
  commande: string | null;
  /** Vrai si les droits administrateur sont necessaires. */
  administrateur: boolean;
}

export interface Remise {
  etapes: EtapeRemise[];
  /** Constats qui n'ont pas d'automatisation sure: consignes a suivre a la main. */
  aLaMain: Array<{ code: string; consigne: string }>;
  /** Le script complet, pret a etre relu puis lance. Null si rien a automatiser. */
  script: string | null;
  /** Vrai si au moins une etape demande les droits administrateur. */
  administrateurRequis: boolean;
}

/**
 * Ce qu'on accepte d'automatiser, et rien d'autre.
 *
 * La liste est volontairement courte. Chaque entree a ete retenue parce que
 * l'action est REVERSIBLE, ne detruit aucune donnee, et ne change pas le
 * comportement du poste au-dela du defaut constate.
 *
 * Ce qui n'y figure PAS, et pourquoi:
 *
 *   - liberer de l'espace disque: supprimer des fichiers est irreversible, et
 *     seule la personne qui les a mis la sait ce qui est jetable;
 *   - activer BitLocker: le chiffrement produit une cle de recuperation qui
 *     doit etre conservee AILLEURS que sur le poste. Un script qui chiffre
 *     sans que quelqu'un mette la cle en lieu sur fabrique une perte de
 *     donnees a retardement;
 *   - installer les mises a jour: le redemarrage doit etre choisi. Le
 *     declencher a distance en pleine journee sur le poste d'un chef de
 *     chantier, c'est perdre son devis en cours;
 *   - changer de systeme d'exploitation: cela ne se scripte pas.
 */
const AUTOMATISABLE: Record<
  string,
  { explication: string; commande: string; administrateur: boolean }
> = {
  antivirus_inactif: {
    explication:
      "Reactive la protection en temps reel de Microsoft Defender. Reversible: " +
      "la meme commande avec $true la desactiverait de nouveau.",
    commande: "Set-MpPreference -DisableRealtimeMonitoring $false",
    administrateur: true,
  },
  antivirus_signatures_anciennes: {
    explication:
      "Telecharge les dernieres definitions de virus. N'installe rien d'autre " +
      "et ne modifie aucun reglage.",
    commande: "Update-MpSignature",
    administrateur: true,
  },
  parefeu_inactif: {
    explication:
      "Reactive le pare-feu sur les trois profils reseau (domaine, prive, public). " +
      "Aucune regle existante n'est modifiee.",
    commande: "Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True",
    administrateur: true,
  },
};

/**
 * Consignes pour ce qui ne s'automatise pas.
 *
 * Elles ne sont pas un repli: pour ces constats-la, le geste humain EST la
 * bonne reponse, et l'ecrire noir sur blanc vaut mieux qu'une commande qu'on
 * n'oserait pas relire.
 */
const A_LA_MAIN: Record<string, string> = {
  os_hors_support:
    "Verifier si le poste peut passer a Windows 11 (Parametres > Windows Update). " +
    "Si non, prevoir son remplacement: un systeme sans correctif ne peut pas etre securise.",
  maj_tres_anciennes:
    "Ouvrir Windows Update, installer les mises a jour en attente, puis redemarrer en fin " +
    "de journee. Le redemarrage doit etre choisi: le declencher en pleine journee fait " +
    "perdre le travail en cours.",
  maj_anciennes:
    "Ouvrir Windows Update et installer les mises a jour cette semaine.",
  jamais_redemarre:
    "Redemarrer le poste en fin de journee: certains correctifs deja installes ne " +
    "s'appliquent qu'au redemarrage.",
  disque_non_chiffre:
    "Activer BitLocker sur le disque systeme, puis CONSERVER LA CLE DE RECUPERATION " +
    "ailleurs que sur ce poste (coffre, compte Microsoft, papier range). Sans la cle, " +
    "un incident rend les donnees definitivement illisibles — y compris pour vous.",
  aucune_sauvegarde:
    "Configurer une sauvegarde automatique (disque externe ou service en ligne), puis " +
    "verifier qu'une restauration fonctionne. Une sauvegarde jamais restauree n'est pas " +
    "une sauvegarde, c'est une esperance.",
  sauvegarde_ancienne:
    "Chercher pourquoi la sauvegarde ne s'execute plus: disque debranche, espace plein, " +
    "ou tache desactivee.",
  disque_plein:
    "Liberer de l'espace, ou ajouter un disque. Aucun script ne devrait choisir a votre " +
    "place les fichiers a supprimer.",
  disque_presque_plein:
    "Faire du menage avant que la prochaine mise a jour n'echoue faute de place.",
  memoire_juste:
    "Ajouter de la memoire: c'est l'amelioration la moins chere d'un poste, et la plus " +
    "sensible au quotidien.",
};

/** En-tete du script: ce que la personne lit avant de decider de le lancer. */
function entete(nbEtapes: number, admin: boolean): string {
  return [
    "<#",
    "    Remise en etat — genere par Ajant Bureau",
    "",
    `    ${nbEtapes} action(s). Chacune est expliquee juste au-dessus de sa commande.`,
    "",
    "    Ce script ne supprime aucun fichier, ne desinstalle aucun logiciel et",
    "    n'envoie rien nulle part. Chaque action est reversible.",
    "",
    "    Lisez-le avant de le lancer. C'est vous qui l'executez, sur la machine",
    "    que vous avez devant vous: personne d'autre ne peut le declencher.",
    admin
      ? "\n    Certaines actions demandent d'ouvrir PowerShell en tant qu'administrateur."
      : "",
    "#>",
    "",
    "$ErrorActionPreference = \"Stop\"",
    "",
  ].join("\n");
}

/**
 * Construit le plan de remise en etat a partir des constats du diagnostic.
 *
 * Fonction pure: c'est le meme raisonnement que pour l'analyse, et pour la
 * meme raison — ce qui decide de ce qui s'execute sur le poste de quelqu'un
 * doit etre entierement verifiable par des tests.
 */
export function construireRemise(constats: Constat[]): Remise {
  const etapes: EtapeRemise[] = [];
  const aLaMain: Array<{ code: string; consigne: string }> = [];

  for (const c of constats) {
    const auto = AUTOMATISABLE[c.code];
    if (auto) {
      etapes.push({
        code: c.code,
        explication: auto.explication,
        commande: auto.commande,
        administrateur: auto.administrateur,
      });
      continue;
    }
    const consigne = A_LA_MAIN[c.code];
    if (consigne) {
      // Une consigne par CODE, pas par constat. Un poste a deux disques pleins
      // produit deux constats `disque_plein` — et afficherait deux fois la
      // meme phrase. Constate sur un rapport reel, pas sur une fixture: les
      // machines de test n'ont qu'un disque.
      if (!aLaMain.some((a) => a.code === c.code)) {
        aLaMain.push({ code: c.code, consigne });
      }
    } else {
      // Un constat qu'on ne sait ni automatiser ni expliquer ne doit pas
      // disparaitre en silence: on renvoie le remede du diagnostic lui-meme.
      aLaMain.push({ code: c.code, consigne: c.remede });
    }
  }

  const administrateurRequis = etapes.some((e) => e.administrateur);

  let script: string | null = null;
  if (etapes.length > 0) {
    const corps = etapes
      .map((e) => {
        const lignes = e.explication.match(/.{1,72}(\s|$)/g) ?? [e.explication];
        const commentaire = lignes.map((l) => `# ${l.trim()}`).join("\n");
        return `${commentaire}\nWrite-Host "-> ${e.code}" -ForegroundColor Cyan\n${e.commande}\n`;
      })
      .join("\n");
    script =
      entete(etapes.length, administrateurRequis) +
      corps +
      '\nWrite-Host ""\nWrite-Host "Termine. Relancez le diagnostic pour verifier." -ForegroundColor Green\n';
  }

  return { etapes, aLaMain, script, administrateurRequis };
}
