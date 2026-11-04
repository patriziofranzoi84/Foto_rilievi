/* editor.js - Editor di annotazioni su canvas (vettoriale, touch-first)
   Le annotazioni sono salvate in coordinate dell'immagine di lavoro (non dello schermo).
   Oggetti: line / arrow {p1,p2,c,w,d}, free {pts,closed,c,w,d}, text {text,x,y,tip,s,w,d}.
   c = indice colore, w = indice spessore, d = indice tratteggio, s = indice dimensione testo. */
(function (global) {
  'use strict';

  const COLORS = ['#FFD600', '#FFFFFF', '#FF1744', '#00E676', '#00E5FF'];
  const COLOR_NAMES = ['Giallo', 'Bianco', 'Rosso', 'Verde', 'Ciano'];
  const WIDTHS = [0.004, 0.007, 0.011, 0.017];          // frazione del lato lungo dell'immagine
  const WIDTH_NAMES = ['Sottile', 'Medio', 'Spesso', 'Extra'];
  const DASHES = [[], [10, 10], [25, 12], [20, 10, 4, 10]];
  const DASH_NAMES = ['Continuo', 'Corto', 'Lungo', 'Tratto-punto'];
  const TEXT_SIZES = [0.025, 0.035, 0.05, 0.07];         // frazione del lato lungo dell'immagine
  const TEXT_NAMES = ['S', 'M', 'L', 'XL'];
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  const HIST_MAX = 10;      // passi di undo
  const HIT_TOL = 28;       // tolleranza tocco (px schermo)
  const HANDLE_R = 30;      // raggio maniglie (px schermo)
  const HOLD_MS = 500;      // tenuta per segmento retto
  const HOLD_TOL = 8;       // tolleranza movimento durante la tenuta (px)
  const TAP_MOVE = 8;       // sotto questa distanza e' un tap (px)
  const MIN_DRAW = 14;      // lunghezza minima di un tratto (px schermo)
  const SWIPE_MIN = 60;     // spostamento minimo per lo swipe (px)
  const MAX_ZOOM = 10;      // zoom massimo rispetto all'adattamento allo schermo

  const S = { tool: 'select', c: 0, w: 1, d: 0, s: 1, sel: null };
  let cv, ctx, stage, cb = {};
  let cur = null;                 // foto corrente (con .work, .annotations, .hist, .hIdx)
  let W = 0, H = 0, L = 0;        // dimensioni immagine di lavoro e lato lungo
  let vw = 1, vh = 1, dpr = 1, base = 1;
  const view = { s: 1, tx: 0, ty: 0 };
  let draft = null, raf = 0, idc = 0;
  const ptrs = new Map();
  let mode = 'none', g = {}, pz = null, locked = false;
  let lastTap = { id: null, t: 0 }, tapTimer = 0;
  const mctx = document.createElement('canvas').getContext('2d');

  /* ---------- utilita' ---------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function distSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (l2 === 0) return dist(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  const newId = () => 'a' + Date.now().toString(36) + (++idc);
  const getSel = () => (cur && S.sel ? cur.annotations.find((a) => a.id === S.sel) || null : null);
  const findById = (id) => (cur ? cur.annotations.find((a) => a.id === id) || null : null);

  /* ---------- inizializzazione e vista ---------- */
  function init(canvas, stageEl, callbacks) {
    cv = canvas; stage = stageEl; cb = callbacks || {};
    ctx = cv.getContext('2d');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onCancel);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(resize).observe(stage);
    resize();
  }

  function computeBase() { base = (W && H) ? Math.min(vw / W, vh / H) : 1; }
  function zoomLevel() { return base ? view.s / base : 1; }
  function fitView() {
    computeBase();
    view.s = base;
    view.tx = (vw - W * base) / 2;
    view.ty = (vh - H * base) / 2;
  }
  function clampScale(s) { return Math.min(Math.max(s, base), base * MAX_ZOOM); }
  function clampView() {
    const iw = W * view.s, ih = H * view.s;
    view.tx = iw <= vw ? (vw - iw) / 2 : Math.min(0, Math.max(vw - iw, view.tx));
    view.ty = ih <= vh ? (vh - ih) / 2 : Math.min(0, Math.max(vh - ih, view.ty));
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const r = stage.getBoundingClientRect();
    vw = Math.max(1, Math.round(r.width));
    vh = Math.max(1, Math.round(r.height));
    cv.width = Math.round(vw * dpr);
    cv.height = Math.round(vh * dpr);
    if (cur && cur.work) {
      const z = zoomLevel();
      computeBase();
      if (z <= 1.02) fitView(); else { view.s = clampScale(base * z); clampView(); }
    }
    requestDraw();
  }
  const toImg = (p) => ({ x: (p.x - view.tx) / view.s, y: (p.y - view.ty) / view.s });
  function pos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function setPhoto(p) {
    clearTimeout(tapTimer); clearTimeout(g.holdT);
    cur = p; draft = null; S.sel = null; mode = 'none'; ptrs.clear(); locked = false; pz = null;
    if (cur && cur.work) {
      W = cur.work.width; H = cur.work.height; L = Math.max(W, H);
      if (!cur.hist) { cur.hist = [JSON.stringify(cur.annotations)]; cur.hIdx = 0; }
      fitView();
    }
    requestDraw(); notify();
  }

  function getUI() {
    const a = getSel();
    return {
      has: !!cur, tool: S.tool, c: S.c, w: S.w, d: S.d, s: S.s,
      colorHex: COLORS[S.c], colorName: COLOR_NAMES[S.c], widthName: WIDTH_NAMES[S.w],
      dashName: DASH_NAMES[S.d], sizeName: TEXT_NAMES[S.s], hasSel: !!a,
      canUndo: !!cur && !!cur.hist && cur.hIdx > 0,
      canRedo: !!cur && !!cur.hist && cur.hIdx < cur.hist.length - 1
    };
  }
  function notify() { if (cb.onState) cb.onState(getUI()); }
  function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }

  /* ---------- cronologia (undo/redo fino a 10 passi) ---------- */
  function commit() {
    const p = cur;
    p.hist.length = p.hIdx + 1;
    p.hist.push(JSON.stringify(p.annotations));
    if (p.hist.length > HIST_MAX + 1) p.hist.shift();
    p.hIdx = p.hist.length - 1;
    requestDraw(); notify();
    if (cb.onChange) cb.onChange();
  }
  function restore() {
    cur.annotations = JSON.parse(cur.hist[cur.hIdx]);
    if (S.sel && !findById(S.sel)) S.sel = null;
    requestDraw(); notify();
    if (cb.onChange) cb.onChange();
  }
  function undo() { if (cur && cur.hIdx > 0) { cur.hIdx--; restore(); } }
  function redo() { if (cur && cur.hist && cur.hIdx < cur.hist.length - 1) { cur.hIdx++; restore(); } }

  /* ---------- testo: layout e geometria ---------- */
  function layout(a, Lp) {
    const fs = TEXT_SIZES[a.s] * Lp;
    mctx.font = '600 ' + fs + 'px ' + FONT;
    const lines = String(a.text).split('\n');
    let tw = 0;
    for (const ln of lines) tw = Math.max(tw, mctx.measureText(ln).width);
    const pad = fs * 0.4, lh = fs * 1.25;
    return { fs, pad, lh, lines, w: tw + pad * 2, h: lines.length * lh + pad * 1.2 };
  }
  function corners(b) {
    return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  }
  function nearestCorner(box, t) {   // spigolo piu' vicino alla punta (distanza euclidea)
    let best = null, bd = Infinity;
    for (const c of corners(box)) { const d = dist(c, t); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  /* ---------- disegno oggetti ---------- */
  const dashFor = (i, w) => DASHES[i].map((v) => v * w / 4);

  function drawStroke(c, p1, p2, w, dashIdx, head, Lp) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len, uy = dy / len;
    let ex = p2.x, ey = p2.y, hl = 0;
    if (head) {
      hl = Math.min(Math.max(w * 4, Lp * 0.012), len * 0.9);
      ex = p2.x - ux * hl * 0.85; ey = p2.y - uy * hl * 0.85;
    }
    c.setLineDash(dashFor(dashIdx, w));
    c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(ex, ey); c.stroke();
    if (head) {                       // punta triangolare piena sul punto finale
      const hw = hl * 0.42;
      c.setLineDash([]);
      c.beginPath();
      c.moveTo(p2.x, p2.y);
      c.lineTo(p2.x - ux * hl - uy * hw, p2.y - uy * hl + ux * hw);
      c.lineTo(p2.x - ux * hl + uy * hw, p2.y - uy * hl - ux * hw);
      c.closePath(); c.fill();
    }
  }

  function drawText(c, a, Lp) {
    const b = layout(a, Lp);
    const box = { x: a.x, y: a.y, w: b.w, h: b.h };
    const w = WIDTHS[a.w] * Lp;
    const corner = nearestCorner(box, a.tip);
    if (dist(corner, a.tip) > b.fs * 0.3) {       // direttrice dallo spigolo piu' vicino
      c.strokeStyle = '#000'; c.fillStyle = '#000'; c.lineWidth = w;
      drawStroke(c, corner, a.tip, w, a.d, true, Lp);
    }
    c.setLineDash([]);
    c.fillStyle = '#fff'; c.fillRect(box.x, box.y, box.w, box.h);
    c.strokeStyle = '#000'; c.lineWidth = Math.max(Lp * 0.004, 1); c.lineJoin = 'miter';
    c.strokeRect(box.x, box.y, box.w, box.h);
    c.fillStyle = '#000'; c.font = '600 ' + b.fs + 'px ' + FONT;
    c.textBaseline = 'middle'; c.textAlign = 'left';
    b.lines.forEach((ln, i) => c.fillText(ln, box.x + b.pad, box.y + b.pad * 0.6 + b.lh * (i + 0.5)));
  }

  function drawAnn(c, a, Lp) {
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (a.type === 'line' || a.type === 'arrow') {
      const w = WIDTHS[a.w] * Lp;
      c.strokeStyle = COLORS[a.c]; c.fillStyle = COLORS[a.c]; c.lineWidth = w;
      drawStroke(c, a.p1, a.p2, w, a.d, a.type === 'arrow', Lp);
    } else if (a.type === 'free') {
      const w = WIDTHS[a.w] * Lp;
      c.strokeStyle = COLORS[a.c]; c.lineWidth = w; c.setLineDash(dashFor(a.d, w));
      c.beginPath();
      a.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      if (a.closed) c.closePath();
      c.stroke();
    } else if (a.type === 'text') {
      drawText(c, a, Lp);
    }
    c.restore();
  }

  /* ---------- selezione: alone e maniglie ---------- */
  function handlesOf(a) {
    if (a.type === 'line' || a.type === 'arrow') return [{ key: 'p1', p: a.p1 }, { key: 'p2', p: a.p2 }];
    if (a.type === 'text') return [{ key: 'tip', p: a.tip }];
    return [];
  }
  function drawHalo(c, a) {
    const k = 1 / view.s;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash([]);
    c.strokeStyle = 'rgba(0,150,255,0.6)';
    if (a.type === 'line' || a.type === 'arrow') {
      c.lineWidth = WIDTHS[a.w] * L + 18 * k;
      c.beginPath(); c.moveTo(a.p1.x, a.p1.y); c.lineTo(a.p2.x, a.p2.y); c.stroke();
    } else if (a.type === 'free') {
      c.lineWidth = WIDTHS[a.w] * L + 18 * k;
      c.beginPath();
      a.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      if (a.closed) c.closePath();
      c.stroke();
    } else if (a.type === 'text') {
      const b = layout(a, L);
      c.lineWidth = 6 * k; c.setLineDash([14 * k, 8 * k]);
      c.strokeRect(a.x - 8 * k, a.y - 8 * k, b.w + 16 * k, b.h + 16 * k);
      const corner = nearestCorner({ x: a.x, y: a.y, w: b.w, h: b.h }, a.tip);
      c.setLineDash([]); c.lineWidth = WIDTHS[a.w] * L + 18 * k;
      c.beginPath(); c.moveTo(corner.x, corner.y); c.lineTo(a.tip.x, a.tip.y); c.stroke();
    }
    c.restore();
  }
  function drawHandles(c, a) {
    const k = 1 / view.s;
    c.save();
    c.setLineDash([]);
    for (const h of handlesOf(a)) {
      c.beginPath(); c.arc(h.p.x, h.p.y, 12 * k, 0, Math.PI * 2);
      c.fillStyle = '#fff'; c.fill();
      c.lineWidth = 4 * k; c.strokeStyle = '#0078ff'; c.stroke();
    }
    c.restore();
  }

  function draw() {
    raf = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!cur || !cur.work) return;
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.tx, dpr * view.ty);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur.work, 0, 0);
    const sel = getSel();
    for (const a of cur.annotations) {
      if (a === sel) drawHalo(ctx, a);
      drawAnn(ctx, a, L);
    }
    if (draft) drawAnn(ctx, draft, L);
    if (sel && (S.tool === 'select' || S.tool === 'text')) drawHandles(ctx, sel);
  }

  /* ---------- hit-testing ---------- */
  function hitAnn(a, p, tol) {
    if (a.type === 'line' || a.type === 'arrow') {
      return distSeg(p, a.p1, a.p2) <= tol + WIDTHS[a.w] * L / 2;
    }
    if (a.type === 'free') {
      const n = a.pts.length, lim = tol + WIDTHS[a.w] * L / 2;
      for (let i = 0; i < n; i++) {
        if (distSeg(p, a.pts[i], a.pts[(i + 1) % n]) <= lim) return true;   // include il lato di chiusura
      }
      return false;
    }
    if (a.type === 'text') {
      const b = layout(a, L), s = tol * 0.4;
      if (p.x >= a.x - s && p.x <= a.x + b.w + s && p.y >= a.y - s && p.y <= a.y + b.h + s) return true;
      const c = nearestCorner({ x: a.x, y: a.y, w: b.w, h: b.h }, a.tip);
      return distSeg(p, c, a.tip) <= tol;
    }
    return false;
  }
  function hitTest(ip, onlyText) {
    const tol = HIT_TOL / view.s;
    for (let i = cur.annotations.length - 1; i >= 0; i--) {
      const a = cur.annotations[i];
      if (onlyText && a.type !== 'text') continue;
      if (hitAnn(a, ip, tol)) return a;
    }
    return null;
  }
  function hitHandle(a, ip) {
    const r = HANDLE_R / view.s;
    let best = null, bd = Infinity;
    for (const h of handlesOf(a)) { const d = dist(h.p, ip); if (d <= r && d < bd) { bd = d; best = h; } }
    return best;
  }
  function inTextBox(a, p) {
    const b = layout(a, L);
    return p.x >= a.x && p.x <= a.x + b.w && p.y >= a.y && p.y <= a.y + b.h;
  }

  function selectObj(a) {
    S.sel = a ? a.id : null;
    if (a) {                           // allinea i valori mostrati in barra a quelli dell'oggetto
      if (a.type !== 'text') S.c = a.c;
      S.w = a.w; S.d = a.d;
      if (a.type === 'text') S.s = a.s;
    }
    notify(); requestDraw();
  }

  /* ---------- gestione tocco ---------- */
  function onDown(e) {
    if (!cur || !cur.work) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
    ptrs.set(e.pointerId, pos(e));
    if (ptrs.size === 1 && !locked) startSingle(pos(e));
    else if (ptrs.size === 2) { abortSingle(); locked = true; startPinch(); }
  }

  function startSingle(sp) {
    const ip = toImg(sp);
    g = { start: sp, startT: performance.now(), moved: false, ip0: ip };
    const tool = S.tool;
    if (tool === 'select' || tool === 'text') {
      const sel = getSel();
      if (sel) {
        const h = hitHandle(sel, ip);
        if (h) {
          mode = 'handle'; g.h = h.key; g.backup = clone(sel);
          g.off = { x: h.p.x - ip.x, y: h.p.y - ip.y };
          return;
        }
      }
      const hit = hitTest(ip, tool === 'text');
      if (hit) {
        g.wasSel = hit.id === S.sel;
        g.obj = hit; g.backup = clone(hit);
        g.part = (hit.type === 'text' && inTextBox(hit, ip)) ? 'box' : 'all';
        mode = 'drag';
        selectObj(hit);
        return;
      }
      if (tool === 'select') { mode = 'empty'; g.panStart = { tx: view.tx, ty: view.ty }; }
      else mode = 'newtext';
      return;
    }
    // strumenti di disegno
    S.sel = null; notify();
    mode = 'draw';
    if (tool === 'free') {
      draft = { id: newId(), type: 'free', c: S.c, w: S.w, d: S.d, closed: false, pts: [ip] };
      g.segStart = 0; g.anchor = sp; armHold();
    } else {
      draft = { id: newId(), type: tool, c: S.c, w: S.w, d: S.d, p1: ip, p2: { x: ip.x, y: ip.y } };
    }
    requestDraw();
  }

  /* tenuta 0.5 s: il tratto percorso diventa un segmento perfettamente rettilineo */
  function armHold() { clearTimeout(g.holdT); g.holdT = setTimeout(onHold, HOLD_MS); }
  function onHold() {
    if (mode !== 'draw' || !draft || draft.type !== 'free') return;
    const n = draft.pts.length;
    if (n - 1 > g.segStart) {
      const endPt = draft.pts[n - 1];
      draft.pts.length = g.segStart + 1;
      draft.pts.push(endPt);
      g.segStart = draft.pts.length - 1;
      if (navigator.vibrate) navigator.vibrate(30);
      requestDraw();
    }
  }

  function startPinch() {
    const [a, b] = Array.from(ptrs.values());
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pz = { d0: Math.max(dist(a, b), 1), s0: view.s, ip0: toImg(m) };
    mode = 'pinch';
  }
  function updatePinch() {
    const [a, b] = Array.from(ptrs.values());
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const s = clampScale(pz.s0 * dist(a, b) / pz.d0);
    view.s = s; view.tx = m.x - pz.ip0.x * s; view.ty = m.y - pz.ip0.y * s;
    clampView(); requestDraw();
  }

  function abortSingle() {
    clearTimeout(g.holdT);
    if (mode === 'draw') draft = null;
    else if ((mode === 'drag' || mode === 'handle') && g.backup) {
      const i = cur.annotations.findIndex((a) => a.id === g.backup.id);
      if (i >= 0) cur.annotations[i] = clone(g.backup);
    }
    mode = 'none';
    requestDraw();
  }

  function applyDrag(ip) {
    const a = g.obj, b = g.backup, dx = ip.x - g.ip0.x, dy = ip.y - g.ip0.y;
    if (a.type === 'line' || a.type === 'arrow') {
      a.p1 = { x: b.p1.x + dx, y: b.p1.y + dy };
      a.p2 = { x: b.p2.x + dx, y: b.p2.y + dy };
    } else if (a.type === 'free') {
      a.pts = b.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else if (a.type === 'text') {
      a.x = b.x + dx; a.y = b.y + dy;
      if (g.part !== 'box') a.tip = { x: b.tip.x + dx, y: b.tip.y + dy };   // 'box': sposta solo la casella
    }
  }

  function onMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    const sp = pos(e);
    ptrs.set(e.pointerId, sp);
    if (mode === 'pinch') { if (ptrs.size >= 2 && pz) updatePinch(); return; }
    if (locked || mode === 'none') return;
    if (!g.moved && dist(sp, g.start) > TAP_MOVE) g.moved = true;

    if (mode === 'draw') {
      if (draft.type === 'free') {
        const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
        const list = evs.length ? evs : [e];
        for (const ev of list) {
          const q = toImg(pos(ev)), last = draft.pts[draft.pts.length - 1];
          if (dist(q, last) * view.s >= 1.5) draft.pts.push(q);
        }
        if (dist(sp, g.anchor) > HOLD_TOL) { g.anchor = sp; armHold(); }
      } else {
        draft.p2 = toImg(sp);
      }
      requestDraw();
    } else if (mode === 'drag') {
      if (g.moved) { applyDrag(toImg(sp)); requestDraw(); }
    } else if (mode === 'handle') {
      if (g.moved) {
        const a = getSel(), ip = toImg(sp);
        if (a) a[g.h] = { x: ip.x + g.off.x, y: ip.y + g.off.y };
        requestDraw();
      }
    } else if (mode === 'empty') {
      if (zoomLevel() > 1.05) {        // da zoomato: un dito su zona vuota sposta l'immagine
        view.tx = g.panStart.tx + (sp.x - g.start.x);
        view.ty = g.panStart.ty + (sp.y - g.start.y);
        clampView(); requestDraw();
      }
    }
  }

  function onUp(e) {
    if (!ptrs.has(e.pointerId)) return;
    const sp = pos(e);
    ptrs.delete(e.pointerId);
    if (mode === 'pinch') {
      if (ptrs.size === 0) { mode = 'none'; locked = false; pz = null; }
      return;
    }
    if (ptrs.size === 0) locked = false;
    if (locked) return;
    finishSingle(sp);
  }
  function onCancel(e) {
    ptrs.delete(e.pointerId);
    if (mode === 'pinch') { if (ptrs.size === 0) { mode = 'none'; locked = false; pz = null; } return; }
    abortSingle();
    if (ptrs.size === 0) locked = false;
  }

  function finishSingle(sp) {
    const m = mode;
    mode = 'none';
    if (m === 'draw') {
      clearTimeout(g.holdT);
      const d = draft; draft = null;
      if (!d) return;
      if (d.type !== 'free') d.p2 = toImg(sp);
      let ok = false;
      if (d.type === 'free') {
        let len = 0;
        for (let i = 1; i < d.pts.length; i++) len += dist(d.pts[i - 1], d.pts[i]);
        ok = d.pts.length >= 2 && len * view.s >= MIN_DRAW;
        if (ok) d.closed = true;       // chiusura automatica della forma al rilascio
      } else {
        ok = dist(d.p1, d.p2) * view.s >= MIN_DRAW;
      }
      if (ok) { cur.annotations.push(d); S.sel = d.id; commit(); } else requestDraw();
    } else if (m === 'drag') {
      if (g.moved) { commit(); return; }
      const a = g.obj, now = performance.now();
      if (a.type === 'text') {
        if (lastTap.id === a.id && now - lastTap.t < 300) {          // doppio tap: modifica testo
          clearTimeout(tapTimer); lastTap = { id: null, t: 0 };
          editText(a.id);
        } else {
          lastTap = { id: a.id, t: now };
          if (g.wasSel) {                                              // tap su testo selezionato: cambia taglia
            tapTimer = setTimeout(() => {
              const o = findById(a.id);
              if (o) { o.s = (o.s + 1) % TEXT_SIZES.length; S.s = o.s; commit(); }
            }, 300);
          }
        }
      } else if (g.wasSel) {                                           // tap su oggetto selezionato: cambia colore
        const o = findById(a.id);
        if (o) { o.c = (o.c + 1) % COLORS.length; S.c = o.c; commit(); }
      }
    } else if (m === 'handle') {
      if (g.moved) commit();
    } else if (m === 'empty') {
      if (!g.moved) {
        if (S.sel) { S.sel = null; notify(); requestDraw(); }          // tocco su zona vuota: deseleziona
      } else if (zoomLevel() <= 1.05) {
        const dx = sp.x - g.start.x, dy = sp.y - g.start.y;
        if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > 1.5 * Math.abs(dy) && cb.onSwipe) {
          cb.onSwipe(dx < 0 ? 1 : -1);                                 // sinistra = foto successiva
        }
      }
    } else if (m === 'newtext') {
      if (!g.moved) {
        const tip = g.ip0;
        askText('', (t) => { if (t && t.trim()) addText(t.replace(/\s+$/, ''), tip); });
      }
    }
  }

  function onWheel(e) {                // zoom con rotella (solo per prove da computer)
    if (!cur || !cur.work) return;
    e.preventDefault();
    const m = pos(e), ip = toImg(m);
    const s = clampScale(view.s * Math.exp(-e.deltaY * 0.0015));
    view.s = s; view.tx = m.x - ip.x * s; view.ty = m.y - ip.y * s;
    clampView(); requestDraw();
  }

  /* ---------- testo: creazione e modifica ---------- */
  function askText(initial, done) { if (cb.askText) cb.askText(initial, done); }
  function addText(text, tip) {
    const a = { id: newId(), type: 'text', text, s: S.s, w: S.w, d: S.d, x: 0, y: 0, tip: { x: tip.x, y: tip.y } };
    const b = layout(a, L), off = b.fs * 1.4;
    a.x = Math.min(Math.max(0, tip.x + off), Math.max(0, W - b.w));
    a.y = Math.min(Math.max(0, tip.y - off - b.h), Math.max(0, H - b.h));
    cur.annotations.push(a);
    S.sel = a.id;
    commit();
  }
  function editText(id) {
    const a = findById(id);
    if (!a) return;
    askText(a.text, (t) => {
      if (t === null || t === undefined) return;
      t = t.replace(/\s+$/, '');
      const o = findById(id);
      if (o && t && t !== o.text) { o.text = t; commit(); }
    });
  }

  /* ---------- comandi della barra strumenti ---------- */
  function toolTap(t) {
    if (!cur) return;
    if (S.tool === t && t !== 'select') {      // tocco ripetuto sullo strumento attivo
      if (t === 'text') cycleSize(); else cycleColor();
      return;
    }
    S.tool = t;
    if (t !== 'select') S.sel = null;
    draft = null; requestDraw(); notify();
  }
  function cycleColor() {
    if (!cur) return;
    S.c = (S.c + 1) % COLORS.length;
    const a = getSel();
    if (a && a.type !== 'text') { a.c = S.c; commit(); } else { requestDraw(); notify(); }
  }
  function cycleWidth() {
    if (!cur) return;
    S.w = (S.w + 1) % WIDTHS.length;
    const a = getSel();
    if (a) { a.w = S.w; commit(); } else notify();
  }
  function cycleDash() {
    if (!cur) return;
    S.d = (S.d + 1) % DASHES.length;
    const a = getSel();
    if (a) { a.d = S.d; commit(); } else notify();
  }
  function cycleSize() {
    if (!cur) return;
    S.s = (S.s + 1) % TEXT_SIZES.length;
    const a = getSel();
    if (a && a.type === 'text') { a.s = S.s; commit(); } else notify();
  }
  function deleteSel() {
    const a = getSel();
    if (!a) return;
    cur.annotations = cur.annotations.filter((o) => o.id !== a.id);
    S.sel = null;
    commit();
  }
  function resetView() { if (cur && cur.work) { fitView(); requestDraw(); } }

  /* ---------- esportazione: foto + annotazioni (senza alone/maniglie) ---------- */
  function renderExport(photo, maxSide) {
    const w = photo.work.width, h = photo.work.height, Lp = Math.max(w, h);
    const r = Math.min(1, maxSide / Lp);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * r));
    c.height = Math.max(1, Math.round(h * r));
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(photo.work, 0, 0, c.width, c.height);
    x.scale(c.width / w, c.height / h);
    for (const a of photo.annotations) drawAnn(x, a, Lp);
    return c;
  }

  global.Editor = {
    init, setPhoto, getUI, toolTap, cycleColor, cycleWidth, cycleDash, cycleSize,
    deleteSel, undo, redo, resetView, renderExport
  };
})(window);
