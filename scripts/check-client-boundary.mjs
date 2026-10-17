import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = "apps/web/.output/public";
const forbidden = [
  "API_BASE_URL",
  "DATABASE_URL",
  "postgresql+psycopg",
  "127.0.0.1:8000",
  "http://api:8000",
];
function visit(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.(js|html|json|map)$/.test(file)) {
      const content = readFileSync(file, "utf8");
      for (const value of forbidden)
        if (content.includes(value)) throw new Error(`Server setting ${value} leaked into ${file}`);
    }
  }
}
visit(root);
console.log("Client build contains no internal API or database settings.");
