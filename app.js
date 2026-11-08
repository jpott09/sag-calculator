(function () {
  'use strict';

  // ---------- constants ----------
  var KEY = 'sagcalc.v1';
  var MM_PER_IN = 25.4;
  var EPS = 1e-6;
  var GAP_WARN_MM = 5;
  var SECS = ['rear', 'front'];

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

  // ---------- state ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function newSection(sec) {
    var rg = RANGES[sec].dualsport;
    return {
      travel: null, type: 'dualsport',
      riderPct: (rg.r[0] + rg.r[1]) / 2,
      freeLow: rg.f[0], freeHigh: rg.f[1],
      extended: null, tol: 3, log: [],
      freeA: null, freeB: null,
      normal: '', loaded: ''
    };
  }

  function newBike(name) {
    return { id: uid(), name: name || '', rear: newSection('rear'), front: newSection('front') };
  }

  function freshState() {
    var b = newBike('My bike');
    return { units: 'mm', fieldUnits: {}, current: b.id, bikes: [b] };
  }

  function normalize(s) {
    var out = { units: s.units === 'in' ? 'in' : 'mm', fieldUnits: {}, current: s.current, bikes: [] };
    if (s.fieldUnits && typeof s.fieldUnits === 'object') {
      Object.keys(s.fieldUnits).forEach(function (k) {
        if (s.fieldUnits[k] === 'mm' || s.fieldUnits[k] === 'in') out.fieldUnits[k] = s.fieldUnits[k];
      });
    }
    s.bikes.forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      var nb = { id: b.id || uid(), name: typeof b.name === 'string' ? b.name : '' };
      SECS.forEach(function (sec) {
        var ns = newSection(sec);
        var src = b[sec] && typeof b[sec] === 'object' ? b[sec] : {};
        Object.keys(ns).forEach(function (k) { if (k in src) ns[k] = src[k]; });
        if (!RANGES[sec][ns.type]) ns.type = 'dualsport';
        if (!Array.isArray(ns.log)) ns.log = [];
        nb[sec] = ns;
      });
      out.bikes.push(nb);
    });
    if (!out.bikes.length) return freshState();
    if (!out.bikes.some(function (b) { return b.id === out.current; })) out.current = out.bikes[0].id;
    return out;
  }

  var storageOk = true;
  try {
    localStorage.setItem('__sagcalc_test', '1');
    localStorage.removeItem('__sagcalc_test');
  } catch (e) { storageOk = false; }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.bikes) && s.bikes.length) return normalize(s);
      }
    } catch (e) { /* fall through */ }
    return freshState();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { storageOk = false; showStorageWarn(); }
  }

  var state = load();
  var ui = { confirmClear: { rear: false, front: false }, confirmBikeDel: false };

  function bike() {
    for (var i = 0; i < state.bikes.length; i++) if (state.bikes[i].id === state.current) return state.bikes[i];
    return state.bikes[0];
  }

  // ---------- numbers & units ----------
  function ok(v) { return typeof v === 'number' && isFinite(v); }
  // state.units = tape + results unit (and default for every box).
  // state.fieldUnits[key] = per-box override, e.g. travel in mm while the tape reads inches.
  function unit() { return state.units; }
  // 'tape' boxes (extended length, readings, tolerance) always share the results unit;
  // only 'travel' (from the spec sheet) can differ.
  function uOf(key) { return (key && key !== 'tape' && state.fieldUnits[key]) || state.units; }
  function toDisp(mm, u) { return (u || state.units) === 'in' ? mm / MM_PER_IN : mm; }
  function fromDisp(v, u) { return (u || state.units) === 'in' ? v * MM_PER_IN : v; }

  function fmtNum(mm, u) {
    if (!ok(mm)) return '';
    u = u || state.units;
    var d = toDisp(mm, u);
    var s = u === 'in' ? d.toFixed(2) : d.toFixed(1);
    var n = parseFloat(s);
    return (n === 0 ? 0 : n).toString(); // avoid "-0"
  }
  function fmtLen(mm) { return ok(mm) ? fmtNum(mm) + ' ' + unit() : '—'; }
  function fmtOff(d) {
    var s = fmtNum(Math.abs(d));
    if (parseFloat(s) === 0) return '0 ' + unit();
    return (d > 0 ? '+' : '−') + s + ' ' + unit();
  }
  function fmtPct(p) { return ok(p) ? String(p) : ''; }

  function parseNum(str) {
    var s = String(str == null ? '' : str).trim().replace(',', '.');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function parseLen(str, u) { var v = parseNum(str); return v == null ? null : fromDisp(v, u); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- math ----------
  function calc(s) {
    var T = s.travel, E = s.extended, p = s.riderPct, out = {};
    if (ok(T) && ok(p)) out.rs = T * p / 100;
    if (ok(out.rs) && ok(E)) out.target = E - out.rs;
    if (ok(T) && ok(E) && ok(s.freeLow) && ok(s.freeHigh)) {
      out.lo = Math.min(s.freeLow, s.freeHigh);
      out.hi = Math.max(s.freeLow, s.freeHigh);
      out.t1 = E - T * out.lo / 100; // less free sag (higher reading)
      out.t2 = E - T * out.hi / 100; // more free sag (lower reading)
    }
    return out;
  }

  function avg(a, b) {
    if (ok(a) && ok(b)) return (a + b) / 2;
    if (ok(a)) return a;
    if (ok(b)) return b;
    return null;
  }
  function bigGap(a, b) { return ok(a) && ok(b) && Math.abs(a - b) > GAP_WARN_MM + EPS; }
  function tolOf(s) { return ok(s.tol) ? Math.abs(s.tol) : 0; }

  function riderVerdict(r, target, tol) {
    if (!ok(target)) return { cls: 'none', text: 'Fill in travel, sag % and extended length to get a verdict.' };
    var off = r - target;
    if (off < -tol - EPS) return { cls: 'adjust', text: 'Sitting too low by ' + fmtLen(-off) + '. ADD preload.' };
    if (off > tol + EPS) return { cls: 'adjust', text: 'Sitting too high by ' + fmtLen(off) + '. REDUCE preload.' };
    return { cls: 'good', text: 'Close enough. Call it good.' };
  }

  function freeVerdict(r, c) {
    if (!ok(c.t1)) return { cls: 'none', text: 'Fill in travel, extended length and the free sag range first.' };
    if (r > c.t1 + EPS) return { cls: 'adjust', text: 'Too little free sag. Your spring is too light for your weight: stiffer spring. Until then, keep your rider sag right and ride it.' };
    if (r < c.t2 - EPS) return { cls: 'adjust', text: 'Too much free sag. Your spring is too heavy for your weight: softer spring. Until then, set preload for rider sag and ride it.' };
    return { cls: 'good', text: "Spring's right for you." };
  }

  // ---------- markup ----------
  var GAP_TEXT = 'Big gap between readings: something may be binding (linkage, fork seals).';

  function unitBtn(fu) {
    return '<button type="button" class="u" data-act="fu" data-fu="' + fu + '">mm</button>';
  }
  function lenField(sec, f, fu, label, hint) {
    return '<label class="field"><span class="lbl">' + label + '</span>' +
      '<span class="inp"><input type="text" inputmode="decimal" autocomplete="off" data-sec="' + sec + '" data-f="' + f + '" data-k="len" data-fu="' + fu + '">' + unitBtn(fu) + '</span>' +
      (hint ? '<span class="hint">' + hint + '</span>' : '') + '</label>';
  }
  function pctInput(sec, f, aria) {
    return '<span class="inp"><input type="text" inputmode="decimal" autocomplete="off" aria-label="' + aria + '" data-sec="' + sec + '" data-f="' + f + '" data-k="pct"><span class="pct">%</span></span>';
  }
  function textField(sec, f, label, ph) {
    return '<label class="field"><span class="lbl">' + label + '</span>' +
      '<input class="text" type="text" autocomplete="off" maxlength="80" placeholder="' + ph + '" data-sec="' + sec + '" data-f="' + f + '" data-k="text"></label>';
  }

  function sectionHTML(sec) {
    var rear = sec === 'rear';
    var notes = rear
      ? ['Do this first. Front comes after.']
      : ['Fully extended = front wheel off the ground.', 'Some bikes have no front preload adjuster.'];
    var opts = TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
    var p = sec + '-';

    return '' +
      '<section class="card sec" id="sec-' + sec + '">' +
        '<div class="sec-head"><span class="step">' + (rear ? 1 : 2) + '</span><h2>' + (rear ? 'Rear' : 'Front') + '</h2></div>' +
        '<ul class="notes">' + notes.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>' +

        '<div class="part"><h3>Setup</h3>' +
          '<p class="part-intro">Tap <b>mm</b>/<b>in</b> on a box to type that value in the other unit.</p>' +
          lenField(sec, 'travel', 'travel', 'Wheel travel <i>T</i>', "Owner's manual or maker's spec sheet.") +
          '<label class="field"><span class="lbl">Riding type</span><select data-sec="' + sec + '" data-f="type" data-k="sel">' + opts + '</select></label>' +
          '<label class="field"><span class="lbl">Rider sag</span>' + pctInput(sec, 'riderPct', 'Rider sag percent') +
            '<span class="hint" id="' + p + 'range"></span></label>' +
          '<div class="field"><span class="lbl">Free sag range</span>' +
            '<div class="pair">' + pctInput(sec, 'freeLow', 'Free sag low percent') + pctInput(sec, 'freeHigh', 'Free sag high percent') + '</div>' +
            '<span class="hint">Low % and high %. Prefilled from the riding type.</span></div>' +
          lenField(sec, 'extended', 'tape', 'Fully extended length <i>E</i>',
            (rear ? '' : 'Front wheel off the ground. ') + 'Same two points every time, bike lifted so the suspension is fully extended.') +
        '</div>' +

        '<div class="part"><h3>Targets</h3>' +
          '<div class="tiles">' +
            '<div class="tile main"><div class="tile-k">Rider sag target (tape reading with you on it)</div><div class="tile-v" id="' + p + 'target">—</div><div class="tile-s" id="' + p + 'target-s"></div></div>' +
            '<div class="tile"><div class="tile-k">Settles by (RS)</div><div class="tile-v" id="' + p + 'rs">—</div><div class="tile-s" id="' + p + 'rs-s">How far it should settle with you on it.</div></div>' +
            '<div class="tile"><div class="tile-k">Free sag window</div><div class="tile-v" id="' + p + 'free">—</div><div class="tile-s" id="' + p + 'free-s">Bike only, no rider.</div></div>' +
          '</div>' +
        '</div>' +

        '<div class="part"><h3>Rider sag log</h3>' +
          '<div id="' + p + 'latest" aria-live="polite"></div>' +
          '<form class="add" data-sec="' + sec + '" novalidate>' +
            '<div class="field"><span class="lbl">Add measurement</span>' +
              '<div class="pair">' +
                '<label class="field"><span class="hint">Lifted &amp; settled</span><span class="inp"><input name="a" type="text" inputmode="decimal" autocomplete="off" data-fu="tape">' + unitBtn('tape') + '</span></label>' +
                '<label class="field"><span class="hint">Pushed &amp; returned</span><span class="inp"><input name="b" type="text" inputmode="decimal" autocomplete="off" data-fu="tape">' + unitBtn('tape') + '</span></label>' +
              '</div>' +
              '<span class="hint">Fill one or both. Two readings get averaged.</span>' +
            '</div>' +
            '<p class="preview" id="' + p + 'preview"></p>' +
            '<label class="field"><span class="lbl">Note <span class="opt">(optional)</span></span><input class="text" name="note" type="text" autocomplete="off" maxlength="80" placeholder="+1 turn, clicker 12…"></label>' +
            '<p class="form-err" id="' + p + 'err" hidden></p>' +
            '<button class="btn primary" type="submit">Add measurement</button>' +
          '</form>' +
          '<label class="tol">Close enough within ±<span class="inp"><input type="text" inputmode="decimal" autocomplete="off" aria-label="Tolerance" data-sec="' + sec + '" data-f="tol" data-k="len" data-fu="tape">' + unitBtn('tape') + '</span></label>' +
          '<div id="' + p + 'history"></div>' +
        '</div>' +

        '<div class="part"><h3>Free sag check (bike only, no rider)</h3>' +
          '<p class="part-intro">Do this once rider sag is set. Bike sitting on its own weight.</p>' +
          '<div class="pair">' +
            lenField(sec, 'freeA', 'tape', '<span class="hint">Lifted &amp; settled</span>') +
            lenField(sec, 'freeB', 'tape', '<span class="hint">Pushed &amp; returned</span>') +
          '</div>' +
          '<div id="' + p + 'free-verdict" aria-live="polite"></div>' +
        '</div>' +

        '<div class="part"><h3>Saved settings</h3>' +
          textField(sec, 'normal', 'Normal setting', 'e.g. 8 clicks out') +
          textField(sec, 'loaded', 'Loaded setting', 'e.g. collar 3 turns') +
          '<span class="hint">Loaded = luggage on, or a weight on the bike with you.</span>' +
        '</div>' +
      '</section>';
  }

  // ---------- rendering ----------
  var $ = function (id) { return document.getElementById(id); };

  function renderBikeBar() {
    var sel = $('bike-select');
    sel.innerHTML = state.bikes.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (b.id === state.current ? ' selected' : '') + '>' + esc(b.name || 'Unnamed bike') + '</option>';
    }).join('');
    $('bike-name').value = bike().name;
    renderBikeDel();
  }

  function renderBikeDel() {
    var b = bike();
    $('bike-del').innerHTML = ui.confirmBikeDel
      ? '<div class="confirm"><p>Delete “' + esc(b.name || 'Unnamed bike') + '” and all its readings?</p>' +
        '<div class="btns"><button class="btn danger" type="button" data-act="bike-del-yes">Delete bike</button>' +
        '<button class="btn" type="button" data-act="bike-del-no">Cancel</button></div></div>'
      : '<button class="btn link" type="button" data-act="bike-del-ask">Delete this bike</button>';
  }

  function fillInputs(sec) {
    var s = bike()[sec];
    var els = document.querySelectorAll('[data-sec="' + sec + '"][data-f]');
    Array.prototype.forEach.call(els, function (el) {
      var f = el.dataset.f, k = el.dataset.k, v = s[f];
      if (k === 'len') el.value = ok(v) ? fmtNum(v, uOf(el.dataset.fu)) : '';
      else if (k === 'pct') el.value = fmtPct(v);
      else el.value = v == null ? '' : v;
    });
  }

  function update(sec) {
    var s = bike()[sec], c = calc(s), p = sec + '-', tol = tolOf(s);
    var rg = RANGES[sec][s.type];
    var typeName = TYPES.filter(function (t) { return t[0] === s.type; })[0][1];
    $(p + 'range').textContent = 'Range for ' + typeName + ': ' + rg.r[0] + '–' + rg.r[1] + '%. Prefilled with the middle.';

    // targets
    $(p + 'target').textContent = fmtLen(c.target);
    $(p + 'target-s').textContent = ok(c.target)
      ? 'E − RS = ' + fmtNum(s.extended) + ' − ' + fmtNum(c.rs) + ' ' + unit()
      : 'Enter travel, rider sag % and extended length.';
    $(p + 'rs').textContent = fmtLen(c.rs);
    $(p + 'rs-s').textContent = ok(c.rs)
      ? fmtNum(s.travel) + ' × ' + s.riderPct + '%. How far it should settle with you on it.'
      : 'How far it should settle with you on it.';
    if (ok(c.t1)) {
      $(p + 'free').innerHTML = esc(fmtNum(c.t2)) + '–' + esc(fmtNum(c.t1)) + ' <small>' + unit() + '</small>';
      $(p + 'free-s').textContent = 'Target 1 (' + c.lo + '%): ' + fmtNum(c.t1) + '. Target 2 (' + c.hi + '%): ' + fmtNum(c.t2) + '. Bike only, no rider.';
    } else {
      $(p + 'free').textContent = '—';
      $(p + 'free-s').textContent = 'Bike only, no rider.';
    }

    renderLog(sec, s, c, tol);
    renderFree(sec, s, c);
  }

  function readingOf(e) { return avg(e.a, e.b); }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function renderLog(sec, s, c, tol) {
    var p = sec + '-';
    var rows = s.log.slice().reverse();
    var latest = rows[0];

    if (!latest) {
      $(p + 'latest').innerHTML = '<div class="verdict"><p class="v-text">No readings yet.</p>' +
        '<p class="v-sub">Sit on the bike in your riding gear, feet on the pegs, and have a helper measure between the same two points. Add it below.</p></div>';
    } else {
      var r = readingOf(latest), v = riderVerdict(r, c.target, tol);
      $(p + 'latest').innerHTML = '<div class="verdict v-' + v.cls + '">' +
        '<div class="v-top"><span class="v-label">Latest reading</span><span class="v-read">' + esc(fmtLen(r)) + '</span></div>' +
        '<p class="v-text">' + esc(v.text) + '</p>' +
        (ok(c.target) ? '<p class="v-sub">Target ' + esc(fmtLen(c.target)) + ' · offset ' + esc(fmtOff(r - c.target)) + '</p>' : '') +
        (bigGap(latest.a, latest.b) ? '<p class="gap">' + GAP_TEXT + '</p>' : '') +
        '</div>';
    }

    var html = '';
    if (rows.length) {
      html += '<p class="log-h">History (newest first)</p><ul class="log">';
      rows.forEach(function (e) {
        var r = readingOf(e), v = riderVerdict(r, c.target, tol);
        var meta = [fmtTime(e.ts)];
        if (ok(e.a) && ok(e.b)) meta.push(fmtNum(e.a) + ' / ' + fmtNum(e.b));
        html += '<li class="row v-' + v.cls + '">' +
          '<div class="row-main"><span class="row-read">' + esc(fmtLen(r)) + '</span>' +
            (ok(c.target) ? '<span class="row-off">' + esc(fmtOff(r - c.target)) + '</span>' : '') + '</div>' +
          (v.cls !== 'none' ? '<div class="row-verdict">' + esc(v.text) + '</div>' : '') +
          (e.note ? '<div class="row-meta row-note">' + esc(e.note) + '</div>' : '') +
          '<div class="row-meta">' + esc(meta.join(' · ')) + '</div>' +
          (bigGap(e.a, e.b) ? '<div class="gap">' + GAP_TEXT + '</div>' : '') +
          '<button class="x" type="button" data-act="row-del" data-sec="' + sec + '" data-id="' + esc(e.id) + '" aria-label="Delete this reading">×</button>' +
          '</li>';
      });
      html += '</ul>';
      html += ui.confirmClear[sec]
        ? '<div class="confirm"><p>Clear all ' + rows.length + ' reading' + (rows.length === 1 ? '' : 's') + ' for the ' + sec + '?</p>' +
          '<div class="btns"><button class="btn danger" type="button" data-act="clear-yes" data-sec="' + sec + '">Yes, clear</button>' +
          '<button class="btn" type="button" data-act="clear-no" data-sec="' + sec + '">Cancel</button></div></div>'
        : '<button class="btn link" type="button" data-act="clear-ask" data-sec="' + sec + '">Clear log</button>';
    }
    $(p + 'history').innerHTML = html;
  }

  function renderFree(sec, s, c) {
    var box = $(sec + '-free-verdict');
    var r = avg(s.freeA, s.freeB);
    if (!ok(r)) {
      box.innerHTML = ok(c.t1)
        ? '<div class="verdict small"><p class="v-sub">Enter a reading. You want it between ' + esc(fmtNum(c.t2)) + ' and ' + esc(fmtLen(c.t1)) + '.</p></div>'
        : '';
      return;
    }
    var v = freeVerdict(r, c);
    box.innerHTML = '<div class="verdict small v-' + v.cls + '">' +
      '<div class="v-top"><span class="v-label">Free sag reading</span><span class="v-read">' + esc(fmtLen(r)) + '</span></div>' +
      '<p class="v-text">' + esc(v.text) + '</p>' +
      (ok(c.t1) ? '<p class="v-sub">Window ' + esc(fmtNum(c.t2)) + '–' + esc(fmtLen(c.t1)) + '</p>' : '') +
      (bigGap(s.freeA, s.freeB) ? '<p class="gap">' + GAP_TEXT + '</p>' : '') +
      '</div>';
  }

  function updatePreview(form) {
    var sec = form.dataset.sec;
    var a = parseLen(form.elements.a.value, uOf('tape')), b = parseLen(form.elements.b.value, uOf('tape'));
    var r = avg(a, b), el = $(sec + '-preview');
    $(sec + '-err').hidden = true;
    if (!ok(r)) { el.innerHTML = ''; return; }
    var html = (ok(a) && ok(b) ? 'Average: ' : 'Reading: ') + '<strong>' + esc(fmtNum(r, uOf('tape')) + ' ' + uOf('tape')) + '</strong>';
    if (bigGap(a, b)) html += '<br><span class="gap">' + GAP_TEXT + '</span>';
    el.innerHTML = html;
  }

  function renderUnits() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-act="unit"]'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.unit === state.units));
    });
    Array.prototype.forEach.call(document.querySelectorAll('button.u'), function (el) {
      var u = uOf(el.dataset.fu);
      el.textContent = u;
      el.setAttribute('aria-label', 'Units: ' + (u === 'in' ? 'inches' : 'millimetres') + '. Tap to switch.');
    });
  }

  function renderAll() {
    renderUnits();
    renderBikeBar();
    SECS.forEach(function (sec) {
      fillInputs(sec);
      var form = document.querySelector('form.add[data-sec="' + sec + '"]');
      form.reset();
      updatePreview(form);
      update(sec);
    });
  }

  // Change units without losing readings typed into the (unsaved) add-measurement boxes.
  function switchUnits(change) {
    var forms = Array.prototype.slice.call(document.querySelectorAll('form.add'));
    var held = forms.map(function (f) {
      return { a: parseLen(f.elements.a.value, uOf('tape')), b: parseLen(f.elements.b.value, uOf('tape')) };
    });
    change();
    save();
    renderUnits();
    forms.forEach(function (f, i) {
      f.elements.a.value = fmtNum(held[i].a, uOf('tape'));
      f.elements.b.value = fmtNum(held[i].b, uOf('tape'));
      updatePreview(f);
    });
    SECS.forEach(function (sc) { fillInputs(sc); update(sc); });
  }

  function showStorageWarn() { if (!storageOk) $('storage-warn').hidden = false; }

  // ---------- events ----------
  document.addEventListener('input', function (e) {
    var el = e.target;
    var form = el.closest && el.closest('form.add');
    if (form) { if (el.name === 'a' || el.name === 'b') updatePreview(form); return; }

    if (el.id === 'bike-name') {
      bike().name = el.value;
      var opt = $('bike-select').querySelector('option[value="' + CSS.escape(state.current) + '"]');
      if (opt) opt.textContent = el.value || 'Unnamed bike';
      save();
      return;
    }

    var sec = el.dataset && el.dataset.sec, f = el.dataset && el.dataset.f, k = el.dataset && el.dataset.k;
    if (!sec || !f || k === 'sel') return;
    var s = bike()[sec];
    if (k === 'len') s[f] = parseLen(el.value, uOf(el.dataset.fu));
    else if (k === 'pct') s[f] = parseNum(el.value);
    else s[f] = el.value;
    save();
    update(sec);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'bike-select') {
      state.current = el.value;
      ui.confirmBikeDel = false;
      ui.confirmClear = { rear: false, front: false };
      save();
      renderAll();
      return;
    }
    if (el.dataset && el.dataset.k === 'sel' && el.dataset.f === 'type') {
      var sec = el.dataset.sec, s = bike()[sec], rg = RANGES[sec][el.value];
      if (!rg) return;
      s.type = el.value;
      s.riderPct = (rg.r[0] + rg.r[1]) / 2;
      s.freeLow = rg.f[0];
      s.freeHigh = rg.f[1];
      save();
      fillInputs(sec);
      update(sec);
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form.add');
    if (!form) return;
    e.preventDefault();
    var sec = form.dataset.sec;
    var a = parseLen(form.elements.a.value, uOf('tape')), b = parseLen(form.elements.b.value, uOf('tape'));
    var err = $(sec + '-err');
    if (!ok(a) && !ok(b)) {
      err.textContent = 'Enter at least one reading.';
      err.hidden = false;
      return;
    }
    bike()[sec].log.push({ id: uid(), ts: Date.now(), a: a, b: b, note: form.elements.note.value.trim() });
    ui.confirmClear[sec] = false;
    save();
    form.reset();
    updatePreview(form);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    update(sec);
    $(sec + '-latest').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act, sec = btn.dataset.sec;

    switch (act) {
      case 'unit':
        if (state.units === btn.dataset.unit) return;
        switchUnits(function () { state.units = btn.dataset.unit; });
        break;

      case 'fu':
        var key = btn.dataset.fu;
        switchUnits(function () {
          var next = uOf(key) === 'mm' ? 'in' : 'mm';
          if (key === 'tape') { state.units = next; return; }
          if (next === state.units) delete state.fieldUnits[key];
          else state.fieldUnits[key] = next;
        });
        break;

      case 'new-bike':
        var nb = newBike('');
        state.bikes.push(nb);
        state.current = nb.id;
        ui.confirmBikeDel = false;
        ui.confirmClear = { rear: false, front: false };
        save();
        renderAll();
        $('bike-name').focus();
        break;

      case 'bike-del-ask': ui.confirmBikeDel = true; renderBikeDel(); break;
      case 'bike-del-no': ui.confirmBikeDel = false; renderBikeDel(); break;
      case 'bike-del-yes':
        state.bikes = state.bikes.filter(function (b) { return b.id !== state.current; });
        if (!state.bikes.length) state.bikes.push(newBike('My bike'));
        state.current = state.bikes[0].id;
        ui.confirmBikeDel = false;
        ui.confirmClear = { rear: false, front: false };
        save();
        renderAll();
        break;

      case 'row-del':
        var s = bike()[sec];
        s.log = s.log.filter(function (x) { return x.id !== btn.dataset.id; });
        if (!s.log.length) ui.confirmClear[sec] = false;
        save();
        update(sec);
        break;

      case 'clear-ask': ui.confirmClear[sec] = true; update(sec); break;
      case 'clear-no': ui.confirmClear[sec] = false; update(sec); break;
      case 'clear-yes':
        bike()[sec].log = [];
        ui.confirmClear[sec] = false;
        save();
        update(sec);
        break;
    }
  });

  // ---------- boot ----------
  $('sections').innerHTML = SECS.map(sectionHTML).join('');
  showStorageWarn();
  renderAll();
})();
