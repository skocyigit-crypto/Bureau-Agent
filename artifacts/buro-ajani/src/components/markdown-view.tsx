import { useMemo } from "react";

/**
 * Rendu Markdown minimal, SANS dependance externe.
 *
 * Le Dockerfile installe avec --frozen-lockfile: ajouter react-markdown ou
 * marked casserait le build tant que le lockfile n'est pas regenere. Le guide
 * n'utilise qu'un sous-ensemble stable de Markdown (titres, listes, tableaux,
 * gras, code inline, citations, regles, liens), qu'on couvre ici a la main.
 * Objectif: lisibilite, pas conformite CommonMark exhaustive.
 *
 * Chaque titre `##`/`###` recoit un id derive de son texte, pour permettre la
 * navigation par ancre depuis un sommaire.
 */

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Rendu des marques inline: **gras**, `code`, [texte](url). */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // On decoupe successivement sur les liens, puis gras, puis code. Simple et
  // suffisant pour le contenu du guide (pas d'imbrication complexe).
  const pattern = /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const href = linkMatch[2];
        const external = /^https?:\/\//.test(href);
        nodes.push(
          <a
            key={key}
            href={href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="text-emerald-600 dark:text-emerald-400 underline underline-offset-2 hover:text-emerald-700"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-mono text-foreground">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Block {
  type: "h1" | "h2" | "h3" | "h4" | "p" | "ul" | "ol" | "table" | "hr" | "quote";
  content?: string;
  items?: string[];
  rows?: string[][];
  id?: string;
}

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Regle horizontale
    if (/^---+$/.test(line.trim())) { blocks.push({ type: "hr" }); i++; continue; }

    // Titres
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const content = h[2].trim();
      blocks.push({
        type: (["h1", "h2", "h3", "h4"] as const)[level - 1],
        content,
        id: level === 2 || level === 3 ? slugify(content) : undefined,
      });
      i++;
      continue;
    }

    // Citation
    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        parts.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", content: parts.join(" ").trim() });
      continue;
    }

    // Tableau (ligne avec | suivie d'une ligne de separation |---|)
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const parseRow = (r: string) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const rows: string[][] = [parseRow(line)];
      i += 2; // saute l'en-tete + separateur
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", rows });
      continue;
    }

    // Liste non ordonnee
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Liste ordonnee
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraphe (lignes consecutives non vides)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].startsWith(">") &&
      !/^---+$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", content: para.join(" ") });
  }

  return blocks;
}

export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseBlocks(source), [source]);

  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((b, idx) => {
        switch (b.type) {
          case "h1":
            return <h1 key={idx} className="text-2xl font-bold tracking-tight text-foreground mt-2">{renderInline(b.content!, `h1-${idx}`)}</h1>;
          case "h2":
            return <h2 key={idx} id={b.id} className="scroll-mt-20 text-xl font-semibold text-foreground border-b border-border pb-2 mt-8">{renderInline(b.content!, `h2-${idx}`)}</h2>;
          case "h3":
            return <h3 key={idx} id={b.id} className="scroll-mt-20 text-base font-semibold text-foreground mt-6">{renderInline(b.content!, `h3-${idx}`)}</h3>;
          case "h4":
            return <h4 key={idx} className="text-sm font-semibold text-foreground mt-4">{renderInline(b.content!, `h4-${idx}`)}</h4>;
          case "hr":
            return <hr key={idx} className="border-border" />;
          case "quote":
            return (
              <blockquote key={idx} className="border-l-4 border-emerald-500/50 bg-emerald-500/5 rounded-r-lg px-4 py-3 text-foreground/80">
                {renderInline(b.content!, `q-${idx}`)}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={idx} className="list-disc pl-6 space-y-1.5">
                {b.items!.map((it, j) => <li key={j}>{renderInline(it, `ul-${idx}-${j}`)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={idx} className="list-decimal pl-6 space-y-1.5">
                {b.items!.map((it, j) => <li key={j}>{renderInline(it, `ol-${idx}-${j}`)}</li>)}
              </ol>
            );
          case "table":
            return (
              <div key={idx} className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50">
                    <tr>{b.rows![0].map((c, j) => <th key={j} className="px-3 py-2 font-semibold text-foreground">{renderInline(c, `th-${idx}-${j}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows!.slice(1).map((row, r) => (
                      <tr key={r} className="border-t border-border">
                        {row.map((c, j) => <td key={j} className="px-3 py-2 align-top">{renderInline(c, `td-${idx}-${r}-${j}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "p":
          default:
            return <p key={idx}>{renderInline(b.content!, `p-${idx}`)}</p>;
        }
      })}
    </div>
  );
}
