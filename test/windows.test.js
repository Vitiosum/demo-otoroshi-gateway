import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindows } from '../src/windows.js';

const badges = { standard: { window: 3, windowMs: 60_000 } };

test('a window opens with the first paid call and refills after windowMs', () => {
  let now = 0;
  const w = createWindows(badges, () => now);
  assert.deepEqual(w.view('standard'), { left: 3, allowed: 3, resetsInMs: 0 });
  w.track('standard', 'paid');
  now = 10_000;
  assert.deepEqual(w.track('standard', 'paid'), { left: 1, allowed: 3, resetsInMs: 50_000 });
  assert.equal(w.track('standard', 'slow-down').left, 0);
  now = 60_000;
  assert.equal(w.view('standard').left, 3);
});

test('a paid call in a full window means a new window opened', () => {
  let now = 0;
  const w = createWindows(badges, () => now);
  w.track('standard', 'slow-down');
  now = 5_000;
  assert.deepEqual(w.track('standard', 'paid'), { left: 2, allowed: 3, resetsInMs: 60_000 });
});

test('refused cars do not touch the window', () => {
  const w = createWindows(badges, () => 0);
  assert.equal(w.track('standard', 'no-badge').left, 3);
});
