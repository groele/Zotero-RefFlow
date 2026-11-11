import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function syncDocumentMetrics() {
  function walkFiles(dir, ext) {
    let out = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkFiles(p, ext));
      else if (entry.name.endsWith(ext)) out.push(p);
    }
    return out;
  }
  const sourceCount = walkFiles(path.join(__dirname, "../src"), ".ts").length;
  const baselinePath = path.join(__dirname, "architecture-baseline.json");
  if (existsSync(baselinePath)) {
    const raw = readFileSync(baselinePath, "utf8");
    const updated = raw.replace(/All \d+ source files in src\//, `All ${sourceCount} source files in src/`);
    if (updated !== raw) writeFileSync(baselinePath, updated);
  }
  const readmeZHPath = path.join(__dirname, "../README.md");
  if (existsSync(readmeZHPath)) {
    const raw = readFileSync(readmeZHPath, "utf8");
    const updated = raw.replace(/全仓 \d+ 个源码模块/, `全仓 ${sourceCount} 个源码模块`);
    if (updated !== raw) writeFileSync(readmeZHPath, updated);
  }
  const readmeENPath = path.join(__dirname, "../README.en.md");
  if (existsSync(readmeENPath)) {
    const raw = readFileSync(readmeENPath, "utf8");
    const updated = raw.replace(/all \d+ source modules/, `all ${sourceCount} source modules`);
    if (updated !== raw) writeFileSync(readmeENPath, updated);
  }
  return sourceCount;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const count = syncDocumentMetrics();
  console.log(`[Sync Metrics] Synchronized documentation and baseline to ${count} source modules.`);
}
