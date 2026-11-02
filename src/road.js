// "The road": the tiny API that sits behind the toll booth.
// It hands out travel fortunes for fictional towns, and it only opens to
// requests stamped by the booth (the X-Toll-Booth-Token header).

import { timingSafeEqual } from 'node:crypto';

const TOWNS = [
  { town: 'Port-Lumière', weather: 'Sea fog lifting by noon, 14 °C' },
  { town: 'Vallombre', weather: 'Clear skies over the pass, 9 °C' },
  { town: 'Saint-Octet-sur-Mer', weather: 'Light drizzle, wind from the west, 12 °C' },
  { town: 'Brumeville', weather: 'Thick fog, headlights on, 7 °C' },
  { town: 'Quai-des-Vents', weather: 'Gusts up to 60 km/h, 11 °C' },
  { town: 'Les Ormeaux-Hauts', weather: 'Sunny intervals, 17 °C' },
  { town: 'Grand-Relais', weather: 'Warm evening, cicadas, 24 °C' },
  { town: 'Mont-Cache', weather: 'Snow on the summit, 2 °C' },
  { town: 'Bois-Latence', weather: 'Steady rain, slow traffic, 10 °C' },
  { town: 'Pont-des-Paquets', weather: 'Starry night, 6 °C' },
];

const FORTUNES = [
  'Clear road ahead: your next deploy goes green on the first try.',
  'A detour shows you a better view. Take it.',
  'Keep your badge close. Someone will ask for it soon.',
  'The fast lane is not always the shortest. Read the signs.',
  'Light traffic tonight. Your requests will not wait in line.',
  'An old friend calls at the next rest area.',
  'Check your mirrors before you scale out.',
  'Fill up before the mountain. Small caches save long trips.',
  'You will cross a border and need no passport.',
  'The barrier lifts for those who wait their turn.',
  'Pack light: small payloads travel faster.',
  'Follow the orange lights. They know the way.',
  'A green light is a promise. Keep it.',
  'Your next exit leads somewhere you have never deployed.',
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function fortune(stamp) {
  const { town, weather } = pick(TOWNS);
  return {
    town,
    weather,
    fortune: pick(FORTUNES),
    km: 12 + Math.floor(Math.random() * 480),
    // What the booth wrote on the request before letting it through.
    stamp: {
      badge: stamp.badge || null,
      lane: stamp.lane || null,
    },
  };
}

// True when the request carries the token only the booth knows.
// Without a configured token (local development), the road stays open.
export function isStamped(headers, roadToken) {
  if (!roadToken) return true;
  const given = Buffer.from(String(headers['x-toll-booth-token'] || ''));
  const expected = Buffer.from(roadToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Handles GET /road/*. Returns [status, body].
export function handleRoad(path, headers, roadToken) {
  if (!isStamped(headers, roadToken)) {
    return [403, {
      error: 'This road only opens through the toll booth.',
      hint: 'Call the gateway with a badge instead of the road itself.',
    }];
  }
  const stamp = { badge: headers['x-toll-badge'], lane: headers['x-toll-lane'] };
  if (path === '/road/fortune') return [200, fortune(stamp)];
  if (path === '/road/depot') {
    // Only reachable if the gateway's path rule were removed.
    return [200, { depot: 'Staff area: salt trucks, spare cones and the coffee machine.', stamp }];
  }
  return [404, { error: 'No such exit on this road.' }];
}
