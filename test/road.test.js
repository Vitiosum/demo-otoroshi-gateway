import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRoad, isStamped } from '../src/road.js';

const TOKEN = 'booth-secret';

test('the road refuses a request without the booth token', () => {
  const [status, body] = handleRoad('/road/fortune', {}, TOKEN);
  assert.equal(status, 403);
  assert.match(body.error, /toll booth/);
});

test('the road answers a stamped request and echoes the stamp', () => {
  const headers = { 'x-toll-booth-token': TOKEN, 'x-toll-badge': 'Gold badge', 'x-toll-lane': 'gold' };
  const [status, body] = handleRoad('/road/fortune', headers, TOKEN);
  assert.equal(status, 200);
  assert.ok(body.town && body.weather && body.fortune);
  assert.deepEqual(body.stamp, { badge: 'Gold badge', lane: 'gold' });
});

test('a wrong token of the same length is refused', () => {
  assert.equal(isStamped({ 'x-toll-booth-token': 'booth-secreX' }, TOKEN), false);
});

test('without a configured token the road stays open (local development)', () => {
  assert.equal(handleRoad('/road/fortune', {}, '')[0], 200);
});

test('unknown exits are 404, the depot exists behind the gateway rule', () => {
  assert.equal(handleRoad('/road/nowhere', { 'x-toll-booth-token': TOKEN }, TOKEN)[0], 404);
  assert.equal(handleRoad('/road/depot', { 'x-toll-booth-token': TOKEN }, TOKEN)[0], 200);
});
