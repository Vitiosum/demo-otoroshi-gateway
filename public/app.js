// The Toll Booth, in the browser: draws the plaza, sends convoys to the app
// (which drives them through Otoroshi server-side) and prints the receipts.
// No framework: the DOM, an SVG and fetch.

const NS = 'http://www.w3.org/2000/svg';
const $ = (selector, root = document) => root.querySelector(selector);

const LANE_X = { vip: 100, standard: 300, none: 500 };
const LANE_NAMES = { vip: 'Gold badge', standard: 'Standard badge', none: 'No badge' };
const LANE_SHORT = { vip: 'Gold', standard: 'Standard', none: 'No badge' };
const STOP_Y = 198; // front bumper of the first car, just under the barrier
const GAP = 110; // distance between two queued cars
const VISIBLE = 4; // queued cars drawn on the road, the others wait off-screen
const HIDDEN_Y = 560;

const VERDICTS = {
  paid: { label: 'PAID', lamp: 'open', light: 'go', words: 'paid' },
  'slow-down': { label: 'SLOW DOWN', lamp: 'slow', light: 'slow', words: 'told to slow down' },
  'no-badge': { label: 'NO BADGE', lamp: 'closed', light: 'stop', words: 'turned away without a badge' },
  'bad-badge': { label: 'BAD BADGE', lamp: 'closed', light: 'stop', words: 'caught with a forged badge' },
  forbidden: { label: 'STAFF ONLY', lamp: 'closed', light: 'stop', words: 'stopped at the staff exit' },
  closed: { label: 'CLOSED', lamp: 'closed', light: 'stop', words: 'found the road closed' },
};

const THANKS = {
  paid: 'Thank you. Drive safely.',
  'slow-down': 'Quota for this minute used up. Wait for the next one.',
  'no-badge': 'No badge, no entry. Please turn around.',
  'bad-badge': 'This badge is not valid. Please turn around.',
  forbidden: 'This exit is for staff only, whatever your badge.',
  closed: 'The road did not answer. Try again later.',
};

// What each plugin of the route does, in plain words.
const PLUGIN_TEXT = {
  OverrideHost: ['Point to the road', 'Calls the road with the road\'s own Host header, so Clever Cloud routes the request to the right app.'],
  ApikeyCalls: ['Check the badge', 'No badge, no entry. Reads the badge from the Otoroshi-Client-Id and Otoroshi-Client-Secret headers (or Basic auth) and counts the call against its quotas.'],
  RoutingRestrictions: ['Close the staff exit', 'Any path under /road/depot is answered 403, whatever the badge.'],
  AdditionalHeadersIn: ['Stamp the request', 'Adds the booth\'s secret token and the badge name before calling the road. The road refuses any request without the token.'],
  SendOtoroshiHeadersBack: ['Print the receipt', 'Adds the request id, the gateway and road latencies, and the calls left today, to the response.'],
};

