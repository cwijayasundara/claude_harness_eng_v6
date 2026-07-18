import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./load-env.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = { ...(await loadEnvFile(path.join(packageRoot, ".env"))), ...process.env };
const provider = environment.OPENWIKI_PROVIDER ?? "openai";
const requiredKey = provider === "moonshot" ? "MOONSHOT_API_KEY" : "OPENAI_API_KEY";
const missing = [requiredKey].filter((name) => !environment[name]);

if (missing.length > 0) {
  console.error(`Missing required environment variable: ${missing.join(", ")}`);
  console.error(`Set OPENWIKI_PROVIDER=${provider} and ${requiredKey} in open_wiki/.env.`);
  process.exit(1);
}

console.log(`${provider} configuration is present.`);
