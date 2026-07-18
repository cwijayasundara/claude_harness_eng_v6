import { readFile } from "node:fs/promises";

/**
 * Load simple dotenv files without adding a runtime dependency. Shell variables
 * remain authoritative when callers merge this result into process.env.
 */
export async function loadEnvFile(filePath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return {};
    throw error;
  }

  const values = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const assignment = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!assignment) continue;

    const [, key, rawValue] = assignment;
    let value = rawValue.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}