const CAR_SHAPES = {
  coupe: {
    length: 92,
    svg: `<path class="car__beam" d="M-21 3L-44-84H-8L-11 3ZM21 3L44-84H8L11 3Z"/>
      <rect class="car__shadow" x="-26" y="6" width="52" height="92" rx="16"/>
      <path class="car__body" d="M-23 16C-23 4-15 0 0 0S23 4 23 16L24 78C24 88 18 92 0 92S-24 88-24 78Z"/>
      <rect class="car__body" x="-28" y="31" width="6" height="4" rx="2"/><rect class="car__body" x="22" y="31" width="6" height="4" rx="2"/>
      <path class="car__shine" d="M-12 6Q0 3 12 6L10 22H-10Z"/>
      <path class="car__glass" d="M-18 30Q0 25 18 30L15 43Q0 40-15 43Z"/>
      <rect class="car__roof" x="-15" y="43" width="30" height="24" rx="6"/>
      <path class="car__glass" d="M-15 67Q0 70 15 67L17 77Q0 80-17 77Z"/>
      <ellipse class="car__head" cx="-14" cy="3.5" rx="5" ry="2.4"/><ellipse class="car__head" cx="14" cy="3.5" rx="5" ry="2.4"/>
      <rect class="car__tail" x="-20" y="88" width="10" height="3" rx="1.5"/><rect class="car__tail" x="10" y="88" width="10" height="3" rx="1.5"/>`,
  },
  hatch: {
    length: 82,
    svg: `<path class="car__beam" d="M-19 3L-40-80H-6L-10 3ZM19 3L40-80H6L10 3Z"/>
      <rect class="car__shadow" x="-25" y="6" width="50" height="82" rx="12"/>
      <path class="car__body" d="M-22 12C-22 3-14 0 0 0S22 3 22 12L23 74C23 80 18 82 0 82S-23 80-23 74Z"/>
      <rect class="car__body" x="-27" y="24" width="6" height="4" rx="2"/><rect class="car__body" x="21" y="24" width="6" height="4" rx="2"/>
      <path class="car__shine" d="M-10 5H10L9 16H-9Z"/>
      <path class="car__glass" d="M-18 20Q0 16 18 20L16 32Q0 30-16 32Z"/>
      <rect class="car__roof" x="-16" y="32" width="32" height="30" rx="5"/>
      <path class="car__glass" d="M-16 62H16L17 70Q0 72-17 70Z"/>
      <ellipse class="car__head" cx="-13" cy="3" rx="4.5" ry="2.2"/><ellipse class="car__head" cx="13" cy="3" rx="4.5" ry="2.2"/>
      <rect class="car__tail" x="-20" y="78" width="9" height="3" rx="1.5"/><rect class="car__tail" x="11" y="78" width="9" height="3" rx="1.5"/>`,
  },
  van: {
    length: 100,
    svg: `<path class="car__beam" d="M-20 3L-42-80H-7L-11 3ZM20 3L42-80H7L11 3Z"/>
      <rect class="car__shadow" x="-26" y="6" width="52" height="100" rx="7"/>
      <rect class="car__body" x="-24" y="0" width="48" height="100" rx="7"/>
      <rect class="car__body" x="-29" y="16" width="6" height="5" rx="2"/><rect class="car__body" x="23" y="16" width="6" height="5" rx="2"/>
      <path class="car__glass" d="M-20 9H20L19 22H-19Z"/>
      <rect class="car__roof" x="-21" y="25" width="42" height="71" rx="3"/>
      <path d="M-21 42H21M-21 58H21M-21 74H21" stroke="rgba(0,0,0,.22)" stroke-width="2"/>
      <ellipse class="car__head" cx="-15" cy="3" rx="5" ry="2.2"/><ellipse class="car__head" cx="15" cy="3" rx="5" ry="2.2"/>
      <rect class="car__tail" x="-21" y="96" width="8" height="3" rx="1.5"/><rect class="car__tail" x="13" y="96" width="8" height="3" rx="1.5"/>`,
  },
};

const PAINT = {
  vip: [['#e0b13a', '#2a2622']],
  standard: [['#3d7be0'], ['#e7e8ee'], ['#c8333f'], ['#3aa79a'], ['#9aa3b5'], ['#e07b39']],
  none: [['#7d6a55'], ['#5c6b4c'], ['#8a8f98'], ['#a0522d']],
};

const state = { exit: 'fortune', trips: [], windows: {}, inflight: {}, current: null };
const lanes = Object.fromEntries(Object.keys(LANE_X).map((lane) => [lane, { cars: [], busy: false, barrierTimer: 0, bubbleTimer: 0 }]));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatNumber = (n) => (Number.isFinite(Number(n)) && n !== null && n !== '' ? Number(n).toLocaleString('en-US') : '-');
const formatMs = (ms) => (ms === null || ms === undefined ? '-' : `${ms < 10 ? Number(ms).toFixed(1) : Math.round(ms)} ms`);

// ---------- The plaza ----------

