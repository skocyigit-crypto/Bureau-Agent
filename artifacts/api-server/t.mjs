import fs from "node:fs";
const IMPORT = `import { BOM_CSV, celluleCsv, documentCsv, FIN_LIGNE_CSV, ligneCsv, SEPARATEUR_CSV } from "../lib/csv";`;
const escRe = /const escape = \(v: (?:any|unknown)\)(?:: string)? => \{\s*if \(v == null\) return "";\s*const s = String\(v\)\.replace\(\/"\/g, '""'\);\s*return (?:s\.includes\(","\) \|\| s\.includes\('"'\) \|\| s\.includes\("\n"\) \? `"\$\{s\}"` : s|\/\[";\n\]\/\.test\(s\) \? `"\$\{s\}"` : s);\s*\};/g;
function traiter(f, extra) {
  let s = fs.readFileSync(f, "utf8"); const NL = s.includes("\r\n") ? "\r\n" : "\n"; s = s.split(NL).join("\n");
  const avant = s;
  s = s.replace(escRe, "const escape = celluleCsv;");
  s = s.split(`headers.join(",")`).join("headers.join(SEPARATEUR_CSV)");
  s = s.split(`headers.join(";")`).join("headers.join(SEPARATEUR_CSV)");
  s = s.split(`].join(","))`).join("].join(SEPARATEUR_CSV))");
  s = s.split(`lines.join("\n")`).join("lines.join(FIN_LIGNE_CSV) + FIN_LIGNE_CSV");
  s = s.split(`res.send("\uFEFF" + lines`).join("res.send(BOM_CSV + lines");
  s = s.split(`res.write("\uFEFF" + headers.join(SEPARATEUR_CSV) + "\n")`).join("res.write(BOM_CSV + headers.map(celluleCsv).join(SEPARATEUR_CSV) + FIN_LIGNE_CSV)");
  s = s.split(`].join(SEPARATEUR_CSV)).join("\n");`).join("].join(SEPARATEUR_CSV)).join(FIN_LIGNE_CSV);");
  s = s.split(`res.write(chunk + "\n")`).join("res.write(chunk + FIN_LIGNE_CSV)");
  if (extra) s = extra(s);
  if (s === avant) throw new Error("rien change: " + f);
  if (!s.includes('from "../lib/csv"')) {
    const L = s.split("\n"); let last = 0;
    for (let i = 0; i < L.length; i++) { if (/^import |^} from /.test(L[i])) last = i; else if (/^(const|function|router|export)/.test(L[i])) break; }
    L.splice(last + 1, 0, IMPORT); s = L.join("\n");
  }
  fs.writeFileSync(f, s.split("\n").join(NL));
  const reste = (s.match(/includes\(","\)|\.join\(","\)|replace\(\/"\/g, '""'\)/g) || []).length;
  console.log(f, "restes suspects:", reste);
}
const R = (a, b) => (s) => { if (!s.includes(a)) throw new Error("nf: " + a.slice(0, 60)); return s.split(a).join(b); };
const chain = (...fs) => (s) => fs.reduce((x, g) => g(x), s);
for (const f of ["calendar", "calls", "checkins", "contacts", "prospects", "tasks", "notes-internes", "messages", "depenses"]) traiter(`routes/${f}.ts`);
traiter("routes/audit.ts", R(`const escape = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return s.includes(",") || s.includes('"') || s.includes("\n") ? \`"\${s}"\` : s; };`, "const escape = celluleCsv;"));
traiter("routes/performance.ts", R(`const escape = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return s.includes(",") || s.includes('"') || s.includes("\n") ? \`"\${s}"\` : s; };`, "const escape = celluleCsv;"));
traiter("routes/auth.ts", chain(
  R(`    const header = "ID,Email,Prenom,Nom,Role,Departement,Actif,Date creation\n";`, `    const header = ["ID", "Email", "Prenom", "Nom", "Role", "Departement", "Actif", "Date creation"];`),
  R(`u.createdAt ? new Date(u.createdAt).toLocaleDateString("fr-FR") : ""].map(v => \`"\${String(v).replace(/"/g, '""')}"\`).join(",")
    ).join("\n");`, `u.createdAt ? new Date(u.createdAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : ""]);`),
  R(`    const rows = users.map(u =>
      [u.id,`, `    const rows = users.map(u =>
      [u.id,`),
  R(`res.send("\uFEFF" + header + rows);`, `res.send(documentCsv(header, rows));`),
));
traiter("routes/automations.ts", chain(
  R(`    const header = "ID,Nom,Type,Declencheur,Frequence,Actif,Executions,Derniere execution,Date creation\n";`, `    const header = ["ID", "Nom", "Type", "Declencheur", "Frequence", "Actif", "Executions", "Derniere execution", "Date creation"];`),
  R(`        r.createdAt ? new Date(r.createdAt).toLocaleDateString("fr-FR") : ""]
        .map(v => \`"\${String(v).replace(/"/g, '""')}"\`).join(",")
    ).join("\n");`, `        r.createdAt ? new Date(r.createdAt).toLocaleDateString("fr-FR") : ""]);`),
  R(`res.send("\uFEFF" + header + rows);`, `res.send(documentCsv(header, rows));`),
));
traiter("routes/bulk-operations.ts", chain(
  R(`      if (data.length === 0) { res.set("Content-Type", "text/csv").send(""); return; }
      const headers = Object.keys(data[0]);
      const csvRows = [
        headers.join(SEPARATEUR_CSV),
        ...data.map(row => headers.map(h => {
          const val = (row as any)[h];
          if (val === null || val === undefined) return "";
          const str = String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n") ? \`"\${str.replace(/"/g, '""')}"\` : str;
        }).join(SEPARATEUR_CSV))
      ];`, `      if (data.length === 0) { res.set("Content-Type", "text/csv; charset=utf-8").send(BOM_CSV); return; }
      const headers = Object.keys(data[0]);
      const csv = documentCsv(headers, data.map(row => headers.map(h => (row as any)[h])));`),
  R(`      res.send(csvRows.join("\n"));`, `      res.send(csv);`),
));
traiter("routes/documents.ts", chain(
  R(`    if (docs.length === 0) { res.set("Content-Type", "text/csv").send("id,fileName,originalName,mimeType,fileSize,category,entityType,status,createdAt\n"); return; }
    const headers = ["id", "fileName", "originalName", "mimeType", "fileSize", "category", "entityType", "status", "createdAt"];
    const csvRows = [
      headers.join(SEPARATEUR_CSV),
      ...docs.map(d => headers.map(h => {
        const val = (d as any)[h];
        if (val === null || val === undefined) return "";
        const str = String(val instanceof Date ? val.toISOString() : val);
        return str.includes(",") || str.includes('"') || str.includes("\n") ? \`"\${str.replace(/"/g, '""')}"\` : str;
      }).join(SEPARATEUR_CSV))
    ];`, `    const headers = ["id", "fileName", "originalName", "mimeType", "fileSize", "category", "entityType", "status", "createdAt"];
    // Le nom d'origine vient de l'utilisateur : « =cmd|... .pdf » est un nom de fichier valide.
    const csv = documentCsv(headers, docs.map(d => headers.map(h => (d as any)[h])));`),
  R(`    res.send(csvRows.join("\n"));`, `    res.send(csv);`),
));
traiter("routes/export.ts", chain(
  R(`function toCsv(data: any[], columns: { key: string; label: string }[]): string {
  const header = columns.map(c => c.label).join(";");
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key];
      if (val === null || val === undefined) return "";
      const str = String(val).replace(/"/g, '""');
      return \`"\${str}"\`;
    }).join(";")
  );
  return [header, ...rows].join("\n");
}`, `function toCsv(data: any[], columns: { key: string; label: string }[]): string {
  return documentCsv(columns.map(c => c.label), data.map(row => columns.map(c => row[c.key])));
}`),
  R(`res.send("\uFEFF" + csv);`, `res.send(csv);`),
));
