import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface GlobalConfig {
  rootDir: string;
  recordsDir: string;
  sessionsDir: string;
  workspacesDir: string;
}

export function getGlobalConfig(
  rootDir = process.env.PI_CHAT_ROOT_DIR,
): GlobalConfig {
  const resolvedRootDir = rootDir ?? join(getAgentDir(), "pi-chat");

  return {
    rootDir: resolvedRootDir,
    recordsDir: join(resolvedRootDir, "records"),
    sessionsDir: join(resolvedRootDir, "sessions"),
    workspacesDir: join(resolvedRootDir, "workspaces"),
  };
}

export async function ensureDir(path: string[]) {
  return Promise.all(
    path.map((path) => {
      mkdir(path, { recursive: true });
    }),
  );
}

export function assertInside(parentDir: string, candidateDir: string) {
  const safeRootDir = resolve(parentDir);
  const safeCandidateDir = resolve(candidateDir);
  const child = relative(safeRootDir, safeCandidateDir);
  if (
    !child ||
    child == "" || // candidateDir equals rootDir
    child.startsWith("..") || // candicateDir is outside rootDir
    isAbsolute(child) // absolute path is not allowed
  ) {
    throw new Error(`Directory ${candidateDir} is not inside ${parentDir}`);
  }
  return safeCandidateDir;
}