function makeCar(lane) {
  const kind = lane === 'vip' ? 'coupe' : lane === 'standard' ? 'hatch' : 'van';
  const [body, roof] = PAINT[lane][Math.floor(Math.random() * PAINT[lane].length)];
  const el = document.createElementNS(NS, 'g');
  el.setAttribute('class', 'car');
  el.innerHTML = CAR_SHAPES[kind].svg;
  el.style.setProperty('--body', body);
  el.style.setProperty('--roof', roof || `color-mix(in srgb, ${body} 72%, #000)`);
  el.style.transition = 'none';
  el.style.transform = `translate(${LANE_X[lane]}px, ${HIDDEN_Y}px)`;
  $('#cars').appendChild(el);
  el.getBoundingClientRect(); // commit the start position before animating
  el.style.transition = '';
  return { el, lane, trip: null, arrive: 0, leaving: false };
}

function pace(lane) {
  const queued = lanes[lane].cars.length;
  return queued > 8 ? 0.4 : queued > 3 ? 0.65 : 1;
}

function layout(lane) {
  const p = pace(lane);
  lanes[lane].cars.forEach((car, i) => {
    const y = i < VISIBLE ? STOP_Y + i * GAP : HIDDEN_Y;
    if (car.y === y) return;
    car.y = y;
    car.el.style.setProperty('--move', `${0.55 * p}s`);
    car.el.style.transform = `translate(${LANE_X[lane]}px, ${y}px)`;
    car.arrive = performance.now() + 560 * p;
  });
  const waiting = Math.max(0, lanes[lane].cars.length - VISIBLE);
  const badge = $(`#waiting-${lane}`);
  badge.style.display = waiting ? '' : 'none';
  $('text', badge).textContent = `+${waiting} waiting`;
}

async function pump(lane) {
  const L = lanes[lane];
  if (L.busy) return;
  L.busy = true;
  while (L.cars.length && L.cars[0].trip) {
    const car = L.cars[0];
    const p = pace(lane);
    const wait = car.arrive - performance.now();
    if (wait > 0) await sleep(wait);
    await atTheBarrier(lane, car, p);
    L.cars.shift();
    layout(lane);
  }
  L.busy = false;
}

// The moment a car reaches the barrier: the booth's answer becomes visible.
async function atTheBarrier(lane, car, p) {
  const { trip } = car;
  const v = VERDICTS[trip.verdict] || VERDICTS.closed;
  const x = LANE_X[lane];
  $(`#light-${lane}`).dataset.state = v.light;
  $(`.tb-lanesign[data-lane="${lane}"] .tb-lanesign__lamp`).dataset.state = v.lamp;
  showBubble(lane, trip);
  addTrip(trip);
  ledFromTrip(lane, trip);

  if (trip.verdict === 'paid') {
    openBarrier(lane, p);
    await sleep(240 * p);
    car.leaving = true;
    car.el.classList.add('is-leaving');
    car.el.style.setProperty('--move', `${0.7 * p}s`);
    car.el.style.transform = `translate(${x}px, -160px)`;
    setTimeout(() => car.el.remove(), 900 * p + 200);
    await sleep(300 * p);
  } else {
    car.el.classList.add(trip.verdict === 'slow-down' ? 'is-hazard' : 'is-stopped');
    await sleep(600 * p);
    car.leaving = true;
    car.el.classList.add('is-refused');
    car.el.style.setProperty('--move', `${0.7 * p}s`);
    car.el.style.transform = `translate(${x + 58}px, ${STOP_Y + 80}px) rotate(30deg)`;
    car.el.style.opacity = '0';
    setTimeout(() => car.el.remove(), 900);
    await sleep(260 * p);
  }
}

function openBarrier(lane, p) {
  const barrier = $(`#barrier-${lane}`);
  barrier.classList.add('is-up');
  clearTimeout(lanes[lane].barrierTimer);
  lanes[lane].barrierTimer = setTimeout(() => barrier.classList.remove('is-up'), 800 * p + 250);
}

function showBubble(lane, trip) {
  const bubble = $(`#bubble-${lane}`);
  const v = VERDICTS[trip.verdict] || VERDICTS.closed;
  bubble.dataset.verdict = trip.verdict;
  $('.bubble__code', bubble).textContent = trip.status || 'ERR';
  $('.bubble__label', bubble).textContent = v.label;
  bubble.classList.add('is-on');
  clearTimeout(lanes[lane].bubbleTimer);
  lanes[lane].bubbleTimer = setTimeout(() => {
    bubble.classList.remove('is-on');
    $(`#light-${lane}`).dataset.state = '';
  }, 1600);
}

