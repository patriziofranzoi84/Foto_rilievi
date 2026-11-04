/* app.js - logica dell'app: caricamento foto, navigazione, salvataggio _mid, condivisione, PDF */
(function () {
  'use strict';

  const MAX_WORK = 3200;     // lato lungo massimo dell'immagine di lavoro (px)
  const MAX_SAVE = 1600;     // lato lungo massimo dei file _mid (px) - usare 1920 per file piu' grandi
  const QUALITY = 0.75;      // qualita' JPEG dei file _mid

  const $ = (id) => document.getElementById(id);
  const photos = [];
  let idx = -1, dirHandle = null, token = 0, toastT = 0, busyT = 0, readyFile = null, textDone = null;
  const settings = { autosave: true };
  try {
    const s = JSON.parse(localStorage.getItem('fr_settings') || '{}');
    if (typeof s.autosave === 'boolean') settings.autosave = s.autosave;
  } catch (e) { /* ignora */ }
  const saveSettings = () => { try { localStorage.setItem('fr_settings', JSON.stringify(settings)); } catch (e) { /* ignora */ } };

  /* ---------- utilita' UI ---------- */
  const show = (id) => { $(id).hidden = false; };
  const hide = (id) => { $(id).hidden = true; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  function busy(on, msg) {             // overlay mostrato solo se l'operazione dura piu' di 150 ms
    clearTimeout(busyT);
    if (!on) { $('busy').hidden = true; return; }
    $('busyMsg').textContent = msg || '...';
    busyT = setTimeout(() => { $('busy').hidden = false; }, 150);
  }
  const cur = () => photos[idx] || null;
  const isDirty = (p) => JSON.stringify(p.annotations) !== p.savedJson;
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  function stamp() {
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes());
  }

  function refreshHeader() {
    const p = cur(), n = photos.length;
    $('indicator').textContent = p ? (isDirty(p) ? '\u25CF ' : '') + 'Foto ' + (idx + 1) + '/' + n + ' - ' + p.name : 'Nessuna foto';
    $('btnPrev').disabled = !p || idx <= 0;
    $('btnNext').disabled = !p || idx >= n - 1;
    $('btnSave').disabled = !p;
    $('app').classList.toggle('nophoto', !p);
  }

  const DASH_PREVIEW = ['none', '3 3', '7 3', '6 2 1 2'];
  const WIDTH_PREVIEW = [2, 4, 6, 9];
  function syncUI(st) {
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === st.tool));
    $('swatch').style.background = st.colorHex;
    $('wLabel').textContent = st.widthName;
    $('wLine').setAttribute('stroke-width', WIDTH_PREVIEW[st.w]);
    $('dLabel').textContent = st.dashName;
    $('dLine').setAttribute('stroke-dasharray', DASH_PREVIEW[st.d]);
    $('sizeBig').textContent = st.sizeName;
    $('tDel').disabled = !st.hasSel;
    $('pUndo').disabled = !st.canUndo;
    $('pRedo').disabled = !st.canRedo;
  }

  /* ---------- caricamento immagini ---------- */
  function mkPhoto(file) {
    return {
      file, name: file.name || ('foto_' + Date.now() + '.jpg'), lastModified: file.lastModified || 0,
      work: null, loading: null, annotations: [], hist: null, hIdx: 0, savedJson: '[]'
    };
  }

  function ensureWork(p) {             // decodifica la foto (EXIF applicato dal browser) in un canvas di lavoro
    if (p.work) return Promise.resolve(p.work);
    if (p.loading) return p.loading;
    p.loading = (async () => {
      const url = URL.createObjectURL(p.file);
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) throw new Error('immagine vuota');
        const r = Math.min(1, MAX_WORK / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * r));
        c.height = Math.max(1, Math.round(h * r));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        p.work = c;
        return c;
      } finally {
        URL.revokeObjectURL(url);
        p.loading = null;
      }
    })();
    return p.loading;
  }

  async function setPhotos(files, dir) {
    if (photos.some(isDirty) && !confirm('Ci sono modifiche non salvate. Aprire altre foto?')) return;
    const list = files.map(mkPhoto).sort((a, b) => (a.lastModified - b.lastModified) || a.name.localeCompare(b.name));
    if (!list.length) { toast('Nessuna foto selezionata'); return; }
    photos.forEach((p) => { p.work = null; });
    photos.length = 0;
    list.forEach((p) => photos.push(p));
    idx = -1;
    dirHandle = dir || null;
    await goTo(photos.length - 1);         // apre subito l'ultima foto (la piu' recente)
  }

  async function goTo(i) {
    if (i < 0 || i >= photos.length || i === idx) return;
    const my = ++token;
    const prev = cur();
    if (prev && settings.autosave && isDirty(prev)) {
      try { busy(true, 'Salvataggio...'); await saveOne(prev, true); }
      catch (e) { console.error(e); toast('Salvataggio automatico non riuscito'); }
    }
    const p = photos[i];
    busy(true, 'Caricamento...');
    try { await ensureWork(p); }
    catch (e) { console.error(e); busy(false); toast('Impossibile aprire ' + p.name); return; }
    busy(false);
    if (my !== token) return;
    idx = i;
    Editor.setPhoto(p);
    refreshHeader();
    photos.forEach((q, j) => { if (Math.abs(j - idx) > 1) q.work = null; });     // libera memoria
    [i - 1, i + 1].forEach((j) => { if (photos[j]) ensureWork(photos[j]).catch(() => {}); });
  }

  async function openDir() {
    try {
      const dh = await window.showDirectoryPicker({ mode: 'readwrite' });
      const files = [];
      for await (const [name, h] of dh.entries()) {
        if (h.kind === 'file' && /\.(jpe?g|png|webp)$/i.test(name) && !/_mid\.[^.]+$/i.test(name)) {
          files.push(await h.getFile());
        }
      }
      if (!files.length) { toast('Nessuna foto nella cartella'); return; }
      await setPhotos(files, dh);
    } catch (e) {
      if (e && e.name !== 'AbortError') { console.error(e); toast('Impossibile aprire la cartella'); }
    }
  }

  /* ---------- salvataggio _mid ---------- */
  function midName(name) {
    let b = name.replace(/\.[^.\/\\]+$/, '');
    if (!/_mid$/i.test(b)) b += '_mid';
    return b + '.jpg';
  }
  function toBlob(canvas) {
    return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', QUALITY));
  }
  async function renderJpeg(p) {       // foto + annotazioni, ridotta e compressa
    await ensureWork(p);
    const c = Editor.renderExport(p, MAX_SAVE);
    return { blob: await toBlob(c), w: c.width, h: c.height };
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
  }

  async function saveOne(p, silent) {
    const snap = JSON.stringify(p.annotations);
    const r = await renderJpeg(p);
    const name = midName(p.name);
    let where = 'download';
    if (dirHandle) {
      try {
        const fh = await dirHandle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(r.blob);
        await w.close();
        where = 'cartella';
      } catch (e) { console.warn('Scrittura in cartella non riuscita, uso il download', e); }
    }
    if (where === 'download') downloadBlob(r.blob, name);
    p.savedJson = snap;
    refreshHeader();
    if (!silent) toast((where === 'cartella' ? 'Salvata nella cartella: ' : 'File scaricato: ') + name + ' (' + fmtSize(r.blob.size) + ')');
    return where;
  }

  async function saveCurrent() {
    const p = cur();
    if (!p) return;
    busy(true, 'Salvataggio...');
    try { await saveOne(p, false); }
    catch (e) { console.error(e); toast('Salvataggio non riuscito'); }
    busy(false);
  }

  async function saveAll() {
    hide('menuDlg');
    const list = photos.filter(isDirty);
    if (!list.length) { toast('Nessuna modifica da salvare'); return; }
    let n = 0;
    for (const p of list) {
      busy(true, 'Salvo ' + (n + 1) + '/' + list.length + '...');
      try { await saveOne(p, true); n++; } catch (e) { console.error(e); toast('Errore su ' + p.name); }
      if (!dirHandle) await sleep(300);
    }
    busy(false);
    toast('Salvate ' + n + ' foto');
  }

  /* ---------- condivisione (menu di condivisione del telefono: Telegram, ecc.) ---------- */
  const canShare = (f) => !!(navigator.canShare && navigator.share && navigator.canShare({ files: [f] }));

  function showReady(file) {
    readyFile = file;
    $('readyInfo').textContent = file.name + ' - ' + fmtSize(file.size);
    $('readyShare').hidden = !canShare(file);
    show('readyDlg');
  }

  async function shareCurrent() {
    hide('menuDlg');
    const p = cur();
    if (!p) { toast('Nessuna foto'); return; }
    let file;
    busy(true, 'Preparo la foto...');
    try {
      const r = await renderJpeg(p);
      file = new File([r.blob], midName(p.name), { type: 'image/jpeg' });
    } catch (e) { console.error(e); busy(false); toast('Errore nella preparazione'); return; }
    busy(false);
    if (!canShare(file)) { toast('Condivisione non supportata: puoi salvare il file'); showReady(file); return; }
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      showReady(file);                  // se il browser richiede un nuovo tocco, riprova da qui
    }
  }

  /* ---------- PDF ---------- */
  function openPdfDlg() {
    hide('menuDlg');
    if (!photos.length) { toast('Nessuna foto'); return; }
    const list = $('pdfList');
    list.innerHTML = '';
    photos.forEach((p, i) => {
      const lab = document.createElement('label');
      lab.className = 'pitem';
      const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = true; c.dataset.i = i;
      const s = document.createElement('span');
      s.textContent = (i + 1) + '. ' + p.name + (p.annotations.length ? '  \u270E' : '');
      lab.append(c, s);
      list.appendChild(lab);
    });
    $('pdfInfo').textContent = '';
    show('pdfDlg');
  }

  async function makePdf() {
    const sel = Array.from($('pdfList').querySelectorAll('input:checked')).map((c) => +c.dataset.i);
    if (!sel.length) { toast('Seleziona almeno una foto'); return; }
    $('pdfGo').disabled = true;
    try {
      const pages = [];
      for (let k = 0; k < sel.length; k++) {
        const p = photos[sel[k]];
        $('pdfInfo').textContent = 'Elaboro foto ' + (k + 1) + ' di ' + sel.length + '...';
        const r = await renderJpeg(p);
        pages.push({ bytes: new Uint8Array(await r.blob.arrayBuffer()), w: r.w, h: r.h });
        if (Math.abs(sel[k] - idx) > 1) p.work = null;       // libera memoria
        await sleep(0);
      }
      const blob = Pdf.build(pages);
      const file = new File([blob], 'Foto_rilievi_' + stamp() + '.pdf', { type: 'application/pdf' });
      hide('pdfDlg');
      showReady(file);
    } catch (e) {
      console.error(e);
      toast('Errore nella creazione del PDF');
    } finally {
      $('pdfGo').disabled = false;
      $('pdfInfo').textContent = '';
    }
  }

  /* ---------- dialogo testo ---------- */
  function askText(initial, done) {
    textDone = done;
    $('textInput').value = initial || '';
    show('textDlg');
    setTimeout(() => {
      const t = $('textInput');
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    }, 60);
  }

  /* ---------- icona per la schermata Home (iOS legge apple-touch-icon) ---------- */
  function makeAppleIcon() {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 180;
      const x = c.getContext('2d'), k = 180 / 512;
      x.scale(k, k);
      x.fillStyle = '#0d0f11'; x.fillRect(0, 0, 512, 512);
      x.strokeStyle = '#FFD600'; x.lineWidth = 44; x.lineCap = 'round';
      x.beginPath(); x.moveTo(130, 382); x.lineTo(300, 212); x.stroke();
      x.fillStyle = '#FFD600';
      x.beginPath(); x.moveTo(390, 122); x.lineTo(347.5, 249.3); x.lineTo(262.7, 164.5); x.closePath(); x.fill();
      x.strokeStyle = '#fff'; x.lineWidth = 18; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(96, 150); x.lineTo(96, 96); x.lineTo(150, 96);
      x.moveTo(416, 362); x.lineTo(416, 416); x.lineTo(362, 416); x.stroke();
      $('appleIcon').href = c.toDataURL('image/png');
    } catch (e) { /* ignora */ }
  }

  /* ---------- collegamento dei pulsanti ---------- */
  function wire() {
    const fileInput = $('fileInput');
    const openFiles = () => fileInput.click();
    $('btnOpen').addEventListener('click', openFiles);
    $('bigOpen').addEventListener('click', openFiles);
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (files.length) setPhotos(files, null);
    });
    if (window.showDirectoryPicker) {
      $('bigDir').hidden = false; $('mDir').hidden = false;
      $('bigDir').addEventListener('click', openDir);
      $('mDir').addEventListener('click', () => { hide('menuDlg'); openDir(); });
    }

    $('btnPrev').addEventListener('click', () => goTo(idx - 1));
    $('btnNext').addEventListener('click', () => goTo(idx + 1));
    $('btnSave').addEventListener('click', saveCurrent);
    $('btnMenu').addEventListener('click', () => show('menuDlg'));

    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => Editor.toolTap(b.dataset.tool)));
    $('tDel').addEventListener('click', () => Editor.deleteSel());
    $('pColor').addEventListener('click', () => Editor.cycleColor());
    $('pWidth').addEventListener('click', () => Editor.cycleWidth());
    $('pDash').addEventListener('click', () => Editor.cycleDash());
    $('pSize').addEventListener('click', () => Editor.cycleSize());
    $('pUndo').addEventListener('click', () => Editor.undo());
    $('pRedo').addEventListener('click', () => Editor.redo());
    $('pReset').addEventListener('click', () => Editor.resetView());

    // menu
    $('mSaveAll').addEventListener('click', saveAll);
    $('mShare').addEventListener('click', shareCurrent);
    $('mPdf').addEventListener('click', openPdfDlg);
    $('mSettings').addEventListener('click', () => {
      hide('menuDlg');
      $('setAuto').checked = settings.autosave;
      $('setInfo').textContent = dirHandle
        ? 'I file _mid vengono salvati nella cartella aperta (nome originale + _mid.jpg).'
        : 'I file _mid vengono scaricati sul telefono (cartella Download). Alla riapertura di una foto gia\u0027 salvata il browser puo\u0027 aggiungere un numero al nome.';
      show('setDlg');
    });
    $('mClose').addEventListener('click', () => hide('menuDlg'));
    $('setAuto').addEventListener('change', () => { settings.autosave = $('setAuto').checked; saveSettings(); });
    $('setClose').addEventListener('click', () => hide('setDlg'));

    // PDF
    $('pdfAll').addEventListener('click', () => $('pdfList').querySelectorAll('input').forEach((c) => { c.checked = true; }));
    $('pdfNone').addEventListener('click', () => $('pdfList').querySelectorAll('input').forEach((c) => { c.checked = false; }));
    $('pdfCancel').addEventListener('click', () => hide('pdfDlg'));
    $('pdfGo').addEventListener('click', makePdf);

    // file pronto
    $('readyShare').addEventListener('click', async () => {
      try { await navigator.share({ files: [readyFile], title: readyFile.name }); }
      catch (e) { if (!e || e.name !== 'AbortError') toast('Condivisione non riuscita'); }
    });
    $('readySave').addEventListener('click', () => { if (readyFile) downloadBlob(readyFile, readyFile.name); });
    $('readyClose').addEventListener('click', () => { hide('readyDlg'); readyFile = null; });

    // testo
    $('textOk').addEventListener('click', () => {
      const v = $('textInput').value, f = textDone;
      hide('textDlg'); textDone = null;
      if (f) f(v);
    });
    $('textCancel').addEventListener('click', () => { hide('textDlg'); textDone = null; });

    // tocco sullo sfondo scuro chiude i dialoghi (tranne il testo)
    ['menuDlg', 'setDlg', 'readyDlg', 'pdfDlg'].forEach((id) => {
      $(id).addEventListener('click', (e) => { if (e.target === $(id)) hide(id); });
    });

    window.addEventListener('beforeunload', (e) => {
      if (photos.some(isDirty)) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ---------- avvio ---------- */
  Editor.init($('cv'), $('stage'), {
    onChange: refreshHeader,
    onState: syncUI,
    onSwipe: (d) => goTo(idx + d),
    askText: askText
  });
  wire();
  syncUI(Editor.getUI());
  refreshHeader();
  makeAppleIcon();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
