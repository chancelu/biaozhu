import fs from "node:fs";
import path from "node:path";

function exists(p: string) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveChromiumExecutablePath(explicit?: string) {
  if (explicit && exists(explicit)) return explicit;

  const root = process.cwd();
  const browsersDir = path.join(root, ".pw-browsers");
  if (!fs.existsSync(browsersDir)) return undefined;

  const entries = fs
    .readdirSync(browsersDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("chromium-"))
    .map((d) => d.name)
    .sort()
    .reverse();

  for (const dir of entries) {
    const candidate = path.join(
      browsersDir,
      dir,
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    );
    if (exists(candidate)) return candidate;
    const candidate2 = path.join(
      browsersDir,
      dir,
      "chrome-mac-x64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    );
    if (exists(candidate2)) return candidate2;
  }

  return undefined;
}