function buildPlazaOverlays() {
  for (const [lane, x] of Object.entries(LANE_X)) {
    const bubble = document.createElementNS(NS, 'g');
    bubble.setAttribute('class', 'bubble');
    bubble.id = `bubble-${lane}`;
    bubble.setAttribute('transform', `translate(${x} 142)`);
    bubble.innerHTML = '<rect x="-58" y="-27" width="116" height="50" rx="7"/><text class="bubble__code" y="1">200</text><text class="bubble__label" y="16">PAID</text>';
    $('#bubbles').appendChild(bubble);

    const waiting = document.createElementNS(NS, 'g');
    waiting.id = `waiting-${lane}`;
    waiting.setAttribute('transform', `translate(${x} 414)`);
    waiting.style.display = 'none';
    waiting.innerHTML = '<rect x="-56" y="-16" width="112" height="28" rx="14"/><text y="4">+0 waiting</text>';
    $('#waiting').appendChild(waiting);
  }
}

// ---------- Convoys ----------

async function send(lane, count) {
  if (state.inflight[lane]) return;
  state.inflight[lane] = true;
  setLaneButtons(lane, true);
  setStatus('');
  const cars = [];
  for (let i = 0; i < count; i++) {
    const car = makeCar(lane);
    cars.push(car);
    lanes[lane].cars.push(car);
  }
  layout(lane);

  let answered = 0;
  const tally = {};
  try {
    const res = await fetch('/api/drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lane, count, exit: state.exit }),
    });
    if (!res.ok || !res.body) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `The app answered ${res.status}.`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.type === 'trip' && cars[answered]) {
          message.receivedAt = Date.now(); // the minute window counts from the booth's answer
          cars[answered++].trip = message;
          tally[message.verdict] = (tally[message.verdict] || 0) + 1;
          pump(lane);
        } else if (message.type === 'summary') {
          renderLatency(message.latency);
          $('#latency-refused').textContent = message.refused === null ? ''
            : `Refused cars got their answer from Otoroshi in ${formatMs(message.refused)}: the road never saw them.`;
        }
      }
    }
    setStatus(convoySummary(lane, count, tally));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    // Cars that never got an answer leave the queue quietly.
    for (const car of cars) {
      if (car.trip) continue;
      car.el.remove();
      lanes[lane].cars = lanes[lane].cars.filter((c) => c !== car);
    }
    layout(lane);
    state.inflight[lane] = false;
    setLaneButtons(lane, false);
    refreshQuotas();
  }
}

function convoySummary(lane, count, tally) {
  const parts = Object.entries(tally).map(([verdict, n]) => `${n} ${(VERDICTS[verdict] || VERDICTS.closed).words}`);
  return `${LANE_NAMES[lane]} lane, ${count} ${count > 1 ? 'cars' : 'car'}: ${parts.join(', ')}.`;
}

function setLaneButtons(lane, disabled) {
  for (const button of document.querySelectorAll(`.tb-ctl[data-lane="${lane}"] button`)) button.disabled = disabled;
}

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

// ---------- Gantry LEDs ----------

function setLed(lane, which, value, allowed) {
  const el = $(`.tb-lanesign[data-lane="${lane}"] [data-led="${which}"]`);
  if (!el) return;
  const text = formatNumber(value);
  if (el.textContent !== text) {
    el.textContent = text;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  }
  el.classList.toggle('is-empty', Number(value) === 0);
  if (allowed) el.title = `${formatNumber(value)} of ${formatNumber(allowed)}`;
}

// "Left today" comes from Otoroshi's own response header; "this minute" from
// the window the app follows (see src/windows.js).
function ledFromTrip(lane, trip) {
  if (lane === 'none') return;
  const day = trip.headers['otoroshi-daily-calls-remaining'];
  if (day !== undefined) setLed(lane, 'day', day);
  if (trip.window) setWindow(lane, trip.window.left, trip.window.allowed, trip.window.resetsInMs, trip.receivedAt);
}

