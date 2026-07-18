import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./load-env.mjs";
import { generateContextGraph } from "./generate-context-graph.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "..");
const packageWiki = path.join(packageRoot, "wiki");
const OpenWikiStagingDirectory = path.join(repositoryRoot, "openwiki");
const cli = path.join(packageRoot, "node_modules", "openwiki", "dist", "cli.js");

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function configuredEnvironment(environment) {
  if (!environment.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");
  return {
    ...environment,
    OPENWIKI_PROVIDER: "openai",
    OPENWIKI_MODEL_ID: environment.OPENWIKI_MODEL_ID ?? "gpt-5.6-terra",
    OPENWIKI_TELEMETRY_DISABLED: environment.OPENWIKI_TELEMETRY_DISABLED ?? "1",
  };
}

async function restoreWiki() {
  if (await exists(OpenWikiStagingDirectory)) {
    if (await exists(packageWiki)) {
      throw new Error("Both openwiki/ and open_wiki/wiki/ exist. Resolve the duplicate wiki before running again.");
    }
    await rename(OpenWikiStagingDirectory, packageWiki);
  }
}

async function prepareStagingDirectory() {
  if (await exists(OpenWikiStagingDirectory)) {
    throw new Error("openwiki/ already exists at the repository root. This wrapper will not overwrite it.");
  }

  if (await exists(packageWiki)) {
    await rename(packageWiki, OpenWikiStagingDirectory);
  }
}

async function normalizeOpenWikiPointers() {
  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    const target = path.join(repositoryRoot, file);
    if (!(await exists(target))) continue;
    const content = await readFile(target, "utf8");
    const start = content.indexOf("<!-- OPENWIKI:START -->");
    const end = content.indexOf("<!-- OPENWIKI:END -->");
    if (start === -1 || end === -1 || end < start) continue;
    const blockEnd = end + "<!-- OPENWIKI:END -->".length;
    const block = content.slice(start, blockEnd).replaceAll("openwiki/", "open_wiki/wiki/");
    await writeFile(target, `${content.slice(0, start)}${block}${content.slice(blockEnd)}`, "utf8");
  }
}

async function syncWorkflow() {
  const target = path.join(repositoryRoot, ".github", "workflows", "openwiki-update.yml");
  const template = await readFile(path.join(packageRoot, "github-actions.yml"), "utf8");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, template, "utf8");
}

async function main() {
  if (!(await exists(cli))) {
    throw new Error("OpenWiki is not installed. Run `npm install --prefix open_wiki` first.");
  }

  await prepareStagingDirectory();
  const environment = {
    ...(await loadEnvFile(path.join(packageRoot, ".env"))),
    ...process.env,
  };
  let exitCode = 1;
  const refreshesWiki = process.argv.includes("--init") || process.argv.includes("--update");
  try {
    exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "code", ...process.argv.slice(2), "--print"], {
        cwd: repositoryRoot,
        env: configuredEnvironment(environment),
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await restoreWiki();
    if (refreshesWiki && await exists(packageWiki)) {
      await generateContextGraph({
        bundleRoot: packageWiki,
        repositoryRoot,
        name: "Claude Harness Engine v5",
      });
    }
    await normalizeOpenWikiPointers();
    await syncWorkflow();
  }

  process.exitCode = exitCode;
}

main().catch(async (error) => {
  // A failed setup may have created an empty staging directory; preserve real output,
  // but do not leave an empty one blocking the next run.
  if (await exists(OpenWikiStagingDirectory) && !(await exists(packageWiki))) {
    await mkdir(packageRoot, { recursive: true });
    await rename(OpenWikiStagingDirectory, packageWiki);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
