(function () {
  'use strict';

  // ---------- constants ----------
  var KEY = 'sagcalc.v2';
  var OLD_KEY = 'sagcalc.v1';
  var MM_PER_IN = 25.4;
  var EPS = 1e-6;
  var GAP_WARN_MM = 5;
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

  function unitBtn(key) { return '<button type="button" class="u" data-act="box-unit" data-u="' + key + '"></button>'; }
  var GAP_TEXT = 'Big gap between readings: something may be binding (linkage, fork seals).';

  // ---------- helpers ----------
  function ok(v) { return typeof v === 'number' && isFinite(v); }
  function numOrNull(v) { return ok(v) ? v : null; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var $ = function (id) { return document.getElementById(id); };
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  // ---------- state ----------
  function newEnd() {
    return { travel: null, extended: null, log: [], freeA: null, freeB: null, normal: '', loaded: '' };
  }
  function freshState() {
    return { units: 'mm', fieldUnits: {}, which: 'both', preset: 'dualsport', custom: null, tol: 3, rear: newEnd(), front: newEnd() };
  }

  function normalize(s) {
    var o = freshState();
    if (s.units === 'in') o.units = 'in';
    if (s.fieldUnits && typeof s.fieldUnits === 'object') {
      Object.keys(s.fieldUnits).forEach(function (k) {
        if (s.fieldUnits[k] === 'mm' || s.fieldUnits[k] === 'in') o.fieldUnits[k] = s.fieldUnits[k];
      });
    }
    if (s.travelUnit === 'mm' || s.travelUnit === 'in') { // earlier version: one travel unit
      o.fieldUnits['travel.rear'] = o.fieldUnits['travel.rear'] || s.travelUnit;
      o.fieldUnits['travel.front'] = o.fieldUnits['travel.front'] || s.travelUnit;
    }
    if (['both', 'rear', 'front'].indexOf(s.which) >= 0) o.which = s.which;
    if (s.preset === 'custom' || RANGES.rear[s.preset]) o.preset = s.preset;
    if (ok(s.tol)) o.tol = s.tol;
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
      Object.keys(o[e]).forEach(function (k) { if (k in src) o[e][k] = src[k]; });
      if (!Array.isArray(o[e].log)) o[e].log = [];
    });
    return o;
  }

  // The first version kept several bikes; carry the first one over.
  function fromV1(s) {
    var b = s && Array.isArray(s.bikes) && s.bikes[0];
    if (!b) return null;
    return {
      units: s.units,
      travelUnit: s.fieldUnits && s.fieldUnits.travel,
      tol: b.rear && b.rear.tol,
      preset: b.rear && b.rear.type,
      rear: b.rear, front: b.front
    };
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
  var confirmClear = { rear: false, front: false };

  // ---------- units ----------
  // state.units: results, and the default for any box the user hasn't switched.
  // state.fieldUnits['extended.rear'] etc: that one box's own unit.
  function tUnit() { return state.units; }
  function uOf(key) { return state.fieldUnits[key] || state.units; }

  function fmtNum(mm, u) {
    if (!ok(mm)) return '';
    u = u || tUnit();
    var d = u === 'in' ? mm / MM_PER_IN : mm;
    var n = parseFloat(u === 'in' ? d.toFixed(2) : d.toFixed(1));
    return (n === 0 ? 0 : n).toString();
  }
  function fmtLen(mm, u) { return fmtNum(mm, u) + ' ' + (u || tUnit()); }
  function fmtOff(d) {
    var s = fmtNum(Math.abs(d));
    if (parseFloat(s) === 0) return 'on target';
    return (d > 0 ? '+' : '−') + s + ' ' + tUnit();
  }

  function parseNum(str) {
    var s = String(str == null ? '' : str).trim().replace(',', '.');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function parseLen(str, u) {
    var v = parseNum(str);
    return v == null ? null : (u === 'in' ? v * MM_PER_IN : v);
  }

  // ---------- math ----------
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
      o.t1 = E - T * o.lo / 100; // Target 1: least free sag (highest reading)
      o.t2 = E - T * o.hi / 100; // Target 2: most free sag (lowest reading)
    }
    return o;
  }

  function avg(a, b) {
    if (ok(a) && ok(b)) return (a + b) / 2;
    return ok(a) ? a : ok(b) ? b : null;
  }
  function bigGap(a, b) { return ok(a) && ok(b) && Math.abs(a - b) > GAP_WARN_MM + EPS; }
  function tol() { return ok(state.tol) ? Math.abs(state.tol) : 0; }

  function riderVerdict(r, target) {
    if (!ok(target)) return null;
    var off = r - target;
    if (off < -tol() - EPS) return { cls: 'adjust', icon: '▲', head: 'ADD preload', sub: 'Sitting too low by ' + fmtLen(-off) + '.' };
    if (off > tol() + EPS) return { cls: 'adjust', icon: '▼', head: 'REDUCE preload', sub: 'Sitting too high by ' + fmtLen(off) + '.' };
    return { cls: 'good', icon: '✓', head: 'Call it good', sub: 'Close enough.' };
  }

  function freeVerdict(r, c) {
    if (!ok(c.t1)) return null;
    if (r > c.t1 + EPS) return { cls: 'adjust', head: 'Stiffer spring', short: 'Stiffer spring',
      sub: 'Too little free sag. Your spring is too light for your weight: stiffer spring. Until then, keep your rider sag right and ride it.' };
    if (r < c.t2 - EPS) return { cls: 'adjust', head: 'Softer spring', short: 'Softer spring',
      sub: 'Too much free sag. Your spring is too heavy for your weight: softer spring. Until then, set preload for rider sag and ride it.' };
    return { cls: 'good', head: "Spring's right for you.", short: 'Spring OK', sub: '' };
  }

  // ---------- static markup ----------
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

  function endHTML(end) {
    var p = end + '-', front = end === 'front';
    function tapeInput(id, f, label) {
      return '<div class="field"><label class="lbl sm" for="' + id + '">' + label + '</label>' +
        '<div class="inp"><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" data-end="' + end + '" data-f="' + f + '" data-u="' + f + '.' + end + '">' + unitBtn(f + '.' + end) + '</div></div>';
    }
    function textInput(f, label, ph) {
      return '<div class="field"><label class="lbl sm" for="' + p + f + '">' + label + '</label>' +
        '<input class="text" id="' + p + f + '" type="text" autocomplete="off" maxlength="80" placeholder="' + ph + '" data-end="' + end + '" data-f="' + f + '" data-k="text"></div>';
    }
    return '' +
      '<section class="card end" id="end-' + end + '" data-show="' + end + '" aria-labelledby="' + p + 'h">' +
        '<div class="end-head"><span class="step" aria-hidden="true">' + (front ? 2 : 1) + '</span><h2 id="' + p + 'h" class="card-h">' + NAMES[end] + '</h2>' +
          (front ? '<span class="aside">Some bikes have no front preload adjuster.</span>' : '') + '</div>' +

        '<div class="field">' +
          '<label class="lbl" for="' + p + 'ext">Fully extended</label>' +
          '<div class="inp"><input id="' + p + 'ext" type="text" inputmode="decimal" autocomplete="off" data-end="' + end + '" data-f="extended" data-u="extended.' + end + '" aria-describedby="' + p + 'ext-h">' + unitBtn('extended.' + end) + '</div>' +
          '<p class="hint" id="' + p + 'ext-h">' + (front ? 'Front wheel off the ground. ' : 'Bike lifted, wheel off the ground. ') + 'Same two points every time.</p>' +
        '</div>' +

        '<div class="target" id="' + p + 'target"></div>' +

        '<form class="add" data-end="' + end + '" novalidate>' +
          '<fieldset><legend class="lbl">Reading with you on it</legend>' +
            '<div class="pair">' +
              '<div class="field"><label class="lbl sm" for="' + p + 'a">Lifted &amp; settled</label><div class="inp"><input id="' + p + 'a" name="a" type="text" inputmode="decimal" autocomplete="off" data-u="a.' + end + '">' + unitBtn('a.' + end) + '</div></div>' +
              '<div class="field"><label class="lbl sm" for="' + p + 'b">Pushed &amp; returned</label><div class="inp"><input id="' + p + 'b" name="b" type="text" inputmode="decimal" autocomplete="off" data-u="b.' + end + '">' + unitBtn('b.' + end) + '</div></div>' +
            '</div>' +
            '<div class="note-row">' +
              '<input class="text" name="note" type="text" autocomplete="off" maxlength="80" placeholder="Note, e.g. +1 turn" aria-label="Note (optional)">' +
              '<button class="btn primary" type="submit">Add</button>' +
            '</div>' +
            '<p class="preview" id="' + p + 'preview"></p>' +
            '<p class="form-err" id="' + p + 'err" hidden></p>' +
          '</fieldset>' +
        '</form>' +

        '<div id="' + p + 'verdict"></div>' +
        '<div id="' + p + 'history"></div>' +

        '<details class="more">' +
          '<summary><span>Free sag check</span><span class="sum-val" id="' + p + 'free-sum"></span></summary>' +
          '<div class="more-body">' +
            '<p class="hint">Bike on its own weight, no rider.</p>' +
            '<div class="pair">' + tapeInput(p + 'fa', 'freeA', 'Lifted &amp; settled') + tapeInput(p + 'fb', 'freeB', 'Pushed &amp; returned') + '</div>' +
            '<div id="' + p + 'free"></div>' +
          '</div>' +
        '</details>' +

        '<details class="more">' +
          '<summary><span>Preload settings</span><span class="sum-val" id="' + p + 'set-sum"></span></summary>' +
          '<div class="more-body">' +
            textInput('normal', 'Normal', 'e.g. 8 clicks out') +
            textInput('loaded', 'Loaded', 'e.g. collar 3 turns') +
            '<p class="hint">Loaded = luggage on, or a weight on the bike with you.</p>' +
          '</div>' +
        '</details>' +
      '</section>';
  }

  // ---------- rendering ----------
  function fillInputs() {
    each('[data-f]', function (el) {
      var v = state[el.dataset.end][el.dataset.f];
      if (el.dataset.u) el.value = fmtNum(v, uOf(el.dataset.u));
      else el.value = v == null ? '' : v;
    });
    each('[data-custom]', function (el) {
      var parts = el.dataset.custom.split('.');
      var v = state.custom && state.custom[parts[0]][parts[1]];
      el.value = ok(v) ? String(v) : '';
    });
    $('tol').value = fmtNum(state.tol, uOf('tol'));
  }

  function renderUnits() {
    each('[data-act="unit"]', function (b) { b.setAttribute('aria-pressed', String(b.dataset.unit === state.units)); });
    each('button.u', function (b) {
      var u = uOf(b.dataset.u);
      b.innerHTML = '<span' + (u === 'mm' ? ' class="on"' : '') + '>mm</span><span' + (u === 'in' ? ' class="on"' : '') + '>in</span>';
      b.setAttribute('aria-label', 'Units for this box: ' + (u === 'in' ? 'inches' : 'millimetres') + '. Switch to ' + (u === 'in' ? 'millimetres' : 'inches'));
    });
  }

  function renderWhich() {
    each('[data-act="which"]', function (b) { b.setAttribute('aria-pressed', String(b.dataset.which === state.which)); });
    each('[data-show]', function (el) { el.hidden = state.which !== 'both' && el.dataset.show !== state.which; });
    each('.end .step', function (el) { el.hidden = state.which !== 'both'; });
  }

  function renderPreset() {
    each('input[name="preset"]', function (r) { r.checked = r.value === state.preset; });
    $('custom').hidden = state.preset !== 'custom';
  }

  function update(end) {
    var s = state[end], c = calc(end), p = end + '-';

    var t = $(p + 'target');
    if (!ok(s.travel)) {
      t.className = 'target empty';
      t.textContent = 'Enter ' + end + ' travel in Setup.';
    } else if (!ok(c.p.rider)) {
      t.className = 'target empty';
      t.textContent = 'Enter a rider sag % in Setup.';
    } else if (!ok(s.extended)) {
      t.className = 'target empty';
      t.textContent = 'Enter the fully extended length.';
    } else {
      t.className = 'target';
      t.innerHTML = '<span class="t-k">Target with you on it</span>' +
        '<span class="t-v">' + esc(fmtNum(c.target)) + ' <small>' + tUnit() + '</small></span>' +
        '<span class="t-s">' + esc(fmtLen(c.rs)) + ' of sag (' + c.p.rider + '% of ' + esc(fmtLen(s.travel, uOf('travel.' + end))) + ')</span>';
    }

    renderVerdict(end, s, c);
    renderHistory(end, s, c);
    renderFree(end, s, c);
    $(p + 'set-sum').textContent = [s.normal, s.loaded].filter(Boolean).join(' / ');
  }

  function readingOf(e) { return avg(e.a, e.b); }

  function renderVerdict(end, s, c) {
    var box = $(end + '-verdict');
    var e = s.log[s.log.length - 1];
    if (!e) { box.innerHTML = ''; return; }
    var r = readingOf(e), v = riderVerdict(r, c.target);
    var del = '<button class="x" type="button" data-act="del" data-end="' + end + '" data-id="' + esc(e.id) + '" aria-label="Delete reading ' + esc(fmtLen(r)) + '">×</button>';
    var note = e.note ? '<p class="v-note">' + esc(e.note) + '</p>' : '';
    var html = v
      ? '<div class="verdict v-' + v.cls + '">' + del +
          '<p class="v-head"><span class="v-icon" aria-hidden="true">' + v.icon + '</span>' + v.head + '</p>' +
          '<p class="v-sub">' + esc(v.sub) + ' <span class="v-nums">' + esc(fmtLen(r)) + ' vs ' + esc(fmtLen(c.target)) + '</span></p>' +
          note + '</div>'
      : '<div class="verdict">' + del + '<p class="v-head">' + esc(fmtLen(r)) + '</p><p class="v-sub">Finish setup to get a verdict.</p>' + note + '</div>';
    if (bigGap(e.a, e.b)) html += '<p class="gap">' + GAP_TEXT + '</p>';
    box.innerHTML = html;
  }

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  function renderHistory(end, s, c) {
    var older = s.log.slice(0, -1).reverse();
    var html = '';
    if (older.length) {
      html += '<ul class="log" aria-label="Earlier ' + end + ' readings">';
      older.forEach(function (e) {
        var r = readingOf(e), v = riderVerdict(r, c.target);
        html += '<li class="row' + (v ? ' v-' + v.cls : '') + '">' +
          '<span class="row-read">' + esc(fmtLen(r)) + '</span>' +
          '<span class="row-v">' + (v ? '<span aria-hidden="true">' + v.icon + '</span> ' + esc(fmtOff(r - c.target)) : '') + '</span>' +
          '<span class="row-meta">' + esc([e.note, fmtTime(e.ts)].filter(Boolean).join(' · ')) +
            (bigGap(e.a, e.b) ? ' <span class="gap-tag">⚠ gap</span>' : '') + '</span>' +
          '<button class="x" type="button" data-act="del" data-end="' + end + '" data-id="' + esc(e.id) + '" aria-label="Delete reading ' + esc(fmtLen(r)) + ' from ' + esc(fmtTime(e.ts)) + '">×</button>' +
          '</li>';
      });
      html += '</ul>';
    }
    if (s.log.length) {
      html += confirmClear[end]
        ? '<div class="confirm"><span>Clear all ' + s.log.length + ' reading' + (s.log.length === 1 ? '' : 's') + '?</span>' +
          '<button class="btn danger" type="button" data-act="clear-yes" data-end="' + end + '">Clear</button>' +
          '<button class="btn" type="button" data-act="clear-no" data-end="' + end + '">Cancel</button></div>'
        : '<button class="btn link" type="button" data-act="clear-ask" data-end="' + end + '">Clear log</button>';
    }
    $(end + '-history').innerHTML = html;
  }

  function renderFree(end, s, c) {
    var box = $(end + '-free'), sum = $(end + '-free-sum');
    var r = avg(s.freeA, s.freeB), v = ok(r) ? freeVerdict(r, c) : null;
    var win = ok(c.t1) ? fmtNum(c.t2) + '–' + fmtLen(c.t1) : '';
    sum.className = 'sum-val' + (v ? ' v-' + v.cls : '');
    sum.textContent = v ? v.short : win;
    if (!v) {
      box.innerHTML = win ? '<p class="hint">Aim for ' + esc(win) + ' (' + c.lo + '–' + c.hi + '% of travel).</p>' : '';
      return;
    }
    box.innerHTML = '<div class="verdict small v-' + v.cls + '">' +
      '<p class="v-head">' + esc(v.head) + '</p>' +
      (v.sub ? '<p class="v-sub">' + esc(v.sub) + '</p>' : '') +
      '<p class="v-sub"><span class="v-nums">' + esc(fmtLen(r)) + ' · window ' + esc(win) + '</span></p>' +
      '</div>' +
      (bigGap(s.freeA, s.freeB) ? '<p class="gap">' + GAP_TEXT + '</p>' : '');
  }

  function updatePreview(form) {
    var end = form.dataset.end;
    var a = boxVal(form.elements.a), b = boxVal(form.elements.b);
    var el = $(end + '-preview');
    $(end + '-err').hidden = true;
    if (!(ok(a) && ok(b))) { el.innerHTML = ''; return; }
    el.innerHTML = 'Average <strong>' + esc(fmtLen(avg(a, b))) + '</strong>' +
      (bigGap(a, b) ? '<br><span class="gap">' + GAP_TEXT + '</span>' : '');
  }

  function renderAll() {
    renderUnits();
    renderWhich();
    renderPreset();
    fillInputs();
    ENDS.forEach(update);
  }

  function boxVal(el) { return parseLen(el.value, uOf(el.dataset.u)); }

  function showStorageWarn() { if (!storageOk) $('storage-warn').hidden = false; }

  // Change units without losing readings typed into the unsaved "add reading" boxes.
  function switchUnits(change) {
    var forms = Array.prototype.slice.call(document.querySelectorAll('form.add'));
    var held = forms.map(function (f) {
      return { a: boxVal(f.elements.a), b: boxVal(f.elements.b) };
    });
    change();
    save();
    renderUnits();
    fillInputs();
    forms.forEach(function (f, i) {
      f.elements.a.value = fmtNum(held[i].a, uOf(f.elements.a.dataset.u));
      f.elements.b.value = fmtNum(held[i].b, uOf(f.elements.b.dataset.u));
      updatePreview(f);
    });
    ENDS.forEach(update);
  }

  // ---------- events ----------
  document.addEventListener('input', function (e) {
    var el = e.target;
    var form = el.closest('form.add');
    if (form) { if (el.name === 'a' || el.name === 'b') updatePreview(form); return; }

    if (el.id === 'tol') {
      state.tol = boxVal(el);
      save();
      ENDS.forEach(update);
      return;
    }
    if (el.dataset.custom) {
      var parts = el.dataset.custom.split('.');
      state.custom[parts[0]][parts[1]] = parseNum(el.value);
      save();
      update(parts[0]);
      return;
    }
    var end = el.dataset.end, f = el.dataset.f;
    if (!end || !f) return;
    state[end][f] = el.dataset.u ? boxVal(el) : el.value;
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

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form.add');
    if (!form) return;
    e.preventDefault();
    var end = form.dataset.end;
    var a = boxVal(form.elements.a), b = boxVal(form.elements.b);
    if (!ok(a) && !ok(b)) {
      $(end + '-err').textContent = 'Enter at least one reading.';
      $(end + '-err').hidden = false;
      return;
    }
    state[end].log.push({ id: uid(), ts: Date.now(), a: a, b: b, note: form.elements.note.value.trim() });
    confirmClear[end] = false;
    save();
    form.reset();
    updatePreview(form);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    update(end);

    var v = riderVerdict(avg(a, b), calc(end).target);
    $('status').textContent = NAMES[end] + ' reading ' + fmtLen(avg(a, b)) + ': ' + (v ? v.head + '. ' + v.sub : 'added.');
    $(end + '-verdict').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var end = btn.dataset.end;

    switch (btn.dataset.act) {
      case 'unit':
        if (state.units === btn.dataset.unit) return;
        switchUnits(function () { state.units = btn.dataset.unit; });
        break;
      case 'box-unit':
        var key = btn.dataset.u;
        if (key === 'tol') {
          // Tolerance is a preset distance (3 mm), not a measurement: convert it (3 mm -> 0.12 in).
          switchUnits(function () { state.fieldUnits.tol = uOf('tol') === 'mm' ? 'in' : 'mm'; });
          break;
        }
        // Measurements: keep what's typed and read it in the new unit (24 mm -> 24 in, not 0.94 in).
        state.fieldUnits[key] = uOf(key) === 'mm' ? 'in' : 'mm';
        save();
        renderUnits();
        btn.parentNode.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
        break;
      case 'which':
        state.which = btn.dataset.which;
        save();
        renderWhich();
        break;
      case 'del':
        state[end].log = state[end].log.filter(function (x) { return x.id !== btn.dataset.id; });
        if (!state[end].log.length) confirmClear[end] = false;
        save();
        update(end);
        break;
      case 'clear-ask': confirmClear[end] = true; update(end); break;
      case 'clear-no': confirmClear[end] = false; update(end); break;
      case 'clear-yes':
        state[end].log = [];
        confirmClear[end] = false;
        save();
        update(end);
        break;
    }
  });

  // ---------- boot ----------
  $('preset-rows').innerHTML = presetRowsHTML();
  $('ends').innerHTML = ENDS.map(endHTML).join('');
  showStorageWarn();
  renderAll();
})();
