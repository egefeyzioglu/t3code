#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const VALID_CHANNELS = ["nightly", "staging", "stable"] as const;
type AptChannel = (typeof VALID_CHANNELS)[number];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(repoRoot, "release");

/**
 * Infer the apt channel from a .deb filename.
 *
 * The electron-builder artifact name encodes the version string, so we can
 * detect `-nightly.YYYYMMDD.N` and `-staging.YYYYMMDD.N` suffixes directly
 * from the filename without needing to shell out to dpkg-deb.
 */
function inferChannelFromDebFilename(filename: string): AptChannel {
  if (/-nightly\.\d{8}\.\d+/.test(filename)) return "nightly";
  if (/-staging\.\d{8}\.\d+/.test(filename)) return "staging";
  return "stable";
}

function parseChannel(): AptChannel | undefined {
  const { values } = parseArgs({
    options: {
      channel: { type: "string", short: "c" },
    },
    strict: false,
  });

  const raw = values.channel as string | undefined;
  if (!raw) return undefined;

  if (!VALID_CHANNELS.includes(raw as AptChannel)) {
    console.error(`Invalid channel '${raw}'. Must be one of: ${VALID_CHANNELS.join(", ")}`);
    process.exit(1);
  }

  return raw as AptChannel;
}

// ---------------------------------------------------------------------------

// Find the .deb file in release/
if (!existsSync(releaseDir)) {
  console.error(`Release directory not found: ${releaseDir}`);
  console.error("Run 'bun run deb' first to build the .deb package.");
  process.exit(1);
}

const debFiles = readdirSync(releaseDir)
  .filter((f) => f.endsWith(".deb"))
  .map((f) => join(releaseDir, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (debFiles.length === 0) {
  console.error("No .deb file found in release/. Run 'bun run deb' first.");
  process.exit(1);
}

const debFile = debFiles[0]!;
const debFilename = debFile.split("/").pop()!;
console.log(`Found .deb: ${debFile}`);

// Resolve the target channel: explicit flag wins, otherwise infer from the
// .deb filename version string.
const explicitChannel = parseChannel();
const channel: AptChannel = explicitChannel ?? inferChannelFromDebFilename(debFilename);

if (!explicitChannel) {
  console.log(`Auto-detected channel '${channel}' from filename.`);
} else {
  console.log(`Using explicit channel '${channel}'.`);
}

const aptRepoDir = join(homedir(), "apt-repo");
const confDir = join(aptRepoDir, "conf");

// Ensure apt repo directory structure exists
mkdirSync(confDir, { recursive: true });

const distributionsPath = join(confDir, "distributions");

// Build the full distributions file with all three codenames so reprepro
// always knows about every channel, regardless of which one we push to.
function buildDistributionsContent(): string {
  const entries: { codename: AptChannel; label: string; description: string }[] = [
    {
      codename: "stable",
      label: "T3 Code Stable",
      description: "T3 Code stable apt repository",
    },
    {
      codename: "staging",
      label: "T3 Code Staging",
      description: "T3 Code staging apt repository",
    },
    {
      codename: "nightly",
      label: "T3 Code Nightly",
      description: "T3 Code nightly apt repository",
    },
  ];

  return entries
    .map(
      (e) =>
        [
          "Origin: T3 Code",
          `Label: ${e.label}`,
          `Codename: ${e.codename}`,
          "Architectures: amd64",
          "Components: main",
          `Description: ${e.description}`,
        ].join("\n") + "\n",
    )
    .join("\n");
}

// Always regenerate the distributions file so that all codenames are present.
writeFileSync(distributionsPath, buildDistributionsContent());
console.log(`Wrote ${distributionsPath}`);

const optionsPath = join(confDir, "options");
if (!existsSync(optionsPath)) {
  writeFileSync(optionsPath, `verbose\nbasedir ${aptRepoDir}\n`);
  console.log(`Created ${optionsPath}`);
}

// Remove any existing t3code package for this channel to allow clean re-push
try {
  execFileSync(
    "reprepro",
    ["-b", aptRepoDir, "removefilter", channel, "Package (== t3code)"],
    { stdio: "inherit" },
  );
} catch {
  // Ignore errors -- package may not exist yet
}

// Add the .deb to the repo under the resolved channel codename
console.log(`Adding ${debFile} to apt repo at ${aptRepoDir} (codename: ${channel})...`);
execFileSync("reprepro", ["-b", aptRepoDir, "includedeb", channel, debFile], {
  stdio: "inherit",
});

console.log(`Done. Package added to '${channel}' channel in local apt repo.`);
