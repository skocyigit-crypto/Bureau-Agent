import type { ReactNode } from "react";

/**
 * Rendu Markdown minimal, pour les documents du kit de conformite employeur.
 *
 * Pourquoi pas une bibliotheque : le site n'en a aucune, et ces documents
 * n'emploient qu'un sous-ensemble etroit — titres, paragraphes, listes,
 * tableaux, gras, italique, liens, code. Et pourquoi pas du HTML injecte :
 * tout est construit en elements React, donc rien de ce qui est ecrit dans
 * un fichier ne peut devenir un script.
 *
 * `lien` traduit un lien relatif vers un autre fichier du kit (« trame-aipd.md »)
 * en adresse de page ; les liens externes s'ouvrent dans un nouvel onglet.
 */
export function rendreMarkdown(source: string, lien: (cible: string) => string): ReactNode[] {
  const lignes = source.replace(/\r\n/g, "\n").split("\n");
  const blocs: ReactNode[] = [];
  let i = 0;
  let cle = 0;

  const enLigne = (texte: string): ReactNode[] => {
    const morceaux: ReactNode[] = [];
    const motif = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
    let dernier = 0;
    let m: RegExpExecArray | null;
    while ((m = motif.exec(texte))) {
      if (m.index > dernier) morceaux.push(texte.slice(dernier, m.index));
      const k = `${cle++}`;
      if (m[1] !== undefined) morceaux.push(<strong key={k}>{enLigne(m[1])}</strong>);
      else if (m[2] !== undefined) morceaux.push(<em key={k}>{enLigne(m[2])}</em>);
      else if (m[3] !== undefined) morceaux.push(<code key={k} className="px-1 rounded bg-muted text-sm">{m[3]}</code>);
      else {
        const cible = m[5]!;
        const externe = /^https?:\/\//.test(cible);
        morceaux.push(
          <a
            key={k}
            href={externe ? cible : lien(cible)}
            className="text-primary underline underline-offset-2"
            {...(externe ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {m[4]}
          </a>,
        );
      }
      dernier = motif.lastIndex;
    }
    if (dernier < texte.length) morceaux.push(texte.slice(dernier));
    return morceaux;
  };

  const cellules = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  while (i < lignes.length) {
    const l = lignes[i]!;
    if (!l.trim()) { i++; continue; }

    const titre = /^(#{1,3})\s+(.*)$/.exec(l);
    if (titre) {
      const niveau = titre[1]!.length;
      const contenu = enLigne(titre[2]!);
      const k = `${cle++}`;
      if (niveau === 1) blocs.push(<h1 key={k} className="text-3xl font-bold mb-4">{contenu}</h1>);
      else if (niveau === 2) blocs.push(<h2 key={k} className="text-xl font-semibold mt-10 mb-3">{contenu}</h2>);
      else blocs.push(<h3 key={k} className="text-lg font-semibold mt-6 mb-2">{contenu}</h3>);
      i++;
      continue;
    }

    if (l.trim().startsWith("|") && lignes[i + 1]?.trim().match(/^\|[\s:|-]+\|$/)) {
      const entete = cellules(l);
      i += 2;
      const rangs: string[][] = [];
      while (i < lignes.length && lignes[i]!.trim().startsWith("|")) rangs.push(cellules(lignes[i++]!));
      blocs.push(
        <div key={`${cle++}`} className="overflow-x-auto my-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>{entete.map((c, j) => <th key={j} scope="col" className="border border-border px-3 py-2 text-left bg-muted/50">{enLigne(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rangs.map((r, j) => (
                <tr key={j}>{r.map((c, n) => <td key={n} className="border border-border px-3 py-2 align-top">{enLigne(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const puce = /^\s*(-|\d+\.)\s+/;
    if (puce.test(l)) {
      const ordonnee = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lignes.length && puce.test(lignes[i]!)) {
        let item = lignes[i++]!.replace(puce, "");
        // Une ligne indentee qui suit prolonge l'element.
        while (i < lignes.length && /^\s{2,}\S/.test(lignes[i]!) && !puce.test(lignes[i]!)) item += " " + lignes[i++]!.trim();
        items.push(item);
      }
      const contenu = items.map((t, j) => <li key={j}>{enLigne(t)}</li>);
      blocs.push(
        ordonnee
          ? <ol key={`${cle++}`} className="list-decimal pl-6 space-y-1 my-3">{contenu}</ol>
          : <ul key={`${cle++}`} className="list-disc pl-6 space-y-1 my-3">{contenu}</ul>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lignes.length && lignes[i]!.trim() &&
      !/^#{1,3}\s/.test(lignes[i]!) && !puce.test(lignes[i]!) && !lignes[i]!.trim().startsWith("|")
    ) para.push(lignes[i++]!.trim());
    blocs.push(<p key={`${cle++}`} className="my-3 leading-relaxed">{enLigne(para.join(" "))}</p>);
  }
  return blocs;
}
