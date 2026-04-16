import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { adaptRestUser, mergeRefreshedUser } from '../../../src/services/api/userData.js';

const REST_USER = {
  user_id: 66,
  level: 'Sub leecher',
  vip: false,
  allowed_downloads: 20,
  allowed_translations: 5,
  ext_installed: false,
};

describe('adaptRestUser', () => {
  test('returns null for null/undefined/non-object input', () => {
    assert.equal(adaptRestUser(null), null);
    assert.equal(adaptRestUser(undefined), null);
    assert.equal(adaptRestUser('not an object'), null);
    assert.equal(adaptRestUser(42), null);
  });

  test('produces both new and legacy fields', () => {
    const u = adaptRestUser(REST_USER, { username: 'alice', baseUrl: 'https://x.com' });
    // new
    assert.equal(u.username, 'alice');
    assert.equal(u.user_id, 66);
    assert.equal(u.level, 'Sub leecher');
    assert.equal(u.vip, false);
    assert.equal(u.allowed_downloads, 20);
    assert.equal(u.allowed_translations, 5);
    assert.equal(u.ext_installed, false);
    assert.equal(u.base_url, 'https://x.com');
    // legacy
    assert.equal(u.UserNickName, 'alice');
    assert.equal(u.UserRank, 'Sub leecher');
    assert.deepEqual(u.UserRanks, ['Sub leecher']);
    assert.equal(u.IDUser, '66');
    assert.equal(u.UploadCnt, 0);
    assert.equal(u.DownloadCnt, 0);
    assert.equal(u.UserPreferedLanguages, '');
  });

  test('handles missing optional fields with sensible defaults', () => {
    const u = adaptRestUser({ user_id: 1 });
    assert.equal(u.username, null);
    assert.equal(u.level, '');
    assert.equal(u.vip, false);
    assert.equal(u.allowed_downloads, 0);
    assert.equal(u.allowed_translations, 0);
    assert.equal(u.ext_installed, false);
    assert.equal(u.base_url, null);
    assert.deepEqual(u.UserRanks, []);
  });

  test('coerces user_id from string to number consistently', () => {
    const u = adaptRestUser({ user_id: '66', level: 'X' });
    assert.equal(u.user_id, 66);
    assert.equal(u.IDUser, '66');
  });

  test('UserRanks is empty when level is empty string', () => {
    const u = adaptRestUser({ user_id: 1, level: '' });
    assert.deepEqual(u.UserRanks, []);
    assert.deepEqual(u.UserRank, '');
  });

  test('legacy UserNickName empty string when no username supplied', () => {
    const u = adaptRestUser({ user_id: 1 });
    assert.equal(u.UserNickName, '');
  });

  test('vip flag is coerced to boolean', () => {
    assert.equal(adaptRestUser({ vip: 1 }).vip, true);
    assert.equal(adaptRestUser({ vip: 0 }).vip, false);
    assert.equal(adaptRestUser({ vip: 'true' }).vip, true);
    assert.equal(adaptRestUser({ vip: undefined }).vip, false);
  });
});

describe('mergeRefreshedUser', () => {
  test('preserves the original username when /infos/user does not return it', () => {
    const existing = adaptRestUser(REST_USER, { username: 'alice' });
    const refreshed = { user_id: 66, level: 'Bronze Member', vip: false };
    const merged = mergeRefreshedUser(existing, refreshed);
    assert.equal(merged.username, 'alice');
    assert.equal(merged.UserNickName, 'alice');
    assert.equal(merged.level, 'Bronze Member');
    assert.equal(merged.UserRank, 'Bronze Member');
  });

  test('preserves the base_url when refresh response omits it', () => {
    const existing = adaptRestUser(REST_USER, { username: 'alice', baseUrl: 'https://x.com' });
    const merged = mergeRefreshedUser(existing, { user_id: 66, level: 'X' });
    assert.equal(merged.base_url, 'https://x.com');
  });

  test('returns adapted refreshed when there is no existing user', () => {
    const merged = mergeRefreshedUser(null, REST_USER);
    assert.equal(merged.user_id, 66);
    assert.equal(merged.username, null);
  });

  test('returns existing if refreshed is null/undefined', () => {
    const existing = adaptRestUser(REST_USER, { username: 'alice' });
    assert.equal(mergeRefreshedUser(existing, null), existing);
    assert.equal(mergeRefreshedUser(existing, undefined), existing);
  });
});
