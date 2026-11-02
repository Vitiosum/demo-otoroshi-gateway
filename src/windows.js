// The minute windows of the badges, as Otoroshi's FixedWindow strategy counts
// them: a window opens with the first call and lasts `windowMs`.
//
// Otoroshi enforces this limit (it answers 429), but its quotas endpoint does
// not report the counter of this strategy (always 0 on 18.0.1). So the app
// follows each window from the gateway's answers. The calls left today come
// from Otoroshi itself (the otoroshi-daily-calls-remaining header).

export function createWindows(badges, now = () => Date.now()) {
  const windows = {};

  function track(lane, verdict) {
    const badge = badges[lane];
    if (!badge || (verdict !== 'paid' && verdict !== 'slow-down')) return view(lane);
    const t = now();
    let w = windows[lane];
    const expired = !w || t - w.start >= badge.windowMs;
    // A paid call in a window we thought full means a new window opened.
    const contradiction = w && verdict === 'paid' && w.used >= badge.window;
    if (expired || contradiction) w = windows[lane] = { start: t, used: 0 };
    if (verdict === 'paid') w.used += 1;
    else w.used = badge.window; // 429: the booth says the window is full
    return view(lane);
  }

  function view(lane) {
    const badge = badges[lane];
    const w = windows[lane];
    const t = now();
    if (!w || t - w.start >= badge.windowMs) return { left: badge.window, allowed: badge.window, resetsInMs: 0 };
    return {
      left: Math.max(0, badge.window - w.used),
      allowed: badge.window,
      resetsInMs: badge.windowMs - (t - w.start),
    };
  }

  return { track, view };
}
