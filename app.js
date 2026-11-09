(function () {
  'use strict';

  // ---------- constants ----------
  var KEY = 'sagcalc.v2';
  var OLD_KEY = 'sagcalc.v1';
  var MM_PER_IN = 25.4;
  var EPS = 1e-6;
  var TOL_MM = 3; // "close enough" band either side of the target
  var ENDS = ['rear', 'front'];
  var NAMES = { rear: 'Rear', front: 'Front' };

  var TYPES = [
    ['mx', 'MX'],
    ['enduro', 'Hard enduro'],
    ['dualsport', 'Dual sport'],
    ['adventure', 'Adventure'],
    ['street', 'Street']
  ];

  // r = rider sag % range, f = free sag % range
  var RANGES = {
    rear: {
      mx:        { r: [30, 35], f: [10, 13] },
      enduro:    { r: [33, 35], f: [12, 15] },
      dualsport: { r: [30, 33], f: [10, 13] },
      adventure: { r: [28, 33], f: [10, 15] },
      street:    { r: [28, 35], f: [3, 8] }
    },
    front: {
      mx:        { r: [22, 25], f: [7, 10] },
      enduro:    { r: [25, 30], f: [10, 13] },
      dualsport: { r: [25, 30], f: [10, 13] },
      adventure: { r: [25, 30], f: [10, 15] },
      street:    { r: [28, 33], f: [15, 20] }
    }
  };

  var FIT_TEXT = 'Longer than fully extended. Check the mm / in switch.';

  // ---------- helpers ----------
  function ok(v) { return typeof v === 'number' && isFinite(v); }
  function numOrNull(v) { return ok(v) ? v : null; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var $ = function (id) { return document.getElementById(id); };
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  // ---------- state ----------
  function newEnd() { return { travel: null, extended: null, reading: null, free: null }; }
  function freshState() {
    return { units: 'mm', fieldUnits: {}, which: 'both', preset: 'dualsport', custom: null, rear: newEnd(), front: newEnd() };
  }

  function normalize(s) {
    var o = freshState();
    if (s.units === 'in') o.units = 'in';
    if (s.fieldUnits && typeof s.fieldUnits === 'object') {
      Object.keys(s.fieldUnits).forEach(function (k) {
        if (s.fieldUnits[k] === 'mm' || s.fieldUnits[k] === 'in') o.fieldUnits[k] = s.fieldUnits[k];
      });
    }
    if (['both', 'rear', 'front'].indexOf(s.which) >= 0) o.which = s.which;
    if (s.preset === 'custom' || RANGES.rear[s.preset]) o.preset = s.preset;
    if (s.custom && typeof s.custom === 'object') {
      o.custom = {};
      ENDS.forEach(function (e) {
        var c = s.custom[e] || {};
        o.custom[e] = { rider: numOrNull(c.rider), lo: numOrNull(c.lo), hi: numOrNull(c.hi) };
      });
    }
    if (o.preset === 'custom' && !o.custom) o.preset = 'dualsport';
    ENDS.forEach(function (e) {
      var src = s[e] && typeof s[e] === 'object' ? s[e] : {};
      o[e].travel = numOrNull(src.travel);
      o[e].extended = numOrNull(src.extended);
      o[e].reading = numOrNull(src.reading);
      o[e].free = numOrNull(src.free);
    });
    return o;
  }

  // The first version kept several bikes; carry the first one's setup over.
  function fromV1(s) {
    var b = s && Array.isArray(s.bikes) && s.bikes[0];
    if (!b) return null;
    return { units: s.units, preset: b.rear && b.rear.type, rear: b.rear, front: b.front };
  }

  var storageOk = true;
  try {
    localStorage.setItem('__sagcalc_test', '1');
    localStorage.removeItem('__sagcalc_test');
  } catch (e) { storageOk = false; }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw) || {});
      var old = localStorage.getItem(OLD_KEY);
      if (old) { var v = fromV1(JSON.parse(old)); if (v) return normalize(v); }
    } catch (e) { /* fall through */ }
    return freshState();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { storageOk = false; showStorageWarn(); }
  }

  var state = load();
  function shown(end) { return state.which === 'both' || state.which === end; }

  // ---------- units ----------
  // state.units: results, and the default for any box the user hasn't switched.
  // state.fieldUnits['extended.rear'] etc: that one box's own unit.
  function tUnit() { return state.units; }
  // Readings and targets follow that end's fully extended box: you measure and aim in one unit.
  function uOf(key) {
    if (state.fieldUnits[key]) return state.fieldUnits[key];
    var parts = key.split('.');
    if (parts[0] === 'reading' || parts[0] === 'free') return uOf('extended.' + parts[1]);
    return state.units;
  }

  // Inches read like a tape: nearest 1/16, reduced (21 3/8).
  function fmtIn(x) {
    var neg = x < 0, s16 = Math.round(Math.abs(x) * 16);
    var whole = Math.floor(s16 / 16), n = s16 % 16, d = 16;
    if (!n) return (neg && whole ? '-' : '') + whole;
    while (n % 2 === 0) { n /= 2; d /= 2; }
    return (neg ? '-' : '') + (whole ? whole + ' ' : '') + n + '/' + d;
  }
  function fmtNum(mm, u) {
    if (!ok(mm)) return '';
    u = u || tUnit();
    if (u === 'in') return fmtIn(mm / MM_PER_IN);
    var n = parseFloat(mm.toFixed(1));
    return (n === 0 ? 0 : n).toString();
  }
  function fmtLen(mm, u) { return fmtNum(mm, u) + ' ' + (u || tUnit()); }

  // Accepts 21, 21.5, 21,5, 21 5/16, 21-5/16, 5/16, with or without "in" / " / mm.
  function parseNum(str) {
    var s = String(str == null ? '' : str).trim()
      .replace(/["”″]/g, '').replace(/(inches|inch|in|mm)\.?$/i, '').trim()
      .replace(/\s*\/\s*/g, '/').replace(',', '.');
    if (s === '') return null;
    var m = s.match(/^(?:(\d+(?:\.\d+)?)[\s-]+)?(\d+)\/(\d+)$/);
    if (m) {
      var d = Number(m[3]);
      return d ? (m[1] ? Number(m[1]) : 0) + Number(m[2]) / d : null;
    }
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function boxVal(el) {
    var v = parseNum(el.value);
    return v == null ? null : (uOf(el.dataset.u) === 'in' ? v * MM_PER_IN : v);
  }
  function unreadable(el) { return el.value.trim() !== '' && boxVal(el) == null; }

  // ---------- math ----------
  // Sag = fully extended − reading with you on it  (Race Tech: L1 − L2)
  // so the reading to aim for = fully extended − (travel × sag %).
  function pcts(end) {
    if (state.preset === 'custom') {
      var c = state.custom[end];
      return { rider: c.rider, lo: c.lo, hi: c.hi };
    }
    var r = RANGES[end][state.preset];
    return { rider: (r.r[0] + r.r[1]) / 2, lo: r.f[0], hi: r.f[1] };
  }

  function calc(end) {
    var s = state[end], p = pcts(end), T = s.travel, E = s.extended, o = { p: p };
    if (ok(T) && ok(p.rider)) o.rs = T * p.rider / 100;
    if (ok(o.rs) && ok(E)) o.target = E - o.rs;
    if (ok(T) && ok(E) && ok(p.lo) && ok(p.hi)) {
      o.lo = Math.min(p.lo, p.hi);
      o.hi = Math.max(p.lo, p.hi);
      o.t1 = E - T * o.lo / 100; // least free sag (highest reading)
      o.t2 = E - T * o.hi / 100; // most free sag (lowest reading)
    }
    return o;
  }

  function riderVerdict(r, target, u) {
    var off = r - target;
    if (off < -TOL_MM - EPS) return { cls: 'adjust', icon: '▲', head: 'ADD preload', how: 'tighten', sub: 'Sitting too low by ' + fmtLen(-off, u) + '.' };
    if (off > TOL_MM + EPS) return { cls: 'adjust', icon: '▼', head: 'REDUCE preload', how: 'loosen', sub: 'Sitting too high by ' + fmtLen(off, u) + '.' };
    return { cls: 'good', icon: '✓', head: 'Call it good', how: '', sub: 'Within ' + fmtLen(TOL_MM, u) + '.' };
  }

  function freeVerdict(r, c) {
    if (r > c.t1 + EPS) return { cls: 'adjust', head: 'Stiffer spring',
      sub: 'Too little free sag: spring too light for your weight. Until then, keep rider sag right and ride it.' };
    if (r < c.t2 - EPS) return { cls: 'adjust', head: 'Softer spring',
      sub: 'Too much free sag: spring too heavy for your weight. Until then, set preload for rider sag and ride it.' };
    return { cls: 'good', head: "Spring's right for you.", sub: '' };
  }

  // ---------- markup ----------
  function unitBtn(key) { return '<button type="button" class="u" data-act="box-unit" data-u="' + key + '"></button>'; }
  function box(id, label, end, f) {
    var key = f + '.' + end;
    return '<div class="field">' +
      '<label class="lbl sm" for="' + id + '">' + label + '</label>' +
      '<div class="inp"><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" data-end="' + end + '" data-f="' + f + '" data-u="' + key + '">' + unitBtn(key) + '</div></div>';
  }
  function head(n, id, title) {
    return '<div class="stage-head"><span class="step" aria-hidden="true">' + n + '</span><h2 id="' + id + '" class="card-h">' + title + '</h2></div>';
  }

  function presetRowsHTML() {
    function cell(end, t) {
      var g = RANGES[end][t];
      return '<span class="pc"><b>' + g.r[0] + '–' + g.r[1] + '%</b><small>free ' + g.f[0] + '–' + g.f[1] + '%</small></span>';
    }
    function aria(t, name) {
      var r = RANGES.rear[t], f = RANGES.front[t];
      return name + '. Rear: rider sag ' + r.r[0] + ' to ' + r.r[1] + '%, free sag ' + r.f[0] + ' to ' + r.f[1] +
        '%. Front: rider sag ' + f.r[0] + ' to ' + f.r[1] + '%, free sag ' + f.f[0] + ' to ' + f.f[1] + '%.';
    }
    return TYPES.map(function (t) {
      return '<label class="prow"><span class="pn"><input type="radio" name="preset" value="' + t[0] + '" aria-label="' + aria(t[0], t[1]) + '">' + t[1] + '</span>' +
        cell('rear', t[0]) + cell('front', t[0]) + '</label>';
    }).join('') +
      '<label class="prow"><span class="pn"><input type="radio" name="preset" value="custom">Custom</span><span class="pc wide"><small>Your own numbers</small></span></label>';
  }

  function flowHTML() {
    return '' +
      '<section class="card" aria-labelledby="s2-h">' +
        head(2, 's2-h', 'Fully extended') +
        '<p class="hint">Wheel off the ground. Axle to a fixed mark above it. Use the same two points from here on.</p>' +
        '<div class="pair">' +
          '<div data-show="rear">' + box('rear-ext', 'Rear', 'rear', 'extended') + '</div>' +
          '<div data-show="front">' + box('front-ext', 'Front', 'front', 'extended') + '</div>' +
        '</div>' +
      '</section>' +

      '<section class="card" aria-labelledby="s3-h">' +
        head(3, 's3-h', 'Aim for') +
        ENDS.map(function (end) {
          return '<fieldset class="endset" data-show="' + end + '"><legend class="end-lbl">' + NAMES[end] + '</legend>' +
            '<div class="aim-row">' +
              '<div class="aim" id="' + end + '-aim"></div>' +
              box(end + '-reading', 'Your reading', end, 'reading') +
            '</div>' +
            '<div id="' + end + '-verdict" class="verdict-slot"></div>' +
            '<div class="aim-row">' +
              '<div class="aim free" id="' + end + '-free-aim"></div>' +
              box(end + '-free', 'Your reading', end, 'free') +
            '</div>' +
            '<div id="' + end + '-free-verdict" class="verdict-slot"></div>' +
          '</fieldset>';
        }).join('') +
      '</section>';
  }

  // ---------- rendering ----------
  function fillInputs() {
    each('input[data-f]', function (el) { el.value = fmtNum(state[el.dataset.end][el.dataset.f], uOf(el.dataset.u)); });
    each('[data-custom]', function (el) {
      var parts = el.dataset.custom.split('.');
      var v = state.custom && state.custom[parts[0]][parts[1]];
      el.value = ok(v) ? String(v) : '';
    });
  }

  function renderUnits() {
    each('[data-act="unit"]', function (b) { b.setAttribute('aria-pressed', String(b.dataset.unit === state.units)); });
    each('button.u', function (b) {
      var u = uOf(b.dataset.u);
      b.innerHTML = '<span' + (u === 'mm' ? ' class="on"' : '') + '>mm</span><span' + (u === 'in' ? ' class="on"' : '') + '>in</span>';
      b.setAttribute('aria-label', 'Units for this box: ' + (u === 'in' ? 'inches' : 'millimetres') + '. Switch to ' + (u === 'in' ? 'millimetres' : 'inches'));
    });
    // inch boxes need a keyboard with space and "/" for tape fractions
    each('input[data-u]', function (el) { el.inputMode = uOf(el.dataset.u) === 'in' ? 'text' : 'decimal'; });
  }

  function renderWhich() {
    each('[data-act="which"]', function (b) { b.setAttribute('aria-pressed', String(b.dataset.which === state.which)); });
    each('[data-show]', function (el) { el.hidden = !shown(el.dataset.show); });
  }

  function renderPreset() {
    each('input[name="preset"]', function (r) { r.checked = r.value === state.preset; });
    $('custom').hidden = state.preset !== 'custom';
  }

  function missing(end, s, c) {
    if (!ok(s.travel)) return 'Enter ' + end + ' travel in step 1.';
    if (!ok(c.p.rider)) return 'Enter a rider sag % in step 1.';
    if (!ok(s.extended)) return 'Enter fully extended in step 2.';
    return '';
  }

  function update(end) {
    var s = state[end], c = calc(end), need = missing(end, s, c);
    var aim = $(end + '-aim'), faim = $(end + '-free-aim');
    var v = $(end + '-verdict'), fv = $(end + '-free-verdict');

    if (need) {
      aim.className = 'aim empty';
      aim.innerHTML = '<span class="aim-k">With you on it</span><span class="aim-need">' + esc(need) + '</span>';
      faim.className = 'aim free empty';
      faim.innerHTML = '<span class="aim-k">Bike alone</span><span class="aim-need">—</span>';
      v.innerHTML = ''; fv.innerHTML = '';
      return;
    }

    // with rider
    var au = uOf('extended.' + end);
    aim.className = 'aim';
    aim.innerHTML = '<span class="aim-k">With you on it</span>' +
      '<span class="aim-v">' + esc(fmtNum(c.target, au)) + ' <small>' + au + '</small></span>' +
      '<span class="aim-s">' + esc(fmtNum(s.extended, au)) + ' − ' + esc(fmtNum(c.rs, au)) + ' sag (' + c.p.rider + '%)</span>';

    var el = $(end + '-reading');
    if (unreadable(el)) {
      v.innerHTML = '<p class="gap">Can’t read that. Try 21.5 or 21 1/2.</p>';
    } else if (c.target <= 0) {
      v.innerHTML = '<p class="gap">Fully extended is less than the sag. Check the mm / in switch.</p>';
    } else if (!ok(s.reading)) {
      v.innerHTML = '';
    } else {
      var rv = riderVerdict(s.reading, c.target, au);
      v.innerHTML = '<div class="verdict v-' + rv.cls + '">' +
        '<p class="v-head"><span class="v-icon" aria-hidden="true">' + rv.icon + '</span>' + rv.head +
          (rv.how ? ' <span class="v-how">(' + rv.how + ')</span>' : '') + '</p>' +
        '<p class="v-sub">' + esc(rv.sub) + '</p></div>' +
        (s.reading > s.extended + 2 ? '<p class="gap">' + FIT_TEXT + '</p>' : '');
    }

    // bike alone
    if (!ok(c.t1)) {
      faim.className = 'aim free empty';
      faim.innerHTML = '<span class="aim-k">Bike alone</span><span class="aim-need">Enter free sag % in step 1.</span>';
      fv.innerHTML = '';
      return;
    }
    var fu = au;
    faim.className = 'aim free';
    faim.innerHTML = '<span class="aim-k">Bike alone</span>' +
      '<span class="aim-v">' + esc(fmtNum(c.t2, fu)) + '–' + esc(fmtNum(c.t1, fu)) + ' <small>' + fu + '</small></span>' +
      '<span class="aim-s">' + c.lo + '–' + c.hi + '% free sag</span>';

    var fel = $(end + '-free');
    if (unreadable(fel)) {
      fv.innerHTML = '<p class="gap">Can’t read that. Try 21.5 or 21 1/2.</p>';
    } else if (!ok(s.free)) {
      fv.innerHTML = '';
    } else {
      var f = freeVerdict(s.free, c);
      fv.innerHTML = '<div class="verdict small v-' + f.cls + '"><p class="v-head">' + esc(f.head) + '</p>' +
        (f.sub ? '<p class="v-sub">' + esc(f.sub) + '</p>' : '') + '</div>' +
        (s.free > s.extended + 2 ? '<p class="gap">' + FIT_TEXT + '</p>' : '');
    }
  }

  function renderAll() {
    renderUnits();
    renderWhich();
    renderPreset();
    fillInputs();
    ENDS.forEach(update);
  }

  function showStorageWarn() { if (!storageOk) $('storage-warn').hidden = false; }

  // ---------- events ----------
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.custom) {
      var parts = el.dataset.custom.split('.');
      state.custom[parts[0]][parts[1]] = parseNum(el.value);
      save();
      update(parts[0]);
      return;
    }
    var end = el.dataset.end, f = el.dataset.f;
    if (!end || !f) return;
    state[end][f] = boxVal(el);
    save();
    update(end);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.name !== 'preset') return;
    if (el.value === 'custom' && !state.custom) {
      // start custom from whatever was selected
      state.custom = {};
      ENDS.forEach(function (end) { var p = pcts(end); state.custom[end] = { rider: p.rider, lo: p.lo, hi: p.hi }; });
    }
    state.preset = el.value;
    save();
    renderPreset();
    fillInputs();
    ENDS.forEach(update);
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'unit':
        if (state.units === btn.dataset.unit) return;
        state.units = btn.dataset.unit;
        save();
        renderUnits();
        fillInputs();
        ENDS.forEach(update);
        break;
      case 'box-unit':
        // Keep what's typed and read it in the new unit (24 mm -> 24 in, not 0.94 in).
        var key = btn.dataset.u;
        state.fieldUnits[key] = uOf(key) === 'mm' ? 'in' : 'mm';
        save();
        renderUnits();
        btn.parentNode.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
        // Reading boxes that follow this end's fully extended unit re-read what's typed, too.
        if (key.indexOf('extended.') === 0) {
          var e2 = key.split('.')[1];
          ['reading', 'free'].forEach(function (f) {
            if (!state.fieldUnits[f + '.' + e2]) $(e2 + '-' + f).dispatchEvent(new Event('input', { bubbles: true }));
          });
        }
        break;
      case 'which':
        state.which = btn.dataset.which;
        save();
        renderWhich();
        break;
    }
  });

  // ---------- boot ----------
  $('preset-rows').innerHTML = presetRowsHTML();
  $('flow').innerHTML = flowHTML();
  showStorageWarn();
  renderAll();
})();
