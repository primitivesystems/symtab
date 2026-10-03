import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const goCommand = process.env.GO_BIN ?? "go";
const child = spawn(goCommand, ["-C", "server", "run", "-tags", "sqlite_fts5", "."], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
});

const onSigint = () => child.kill("SIGINT");
const onSigterm = () => child.kill("SIGTERM");
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);

let spawnFailed = false;
child.on("error", (error) => {
  spawnFailed = true;
  process.exitCode = 1;
  if (error.code === "ENOENT") {
    console.error("Go was not found. Install Go 1.25+ from https://go.dev/dl/ or set GO_BIN.");
  } else {
    console.error(`Could not start Go (${goCommand}): ${error.message}`);
  }
});

child.on("close", (code, signal) => {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);

  if (spawnFailed) {
    process.exitCode = 1;
  } else if (code !== null) {
    process.exitCode = code;
  } else {
    process.exitCode = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
  }
});