function setWindow(lane, left, allowed, resetsInMs, since = Date.now()) {
  state.windows[lane] = { left, allowed, resetAt: resetsInMs ? since + resetsInMs : 0 };
  setLed(lane, 'window', left, allowed);
  tickWindows();
}

// Counts down to the end of each minute window, then shows the full quota again.
function tickWindows() {
  for (const [lane, w] of Object.entries(state.windows)) {
    const label = $(`.tb-lanesign[data-lane="${lane}"] [data-led-label="window"]`);
    if (!label) continue;
    const seconds = Math.ceil((w.resetAt - Date.now()) / 1000);
    if (w.resetAt && seconds <= 0) {
      w.resetAt = 0;
      w.left = w.allowed;
      setLed(lane, 'window', w.left, w.allowed);
    }
    label.textContent = w.resetAt ? `left, refill in ${seconds} s` : 'left this minute';
  }
}

function renderQuotas(quotas) {
  if (!quotas) return;
  for (const [lane, q] of Object.entries(quotas)) {
    setLed(lane, 'day', q.dailyLeft, q.dailyAllowed);
    setWindow(lane, q.windowLeft, q.windowAllowed, q.windowResetsInMs);
  }
}

async function refreshQuotas() {
  try {
    const res = await fetch('/api/quotas');
    if (res.ok) renderQuotas(await res.json());
  } catch { /* the next poll will try again */ }
}

// ---------- Receipts ----------

function addTrip(trip) {
  state.trips.unshift(trip);
  state.trips.length = Math.min(state.trips.length, 60);
  renderTicket(trip, true);
  const list = $('#journal');
  list.prepend(journalRow(trip));
  while (list.children.length > 60) list.lastElementChild.remove();
}

function journalRow(trip) {
  const li = document.createElement('li');
  const time = new Date(trip.at).toLocaleTimeString('en-GB');
  li.innerHTML = `<button type="button" data-verdict="${escapeHtml(trip.verdict)}" aria-label="Show receipt ${trip.n}">
    <span>#${String(trip.n).padStart(4, '0')}</span>
    <span>${escapeHtml(LANE_SHORT[trip.lane])} ${escapeHtml(time)}</span>
    <span class="j-code">${trip.status || 'ERR'}</span>
    <span class="j-ms">${formatMs(trip.ms)}</span></button>`;
  li.firstElementChild.addEventListener('click', () => renderTicket(trip, true));
  return li;
}

