/* pdf.js - generatore PDF minimale, senza librerie esterne.
   Una foto (JPEG) per pagina A4; l'orientamento della pagina segue quello della foto. */
(function (global) {
  'use strict';

  const A4W = 595.28, A4H = 841.89, MARGIN = 24;     // punti PDF (1 pt = 1/72 pollice)

  /* pages: [{ bytes: Uint8Array (JPEG), w: larghezza px, h: altezza px }] -> Blob application/pdf */
  function build(pages) {
    const enc = new TextEncoder();
    const parts = [], offs = [];
    let pos = 0;
    const add = (x) => {
      const u = typeof x === 'string' ? enc.encode(x) : x;
      parts.push(u); pos += u.length;
    };
    const f = (v) => v.toFixed(2);
    const n = pages.length;

    // intestazione: %PDF-1.4 + commento binario
    add(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    offs[1] = pos;
    add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    const kids = [];
    for (let i = 0; i < n; i++) kids.push((3 + 3 * i) + ' 0 R');
    offs[2] = pos;
    add('2 0 obj\n<< /Type /Pages /Kids [ ' + kids.join(' ') + ' ] /Count ' + n + ' >>\nendobj\n');

    for (let i = 0; i < n; i++) {
      const pg = pages[i];
      const land = pg.w > pg.h;
      const PW = land ? A4H : A4W, PH = land ? A4W : A4H;
      const k = Math.min((PW - 2 * MARGIN) / pg.w, (PH - 2 * MARGIN) / pg.h);
      const dw = pg.w * k, dh = pg.h * k;
      const x = (PW - dw) / 2, y = (PH - dh) / 2;
      const po = 3 + 3 * i, co = po + 1, io = po + 2;

      offs[po] = pos;
      add(po + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(PW) + ' ' + f(PH) + '] ' +
        '/Resources << /XObject << /Im0 ' + io + ' 0 R >> >> /Contents ' + co + ' 0 R >>\nendobj\n');

      const content = 'q ' + f(dw) + ' 0 0 ' + f(dh) + ' ' + f(x) + ' ' + f(y) + ' cm /Im0 Do Q\n';
      offs[co] = pos;
      add(co + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');

      offs[io] = pos;
      add(io + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pg.w + ' /Height ' + pg.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.bytes.length +
        ' >>\nstream\n');
      add(pg.bytes);
      add('\nendstream\nendobj\n');
    }

    const total = 2 + 3 * n;
    const xrefPos = pos;
    let x = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    x += 'trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
    add(x);

    return new Blob(parts, { type: 'application/pdf' });
  }

  global.Pdf = { build };
})(window);
