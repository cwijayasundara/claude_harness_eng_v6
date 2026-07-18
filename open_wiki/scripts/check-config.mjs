import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./load-env.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = { ...(await loadEnvFile(path.join(packageRoot, ".env"))), ...process.env };
const missing = ["OPENAI_API_KEY"].filter((name) => !environment[name]);

if (missing.length > 0) {
  console.error(`Missing required environment variable: ${missing.join(", ")}`);
  console.error("Set OPENAI_API_KEY in open_wiki/.env.");
  process.exit(1);
}

console.log("OpenAI configuration is present.");