function renderTicket(trip, animate) {
  const el = $('#ticket');
  if (!trip) {
    el.innerHTML = '<p class="tb-ticket__empty">No car yet.<br>Send one from a lane below the plaza.</p>';
    return;
  }
  state.current = trip;
  for (const b of document.querySelectorAll('#journal button')) b.classList.toggle('is-current', b.getAttribute('aria-label') === `Show receipt ${trip.n}`);
  const v = VERDICTS[trip.verdict] || VERDICTS.closed;
  const when = new Date(trip.at);
  const badgeShown = trip.badge === 'forged' ? 'forged Gold badge' : trip.badge === 'none' ? 'none' : LANE_NAMES[trip.lane];
  const headers = Object.entries(trip.headers || {}).map(([name, value]) =>
    `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}${/latency$/.test(name) ? ' ms' : ''}</dd></div>`).join('');
  const stamp = trip.road && trip.road.stamp;
  const road = trip.road && trip.road.town
    ? `<p><b>${escapeHtml(trip.road.town)}</b>, ${escapeHtml(trip.road.weather)}, ${escapeHtml(trip.road.km)} km</p><p class="tb-ticket__fortune">“${escapeHtml(trip.road.fortune)}”</p>`
    : '';

  el.innerHTML = `
    <div class="tb-ticket__brand">THE TOLL BOOTH</div>
    <div class="tb-ticket__sub">Otoroshi gateway, Paris plaza</div>
    <hr>
    <div class="tb-ticket__row"><span>Ticket</span><span>#${String(trip.n).padStart(4, '0')}</span></div>
    <div class="tb-ticket__row"><span>Date</span><span>${escapeHtml(when.toLocaleDateString('en-GB'))} ${escapeHtml(when.toLocaleTimeString('en-GB'))}</span></div>
    <div class="tb-ticket__row"><span>Lane</span><span>${escapeHtml(LANE_NAMES[trip.lane])}</span></div>
    <div class="tb-ticket__row"><span>Badge shown</span><span>${escapeHtml(badgeShown)}</span></div>
    <div class="tb-ticket__row"><span>Request</span><span>${escapeHtml(trip.method)} ${escapeHtml(trip.path)}</span></div>
    <hr>
    <div class="tb-ticket__status"><b>${trip.status || 'ERR'}</b><span class="tb-ticket__stampbox" data-verdict="${escapeHtml(trip.verdict)}">${v.label}</span></div>
    ${trip.error ? `<p>Otoroshi says: ${escapeHtml(trip.error)}</p>` : ''}
    <hr>
    <p class="tb-ticket__label">Response headers added by Otoroshi</p>
    ${headers ? `<dl class="tb-ticket__hdr">${headers}</dl>` : '<p>None.</p>'}
    <hr>
    <p class="tb-ticket__label">Stamp the road received</p>
    ${stamp ? `<dl class="tb-ticket__hdr"><div><dt>X-Toll-Badge</dt><dd>${escapeHtml(stamp.badge)}</dd></div><div><dt>X-Toll-Lane</dt><dd>${escapeHtml(stamp.lane)}</dd></div><div><dt>X-Toll-Booth-Token</dt><dd>checked</dd></div></dl>` : '<p>None: the car never reached the road.</p>'}
    <hr>
    <div class="tb-ticket__row"><span>Total via the booth</span><span><b>${formatMs(trip.ms)}</b></span></div>
    ${road ? `<hr>${road}` : ''}
    <p class="tb-ticket__thanks">${escapeHtml(THANKS[trip.verdict] || THANKS.closed)}</p>`;

  // Print with the paper animation, unless receipts are coming too fast to read.
  const now = performance.now();
  if (animate && now - lastPrint > 900) {
    el.classList.remove('is-printing');
    void el.offsetWidth;
    el.classList.add('is-printing');
  }
  lastPrint = now;
}
let lastPrint = 0;

// ---------- Latency, rules, platform ----------

function renderLatency(latency) {
  if (!latency) return;
  const { gateway, proxy, direct, samples } = latency;
  const max = Math.max(gateway || 0, direct || 0, 1) * 1.08;
  const width = (ms) => `${Math.min(100, ((ms || 0) / max) * 100)}%`;
  $('[data-bar="gateway"]').style.width = width(gateway);
  $('[data-bar="proxy"]').style.width = width(proxy);
  $('[data-bar="proxy-only"]').style.width = width(proxy);
  $('[data-bar="direct"]').style.width = width(direct);
  $('[data-value="gateway"]').textContent = formatMs(gateway);
  $('[data-value="proxy"]').textContent = formatMs(proxy);
  $('[data-value="direct"]').textContent = formatMs(direct);
  $('#latency-caption').textContent = `Median of the last paid convoy (${samples} ${samples > 1 ? 'cars' : 'car'} through the booth, 3 straight to the road), measured from this app. "Otoroshi itself" is the otoroshi-proxy-latency header. The rest is the extra hop: app to Otoroshi to road, through the load balancers.`;
}

function highlightJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2))
    .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="k">$1</span>$2')
    .replace(/:\s(&quot;.*?&quot;)/g, ': <span class="s">$1</span>')
    .replace(/:\s(-?\d+(?:\.\d+)?|true|false|null)/g, ': <span class="n">$1</span>');
}

