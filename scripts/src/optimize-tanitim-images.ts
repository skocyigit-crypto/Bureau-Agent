import sharp from "sharp";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "..", "artifacts/tanitim/src/assets/images");

const TARGETS: Record<string, { width: number; quality: number; effort?: number }> = {
  "feature-calls.png":     { width: 1280, quality: 80, effort: 5 },
  "feature-dashboard.png": { width: 1280, quality: 80, effort: 5 },
  "testimonial-1.png":     { width: 256,  quality: 78, effort: 5 },
  "testimonial-2.png":     { width: 256,  quality: 78, effort: 5 },
  "testimonial-3.png":     { width: 256,  quality: 78, effort: 5 },
};
const UNUSED = ["office-manager.png", "hero-dashboard.png"];

async function main() {
  const before = await dirSize(SRC);
  const results: Array<{ name: string; from: number; to: number }> = [];

  for (const [file, opts] of Object.entries(TARGETS)) {
    const inP = path.join(SRC, file);
    const outP = path.join(SRC, file.replace(/\.png$/, ".webp"));
    const inSize = (await stat(inP)).size;
    const meta = await sharp(inP).metadata();
    const targetW = Math.min(opts.width, meta.width ?? opts.width);
    await sharp(inP)
      .resize({ width: targetW, withoutEnlargement: true })
      .webp({ quality: opts.quality, effort: opts.effort ?? 4 })
      .toFile(outP);
    const outSize = (await stat(outP)).size;
    results.push({ name: file, from: inSize, to: outSize });
    await unlink(inP);
  }

  for (const f of UNUSED) {
    const p = path.join(SRC, f);
    try {
      const s = (await stat(p)).size;
      await unlink(p);
      results.push({ name: `${f} (DELETED — unused import)`, from: s, to: 0 });
    } catch { /* already gone */ }
  }

  const after = await dirSize(SRC);
  console.log("\nFile-by-file:");
  for (const r of results) {
    const pct = r.from === 0 ? 0 : Math.round((1 - r.to / r.from) * 100);
    console.log(`  ${r.name.padEnd(48)} ${(r.from/1024).toFixed(0).padStart(5)}K -> ${(r.to/1024).toFixed(0).padStart(5)}K  (-${pct}%)`);
  }
  console.log(`\nTotal: ${(before/1024/1024).toFixed(2)}M -> ${(after/1024/1024).toFixed(2)}M  (-${Math.round((1 - after/before)*100)}%)`);
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const f of await readdir(dir)) {
    total += (await stat(path.join(dir, f))).size;
  }
  return total;
}

main().catch((e) => { console.error(e); process.exit(1); });
