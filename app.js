(function () {
  'use strict';

  // ---------- constants ----------
  var KEY = 'sagcalc.v2';
  var OLD_KEY = 'sagcalc.v1';
  var MM_PER_IN = 25.4;
  var EPS = 1e-6;
  var TOL_MM = 3; // "close enough" band either side of the rider sag target
  var ENDS = ['rear', 'front'];
  var NAMES = { rear: 'Rear', front: 'Front' };

  var TYPES = [
    ['mx', 'MX'],
    ['enduro', 'Hard enduro'],
    ['dualsport', 'Dual sport'],
    ['adventure', 'Adventure'],
    ['street', 'Street']
  ];

  // r = rider sag % range, f = static sag % range
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
    return { units: 'mm', fieldUnits: {}, preset: 'dualsport', custom: null, rear: newEnd(), front: newEnd() };
  }

  function normalize(s) {
    var o = freshState();
    if (s.units === 'in') o.units = 'in';
    if (s.fieldUnits && typeof s.fieldUnits === 'object') {
      Object.keys(s.fieldUnits).forEach(function (k) {
        if (s.fieldUnits[k] === 'mm' || s.fieldUnits[k] === 'in') o.fieldUnits[k] = s.fieldUnits[k];
      });
    }
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

  // ---------- units ----------
  // state.units: default for any box the user hasn't switched.
  // Readings and targets for an end always use that end's fully extended unit.
  function uOf(key) {
    var parts = key.split('.');
    if (parts[0] === 'reading' || parts[0] === 'free') return uOf('extended.' + parts[1]);
    return state.fieldUnits[key] || state.units;
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
    if (u === 'in') return fmtIn(mm / MM_PER_IN);
    var n = parseFloat(mm.toFixed(1));
    return (n === 0 ? 0 : n).toString();
  }
  // 3" or 76 mm
  function fmtLen(mm, u) { return fmtNum(mm, u) + (u === 'in' ? '"' : ' mm'); }
  // big target number with a small unit
  function bigLen(mm, u) {
    return '<span class="n">' + esc(fmtNum(mm, u)) + (u === 'in' ? '"' : '') + '</span>' + (u === 'in' ? '' : '<small> mm</small>');
  }

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
  // Sag = fully extended − loaded reading (Race Tech L1 − L2), so
  // rider sag target = fully extended − (travel × rider sag %).
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
      o.t1 = E - T * o.lo / 100; // least static sag (highest reading)
      o.t2 = E - T * o.hi / 100; // most static sag (lowest reading)
    }
    return o;
  }

  function riderVerdict(r, target, u) {
    var off = r - target;
    if (off < -TOL_MM - EPS) return { cls: 'adjust', icon: '▲', head: 'Add preload', amt: fmtLen(-off, u) + ' low' };
    if (off > TOL_MM + EPS) return { cls: 'adjust', icon: '▼', head: 'Reduce preload', amt: fmtLen(off, u) + ' high' };
    return { cls: 'good', icon: '✓', head: 'Call it good', amt: '' };
  }

  function staticVerdict(r, c) {
    if (r > c.t1 + EPS) return { cls: 'adjust', icon: '!', head: 'Stiffer spring', amt: '' };
    if (r < c.t2 - EPS) return { cls: 'adjust', icon: '!', head: 'Softer spring', amt: '' };
    return { cls: 'good', icon: '✓', head: 'Spring OK', amt: '' };
  }

  // ---------- markup ----------
  function unitBtn(key) { return '<button type="button" class="u" data-act="box-unit" data-u="' + key + '"></button>'; }

  // (i) button with a small popover; opens on tap, hover or keyboard focus.
  function infoHTML(id, label, body) {
    return '<span class="info"><button type="button" class="info-btn" data-act="info" aria-label="' + esc(label) + '" aria-controls="' + id + '" aria-expanded="false">i</button>' +
      '<span class="info-body" id="' + id + '" role="note">' + body + '</span></span>';
  }

  function box(id, label, end, f) {
    var key = f + '.' + end;
    return '<div class="field">' +
      '<label class="lbl" for="' + id + '">' + label + '</label>' +
      '<div class="inp"><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" data-end="' + end + '" data-f="' + f + '" data-u="' + key + '">' + unitBtn(key) + '</div></div>';
  }
  function head(n, id, title, extra) {
    return '<div class="stage-head"><span class="step" aria-hidden="true">' + n + '</span><h2 id="' + id + '" class="card-h">' + title + '</h2>' + (extra || '') + '</div>';
  }

  function presetRowsHTML() {
    function cell(end, t) {
      var g = RANGES[end][t];
      return '<span class="pc"><b>' + g.r[0] + '–' + g.r[1] + '%</b><small>' + g.f[0] + '–' + g.f[1] + '%</small></span>';
    }
    function aria(t, name) {
      var r = RANGES.rear[t], f = RANGES.front[t];
      return name + '. Rear: rider sag ' + r.r[0] + ' to ' + r.r[1] + '%, static sag ' + r.f[0] + ' to ' + r.f[1] +
        '%. Front: rider sag ' + f.r[0] + ' to ' + f.r[1] + '%, static sag ' + f.f[0] + ' to ' + f.f[1] + '%.';
    }
    return '<label class="prow"><span class="pn"><input type="radio" name="preset" value="custom">Custom</span><span class="pc wide"><small>Your own numbers</small></span></label>' +
      TYPES.map(function (t) {
        return '<label class="prow"><span class="pn"><input type="radio" name="preset" value="' + t[0] + '" aria-label="' + aria(t[0], t[1]) + '">' + t[1] + '</span>' +
          cell('rear', t[0]) + cell('front', t[0]) + '</label>';
      }).join('');
  }

  // One check block: name + (i), target, reading box, status box.
  function checkHTML(end, f, label) {
    var id = end + '-' + f, key = f + '.' + end;
    return '<div class="check" id="' + id + '-check">' +
      '<div class="check-head"><span class="check-k">' + label + '</span>' +
        infoHTML(id + '-info', 'About ' + NAMES[end].toLowerCase() + ' ' + label.toLowerCase(), '') + '</div>' +
      '<div class="check-v" id="' + id + '-aim"></div>' +
      '<label class="sr-only" for="' + id + '">' + NAMES[end] + ' ' + label.toLowerCase() + ' reading</label>' +
      '<div class="inp"><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" placeholder="Your reading" data-end="' + end + '" data-f="' + f + '" data-u="' + key + '">' +
        '<span class="suf" data-unit-of="' + key + '"></span></div>' +
      '<p class="status" id="' + id + '-status"></p>' +
    '</div>';
  }

  function flowHTML() {
    return '' +
      '<section class="card" aria-labelledby="s2-h">' +
        head(2, 's2-h', 'Fully extended', infoHTML('ext-info', 'How to measure fully extended',
          'Lift the bike so the wheel is off the ground. Measure from the axle to a fixed mark straight above it. Use the same two points for every reading after this.')) +
        '<div class="pair">' + box('rear-ext', 'Rear', 'rear', 'extended') + box('front-ext', 'Front', 'front', 'extended') + '</div>' +
      '</section>' +

      '<section class="card" aria-labelledby="s3-h">' +
        head(3, 's3-h', 'Aim for') +
        ENDS.map(function (end) {
          return '<fieldset class="endset"><legend class="end-lbl">' + NAMES[end] + '</legend>' +
            '<div class="checks">' + checkHTML(end, 'reading', 'Rider Sag') + checkHTML(end, 'free', 'Static Sag') + '</div>' +
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
    each('[data-unit-of]', function (el) { el.textContent = uOf(el.dataset.unitOf); });
    // inch boxes need a keyboard with space and "/" for tape fractions
    each('input[data-u]', function (el) { el.inputMode = uOf(el.dataset.u) === 'in' ? 'text' : 'decimal'; });
  }

  function renderPreset() {
    each('input[name="preset"]', function (r) { r.checked = r.value === state.preset; });
    $('custom').hidden = state.preset !== 'custom';
  }

  function setCheck(id, o) {
    var on = !o.off;
    $(id + '-check').className = 'check' + (o.off ? ' off' : '') + (o.cls ? ' v-' + o.cls : '');
    $(id).disabled = !on;
    $(id + '-aim').innerHTML = o.aim || '—';
    $(id + '-info').innerHTML = o.info;
    var st = $(id + '-status');
    st.innerHTML = o.status || '';
    st.hidden = !o.status;
  }

  function statusHTML(v) {
    return '<span class="st-icon" aria-hidden="true">' + v.icon + '</span><span class="st-head">' + esc(v.head) + '</span>' +
      (v.amt ? '<span class="st-amt">' + esc(v.amt) + '</span>' : '');
  }
  function warnHTML(text) { return statusHTML({ icon: '!', head: text, amt: '' }); }
  var CANT_READ = 'Can’t read that';
  var CHECK_UNITS = 'Check mm / in';

  var RIDER_INFO = 'Sit on the bike in your gear, feet on the pegs. Measure the same two points. ' +
    '<b>Add preload</b> = tighten the adjuster (bike sits higher). <b>Reduce preload</b> = loosen it. Within ±3 mm is good.';
  var STATIC_INFO = 'Once rider sag is set: bike on its own weight, no rider. Measure the same two points. ' +
    'Reading above the range = too little static sag: spring too light for your weight, fit a <b>stiffer spring</b>. ' +
    'Below the range = too much static sag: spring too heavy, fit a <b>softer spring</b>. Until then, set preload for rider sag and ride it.';

  function update(end) {
    var s = state[end], c = calc(end), u = uOf('extended.' + end);
    var rid = end + '-reading', fid = end + '-free';
    var ready = ok(c.target);

    // rider sag
    var r = { off: !ready, info: RIDER_INFO };
    if (ready) {
      r.aim = bigLen(c.target, u);
      r.info = RIDER_INFO + '<br><br>Target = ' + esc(fmtLen(s.extended, u)) + ' − ' + esc(fmtLen(c.rs, u)) +
        ' sag (' + c.p.rider + '% of ' + esc(fmtLen(s.travel, uOf('travel.' + end))) + ').';
      if (unreadable($(rid))) { r.cls = 'warn'; r.status = warnHTML(CANT_READ); }
      else if (c.target <= 0) { r.cls = 'warn'; r.status = warnHTML(CHECK_UNITS); }
      else if (ok(s.reading) && s.reading > s.extended + 2) { r.cls = 'warn'; r.status = warnHTML(CHECK_UNITS); }
      else if (ok(s.reading)) { var rv = riderVerdict(s.reading, c.target, u); r.cls = rv.cls; r.status = statusHTML(rv); }
    }
    setCheck(rid, r);

    // static sag
    var ready2 = ready && ok(c.t1);
    var f = { off: !ready2, info: STATIC_INFO };
    if (ready2) {
      var half = fmtNum((c.t1 - c.t2) / 2, u);
      var mid = (c.t1 + c.t2) / 2;
      f.aim = half === '0' ? bigLen(mid, u)   // 575 ± 5 mm  /  77" ± 1/8"
        : (u === 'in' ? bigLen(mid, u) : '<span class="n">' + esc(fmtNum(mid, u)) + '</span>') +
          ' <small class="pm">± ' + esc(fmtLen((c.t1 - c.t2) / 2, u)) + '</small>';
      f.info = STATIC_INFO + '<br><br>Range ' + esc(fmtNum(c.t2, u)) + ' to ' + esc(fmtLen(c.t1, u)) + ' (' + c.lo + '–' + c.hi + '% static sag).';
      if (unreadable($(fid))) { f.cls = 'warn'; f.status = warnHTML(CANT_READ); }
      else if (ok(s.free) && s.free > s.extended + 2) { f.cls = 'warn'; f.status = warnHTML(CHECK_UNITS); }
      else if (ok(s.free)) { var sv = staticVerdict(s.free, c); f.cls = sv.cls; f.status = statusHTML(sv); }
    }
    setCheck(fid, f);
  }

  function renderAll() {
    renderUnits();
    renderPreset();
    fillInputs();
    ENDS.forEach(update);
  }

  function showStorageWarn() { if (!storageOk) $('storage-warn').hidden = false; }

  function closeInfos(except) {
    each('.info.open', function (el) {
      if (el === except) return;
      el.classList.remove('open');
      el.querySelector('.info-btn').setAttribute('aria-expanded', 'false');
    });
  }

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
    if (!btn || btn.dataset.act !== 'info') closeInfos();
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'info':
        var wrap = btn.parentNode, open = !wrap.classList.contains('open');
        closeInfos(wrap);
        wrap.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', String(open));
        break;
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
        // This end's reading boxes use the same unit: re-read what's typed in them, too.
        if (key.indexOf('extended.') === 0) {
          var e2 = key.split('.')[1];
          ['reading', 'free'].forEach(function (f) { $(e2 + '-' + f).dispatchEvent(new Event('input', { bubbles: true })); });
        }
        break;
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeInfos(); });

  // ---------- boot ----------
  $('preset-rows').innerHTML = presetRowsHTML();
  $('flow').innerHTML = flowHTML();
  showStorageWarn();
  renderAll();
})();
