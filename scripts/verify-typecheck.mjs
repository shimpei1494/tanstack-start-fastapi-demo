import { writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
const probes = ["apps/web/src/typecheck-probe.ts", "packages/api-contract/src/typecheck-probe.ts"];
const created = [];
try {
  for (const path of probes) {
    writeFileSync(path, "export const typecheckProbe: string = 42;\n", { flag: "wx" });
    created.push(path);
  }
  const result = spawnSync("npm", ["run", "lint"], { encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  if (
    result.status === 0 ||
    !probes.every((path) => output.includes(path) && output.includes("TS2322"))
  ) {
    process.stderr.write(output);
    throw new Error(
      "Oxlint did not detect the intentional application and shared-package type errors",
    );
  }
  console.log("Oxlint detects intentional type errors in the app and shared package.");
} finally {
  for (const path of created) rmSync(path, { force: true });
}
