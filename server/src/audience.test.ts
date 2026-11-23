import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesAudience, parseAudience, type AudienceSubject } from './audience.js';

const aruzhan: AudienceSubject = { id: 42, city: 'Almaty', level: 'member', followers: 2840, tags: ['food', 'Students'] };

test('audience: everyone, and broken JSON never hides a task', () => {
  assert.equal(matchesAudience(aruzhan, parseAudience(null)), true);
  assert.equal(matchesAudience(aruzhan, parseAudience('not json')), true);
  assert.equal(matchesAudience(aruzhan, parseAudience('{"mode":"weird"}')), true);
});

test('audience: a segment needs every filter that is set', () => {
  const almatySmall = parseAudience(JSON.stringify({ mode: 'segment', cities: ['almaty'], followersMin: 500, followersMax: 3000 }));
  assert.equal(matchesAudience(aruzhan, almatySmall), true);
  assert.equal(matchesAudience({ ...aruzhan, city: 'Astana' }, almatySmall), false);
  assert.equal(matchesAudience({ ...aruzhan, followers: 3001 }, almatySmall), false);
  assert.equal(matchesAudience({ ...aruzhan, followers: null }, almatySmall), false, 'unknown followers do not fit a follower filter');
  assert.equal(matchesAudience({ ...aruzhan, city: null }, almatySmall), false);

  const proOnly = parseAudience(JSON.stringify({ mode: 'segment', levels: ['pro', 'partner'] }));
  assert.equal(matchesAudience(aruzhan, proOnly), false);
  assert.equal(matchesAudience({ ...aruzhan, level: 'pro' }, proOnly), true);

  const tagged = parseAudience(JSON.stringify({ mode: 'segment', tags: ['students', 'sport'] }));
  assert.equal(matchesAudience(aruzhan, tagged), true, 'tags match without regard to case');
  assert.equal(matchesAudience({ ...aruzhan, tags: [] }, tagged), false);
});

test('audience: a hand-picked list ignores every other filter', () => {
  const list = parseAudience(JSON.stringify({ mode: 'list', userIds: [42], cities: ['Astana'] }));
  assert.equal(matchesAudience(aruzhan, list), true);
  assert.equal(matchesAudience({ ...aruzhan, id: 43 }, list), false);
});
