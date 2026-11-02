import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, gatewayHeaders, median } from '../src/drive.js';

test('each status code has a verdict', () => {
  assert.equal(verdict(200), 'paid');
  assert.equal(verdict(400), 'no-badge');
  assert.equal(verdict(401), 'bad-badge');
  assert.equal(verdict(403), 'forbidden');
  assert.equal(verdict(429), 'slow-down');
  assert.equal(verdict(502), 'closed');
});

test('only the headers added by Otoroshi are kept', () => {
  const headers = new Headers({
    'Otoroshi-Request-Id': '42',
    'Otoroshi-Daily-Calls-Remaining': '9999',
    'Content-Type': 'application/json',
    'Otoroshi-Client-Secret': 'never',
  });
  assert.deepEqual(gatewayHeaders(headers), { 'otoroshi-daily-calls-remaining': '9999', 'otoroshi-request-id': '42' });
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});
