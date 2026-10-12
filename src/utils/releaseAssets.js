/**
 * Names and URLs of the installers on a GitHub release.
 *
 * Tauri names its bundles after `productName` in src-tauri/tauri.conf.json
 * ("OpenSubtitles Uploader"), and GitHub turns the space into a dot when the
 * file is uploaded. So the installers are "OpenSubtitles.Uploader_<version>_…".
 *
 * This fork inherited "OpenSubtitles.Uploader.PRO_…" from upstream, whose
 * product name ends in PRO. It was written out by hand in three places, and
 * every one of those links was a 404. tests/utils/releaseAssets.test.js ties
 * the prefix to tauri.conf.json so a rename cannot break the links silently.
 */

export const RELEASE_ASSET_PREFIX = 'OpenSubtitles.Uploader';

export const RELEASE_DOWNLOAD_BASE =
  'https://github.com/opensubtitles-dev/opensubtitles-com-uploader/releases/download';

const INSTALLER_SUFFIX = {
  macos: '_universal.dmg',
  windows: '_x64-setup.exe',
  linux: '_amd64.AppImage',
};

const bareVersion = version => String(version).replace(/^v/, '');

/**
 * @param {string} version  with or without a leading "v"
 * @param {'macos'|'windows'|'linux'} platform
 * @returns {string|null} null for a platform we do not ship
 */
export function installerFileName(version, platform) {
  const suffix = INSTALLER_SUFFIX[platform];
  if (!suffix) return null;
  return `${RELEASE_ASSET_PREFIX}_${bareVersion(version)}${suffix}`;
}

/**
 * @param {string} version  with or without a leading "v"
 * @param {'macos'|'windows'|'linux'} platform
 * @returns {string|null}
 */
export function installerUrl(version, platform) {
  const fileName = installerFileName(version, platform);
  if (!fileName) return null;
  return `${RELEASE_DOWNLOAD_BASE}/v${bareVersion(version)}/${fileName}`;
}
