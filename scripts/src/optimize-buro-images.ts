import sharp from "sharp";
import { stat } from "node:fs/promises";
import path from "node:path";

const sourceDir = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "artifacts/buro-ajani/src/assets/images",
);

const targets = [
  "security-server.png",
  "ai-technology.png",
  "office-team.png",
  "messaging-center.png",
  "analytics-work.png",
  "reception-desk.png",
  "task-management.png",
  "call-center.png",
];

async function main() {
  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of targets) {
    const input = path.join(sourceDir, file);
    const output = path.join(sourceDir, file.replace(/\.png$/, ".webp"));
    const before = (await stat(input)).size;

    await sharp(input).webp({ quality: 82, effort: 5 }).toFile(output);
    const after = (await stat(output)).size;

    totalBefore += before;
    totalAfter += after;
    const reduction = Math.round((1 - after / before) * 100);
    console.log(
      `${file}: ${format(before)} -> ${format(after)} (-${reduction}%)`,
    );
  }

  console.log(
    `Total: ${format(totalBefore)} -> ${format(totalAfter)} (-${Math.round((1 - totalAfter / totalBefore) * 100)}%)`,
  );
}

function format(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
