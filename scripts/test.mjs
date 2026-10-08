import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

async function runTests() {
  const testsDir = path.resolve("tests");
  const testFiles = fs.readdirSync(testsDir)
    .filter(f => f.endsWith(".test.ts"))
    .map(f => path.join(testsDir, f));

  console.log(`[Test Runner] Found ${testFiles.length} test suites:`, testFiles.map(f => path.basename(f)).join(", "));

  const distDir = path.resolve("tests/dist");
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outfile = path.join(distDir, "all.tests.cjs");

  // Create single entry that imports all tests
  const entryContent = testFiles.map(f => `import "${f.replace(/\\/g, "/")}";`).join("\n");
  const entryFile = path.join(distDir, "entry.ts");
  fs.writeFileSync(entryFile, entryContent, "utf8");

  await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: outfile,
    external: ["node:*"],
    loader: { ".json": "json" }
  });

  console.log(`[Test Runner] Bundled into ${outfile}. Executing test runner...\n`);

  try {
    execSync(`node --test "${outfile}"`, { stdio: "inherit" });
    console.log("\n[Test Runner] All unit tests completed successfully!");
  } catch (err) {
    console.error("\n[Test Runner] Tests failed!");
    process.exit(1);
  }
}

runTests();
