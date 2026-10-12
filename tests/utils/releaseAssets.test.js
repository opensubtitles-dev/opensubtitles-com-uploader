import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  RELEASE_ASSET_PREFIX,
  installerFileName,
  installerUrl,
} from '../../src/utils/releaseAssets.js';
import { releaseAssetName } from '../../scripts/build/generate-updater-manifest.js';

const tauriConfig = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));

describe('release asset names', () => {
  // The guard that was missing: the app's download links named
  // "OpenSubtitles.Uploader.PRO_…" while the build produced
  // "OpenSubtitles.Uploader_…". Nothing connected the two.
  test('the prefix is what Tauri and GitHub make of productName', () => {
    assert.equal(RELEASE_ASSET_PREFIX, releaseAssetName(tauriConfig.productName));
  });

  test('matches the assets actually published for v2.0.0', () => {
    assert.equal(
      installerFileName('2.0.0', 'macos'),
      'OpenSubtitles.Uploader_2.0.0_universal.dmg'
    );
    assert.equal(
      installerFileName('2.0.0', 'windows'),
      'OpenSubtitles.Uploader_2.0.0_x64-setup.exe'
    );
    assert.equal(
      installerFileName('2.0.0', 'linux'),
      'OpenSubtitles.Uploader_2.0.0_amd64.AppImage'
    );
  });

  test('accepts the version with or without a leading v', () => {
    assert.equal(installerFileName('v2.0.1', 'windows'), installerFileName('2.0.1', 'windows'));
    assert.equal(
      installerUrl('v2.0.1', 'windows'),
      'https://github.com/opensubtitles-dev/opensubtitles-com-uploader/releases/download/v2.0.1/OpenSubtitles.Uploader_2.0.1_x64-setup.exe'
    );
    assert.equal(installerUrl('2.0.1', 'windows'), installerUrl('v2.0.1', 'windows'));
  });

  test('an unknown platform yields nothing rather than a made-up link', () => {
    assert.equal(installerFileName('2.0.1', 'freebsd'), null);
    assert.equal(installerUrl('2.0.1', 'freebsd'), null);
  });
});
