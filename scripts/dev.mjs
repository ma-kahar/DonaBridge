// Runs Vite with a local copy of the esbuild binary.
//
// When the project lives in a synced folder (OneDrive, Dropbox…), Windows
// Controlled Folder Access can deny the esbuild.exe process permission to write
// its dependency cache, which makes `vite` fail with "Access is denied".
// Copying the binary to the local temp folder and pointing ESBUILD_BINARY_PATH
// at it keeps the dependency optimiser working without disabling security
// features.

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function installedEsbuildVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(projectRoot, "node_modules", "esbuild", "package.json"), "utf8")
    );
    return String(pkg.version);
  } catch {
    return null;
  }
}

function findEsbuildBinary() {
  if (process.platform !== "win32") return null;

  const wanted = installedEsbuildVersion();
  const pnpmStore = path.join(projectRoot, "node_modules", ".pnpm");
  const storeCandidates = [];

  if (existsSync(pnpmStore)) {
    for (const entry of readdirSync(pnpmStore)) {
      const match = entry.match(/^@esbuild\+win32-x64@(.+)$/);
      if (!match) continue;
      storeCandidates.push({
        version: match[1],
        binary: path.join(
          pnpmStore,
          entry,
          "node_modules",
          "@esbuild",
          "win32-x64",
          "esbuild.exe"
        ),
      });
    }
  }

  // Prefer the exact version the esbuild JS package expects; a mismatch makes
  // the service refuse to start.
  const exact = storeCandidates.find((c) => c.version === wanted && existsSync(c.binary));
  if (exact) return exact.binary;

  const newest = storeCandidates
    .filter((c) => existsSync(c.binary))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (newest) return newest.binary;

  const fallback = path.join(
    projectRoot,
    "node_modules",
    "@esbuild",
    "win32-x64",
    "esbuild.exe"
  );
  return existsSync(fallback) ? fallback : null;
}

function prepareBinary() {
  const source = findEsbuildBinary();
  if (!source) return null;

  const targetDir = path.join(os.tmpdir(), "dona-bridge-tools");
  const target = path.join(targetDir, "esbuild.exe");
  mkdirSync(targetDir, { recursive: true });

  const stale =
    !existsSync(target) || statSync(target).size !== statSync(source).size;
  if (stale) copyFileSync(source, target);
  return target;
}

const binary = prepareBinary();
const env = { ...process.env };
if (binary) env.ESBUILD_BINARY_PATH = binary;

const isWindows = process.platform === "win32";
const child = isWindows
  ? spawn("cmd.exe", ["/c", "pnpm", "exec", "vite"], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    })
  : spawn("pnpm", ["exec", "vite"], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });

child.on("exit", (code) => process.exit(code ?? 0));
