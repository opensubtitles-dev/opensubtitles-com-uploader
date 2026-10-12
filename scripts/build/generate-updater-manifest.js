#!/usr/bin/env node
/**
 * Builds latest.json, the manifest the Tauri updater reads.
 *
 * It exists as a script, not as shell inside the workflow, because the inline
 * version shipped a manifest for v2.0.0 in which every signature was empty and
 * every URL was a 404 — and nothing noticed. Two rules follow from that:
 *
 *   - Nothing is hardcoded. URLs are derived from the signature files the
 *     build actually produced, so the manifest cannot name a file that was
 *     never built. (The old one named "OpenSubtitles.Uploader.PRO_…" assets
 *     in a repository whose product is called "OpenSubtitles Uploader".)
 *   - It refuses to write a manifest that would break auto-update. A missing
 *     platform, an empty signature, or a macOS URL the updater cannot install
 *     is an error and a non-zero exit, never a warning.
 *
 * Usage:
 *   node scripts/build/generate-updater-manifest.js \
 *     --version v2.0.1 --repo owner/name --sig-dir ./updater-sigs \
 *     [--notes-file notes.txt] [--assets-file assets.txt] [--out latest.json]
 *
 * --assets-file is a list of the release's asset names, one per line. When
 * given, every URL must point at one of them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Which signature file feeds which updater platform keys. The updater asks
 * for "<os>-<arch>"; the one universal macOS archive serves all three.
 */
export const PLATFORM_RULES = [
  { label: 'Windows', suffix: 'setup.exe.sig', platforms: ['windows-x86_64'] },
  {
    label: 'macOS',
    suffix: '.app.tar.gz.sig',
    platforms: ['darwin-universal', 'darwin-x86_64', 'darwin-aarch64'],
  },
  { label: 'Linux', suffix: '.AppImage.sig', platforms: ['linux-x86_64'] },
];

/**
 * The name GitHub gives an uploaded release asset: spaces become dots.
 * "OpenSubtitles Uploader_2.0.1_x64-setup.exe" is served as
 * "OpenSubtitles.Uploader_2.0.1_x64-setup.exe".
 */
export const releaseAssetName = fileName => fileName.replace(/ /g, '.');

/**
 * @param {object} input
 * @param {string} input.version      release tag, e.g. "v2.0.1"
 * @param {string} input.repo         "owner/name"
 * @param {Array<{file: string, signature: string}>} input.signatures
 *        one entry per .sig file the build produced
 * @param {string} [input.notes]
 * @param {string} [input.pubDate]    ISO timestamp
 * @param {string[]|null} [input.releaseAssets] asset names on the release
 * @returns {{manifest: object|null, errors: string[]}}
 */
export function buildManifest({
  version,
  repo,
  signatures = [],
  notes = '',
  pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  releaseAssets = null,
}) {
  const errors = [];
  if (!version) errors.push('No version given');
  if (!repo) errors.push('No repository given');

  const platforms = {};

  for (const rule of PLATFORM_RULES) {
    const matches = signatures.filter(s => s.file.endsWith(rule.suffix));

    if (matches.length === 0) {
      errors.push(
        `No ${rule.label} updater signature (*${rule.suffix}) was produced — ` +
          `auto-update would be broken for ${rule.platforms.join(', ')}`
      );
      continue;
    }
    if (matches.length > 1) {
      errors.push(
        `${matches.length} ${rule.label} signatures found (${matches.map(m => m.file).join(', ')}); expected exactly one`
      );
      continue;
    }

    const { file, signature } = matches[0];
    const trimmed = (signature || '').trim();
    if (!trimmed) {
      errors.push(
        `Empty updater signature in ${file} — auto-update would be broken for ${rule.platforms.join(', ')}`
      );
      continue;
    }

    // The signed artifact is the signature's file name without ".sig".
    const asset = releaseAssetName(file.slice(0, -'.sig'.length));

    if (releaseAssets && !releaseAssets.includes(asset)) {
      errors.push(
        `${rule.label} updater artifact "${asset}" is not among the release assets — its URL would be a 404`
      );
      continue;
    }

    const url = `https://github.com/${repo}/releases/download/${version}/${asset}`;
    for (const platform of rule.platforms) {
      platforms[platform] = { signature: trimmed, url };
    }
  }

  // The updater can only install an .app.tar.gz on macOS. PLATFORM_RULES
  // already guarantees it; this guards against someone loosening the rule.
  for (const [platform, entry] of Object.entries(platforms)) {
    if (platform.startsWith('darwin-') && !entry.url.endsWith('.app.tar.gz')) {
      errors.push(
        `macOS updater URL is not a .app.tar.gz (${entry.url}) — the updater cannot install it`
      );
    }
  }

  if (errors.length > 0) return { manifest: null, errors };

  return {
    manifest: { version, notes, pub_date: pubDate, platforms },
    errors,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const parseArgs = argv => {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const sigDir = args['sig-dir'];

  if (!sigDir || !fs.existsSync(sigDir)) {
    console.error(`::error::Signature directory not found: ${sigDir}`);
    process.exit(1);
  }

  const signatures = fs
    .readdirSync(sigDir, { recursive: true })
    .map(String)
    .filter(name => name.endsWith('.sig'))
    .map(name => ({
      file: path.basename(name),
      signature: fs.readFileSync(path.join(sigDir, name), 'utf8'),
    }));

  const releaseAssets = args['assets-file']
    ? fs
        .readFileSync(args['assets-file'], 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    : null;

  const { manifest, errors } = buildManifest({
    version: args.version,
    repo: args.repo,
    signatures,
    notes: args['notes-file'] ? fs.readFileSync(args['notes-file'], 'utf8').trim() : '',
    releaseAssets,
  });

  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    console.error(`Refusing to write an updater manifest with ${errors.length} problem(s).`);
    process.exit(1);
  }

  const out = args.out || 'latest.json';
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${out}:`);
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    console.log(`  ${platform.padEnd(17)} signature ${entry.signature.length} chars  ${entry.url}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