function renderRules(live, booth) {
  if (!live) return;
  const { route, keys } = live;
  const target = route.backend.targets[0];
  $('#route-line').innerHTML = `GET <b>${escapeHtml(route.frontend.domains[0])}/*</b> to <b>${escapeHtml(target.hostname)}:${target.port}</b>${target.tls ? ' over TLS' : ''}`;
  $('#steps').innerHTML = route.plugins.map(({ plugin, config }) => {
    const [title, text] = PLUGIN_TEXT[plugin] || [plugin, ''];
    const hasConfig = config && Object.keys(config).length;
    return `<li class="tb-step"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><code class="tb-step__id">${escapeHtml(plugin)}</code></div>
      <pre class="cc-code">${hasConfig ? highlightJson(config) : '<span class="c">// no configuration</span>'}</pre></li>`;
  }).join('');
  $('#keys').innerHTML = Object.values(keys).map((key) => `<pre class="cc-code">${highlightJson(key)}</pre>`).join('');
  $('#route-json').innerHTML = highlightJson(route);
  $('#try').innerHTML = `<span class="c"># through the booth, without a badge: 400</span>
curl -i ${escapeHtml(booth.gatewayUrl)}/road/fortune
<span class="c"># the road itself, skipping the booth: 403</span>
curl -i ${escapeHtml(booth.roadUrl)}/road/fortune`;
}

function renderPlatform(platform) {
  const labels = {
    CC_APP_NAME: 'Application', APP_ID: 'App ID', INSTANCE_NUMBER: 'Instance', INSTANCE_TYPE: 'Instance type',
    CC_PRETTY_INSTANCE_NAME: 'Instance name', CC_COMMIT_ID: 'Commit', CC_DEPLOYMENT_ID: 'Deployment',
  };
  $('#platform').innerHTML = Object.entries(labels).map(([key, label]) => {
    const value = platform[key];
    return `<div><dt>${label}</dt><dd class="${value ? '' : 'is-empty'}">${escapeHtml(value || 'not set (local run)')}</dd></div>`;
  }).join('');
}

// ---------- Boot ----------

async function loadState() {
  const res = await fetch('/api/state');
  const s = await res.json();
  renderPlatform(s.platform);
  renderQuotas(s.quotas);
  renderRules(s.live, s.booth);
  renderLatency(s.lastLatency);
  for (const [lane, info] of Object.entries(s.lanes)) {
    const rule = $(`.tb-lanesign[data-lane="${lane}"] [data-rule]`);
    if (rule) rule.textContent = `${formatNumber(info.window)} a minute, ${formatNumber(info.daily)} a day`;
  }
  if (!state.trips.length && s.trips.length) {
    state.trips = s.trips.slice();
    $('#journal').replaceChildren(...s.trips.map(journalRow));
    renderTicket(s.trips[0], false);
  } else if (!s.trips.length) {
    renderTicket(null);
  }
  const ready = s.booth.ready;
  for (const button of document.querySelectorAll('.tb-ctl button, #reset')) button.disabled = !ready;
  if (!ready) {
    setStatus(s.booth.error || 'The booth is opening. This page retries every 5 seconds.', Boolean(s.booth.error));
    setTimeout(loadState, 5000);
  } else if (s.booth.error) {
    setStatus(s.booth.error, true);
  }
}

function wireControls() {
  for (const group of document.querySelectorAll('.tb-ctl')) {
    for (const button of group.querySelectorAll('button')) {
      button.addEventListener('click', () => send(group.dataset.lane, Number(button.dataset.count)));
    }
  }
  for (const button of document.querySelectorAll('.tb-exit')) {
    button.addEventListener('click', () => {
      state.exit = button.dataset.exit;
      for (const b of document.querySelectorAll('.tb-exit')) b.setAttribute('aria-pressed', String(b === button));
    });
  }
  $('#reset').addEventListener('click', async () => {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (!res.ok) return setStatus('The quotas could not be reset.', true);
    renderQuotas(await res.json());
    for (const lamp of document.querySelectorAll('.tb-lanesign__lamp')) lamp.dataset.state = 'open';
    setStatus('Daily quotas reset through the admin API (DELETE /api/apikeys/:id/quotas). The minute window refills on its own.');
  });
  setInterval(tickWindows, 1000);
  // Other visitors drive cars too: read the counters again now and then.
  setInterval(() => {
    if (!document.hidden && !Object.values(state.inflight).some(Boolean)) refreshQuotas();
  }, 8000);
}

buildPlazaOverlays();
wireControls();
loadState().catch(() => setStatus('The app did not answer. Reload the page in a moment.', true));
