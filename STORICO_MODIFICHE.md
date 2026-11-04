# STORICO MODIFICHE - Foto rilievi

## 2026-11-04 - Creazione iniziale (editor foto con annotazioni)
Specifica: `- Progetto\1 - base tipo.txt`. Estensioni richieste: PDF e condivisione (menu del telefono, es. Telegram). pCloud escluso per ora.

- Fase 1: `index.html`, `style.css`, `manifest.json`, `sw.js`, `icon.svg` (UI mobile-first, PWA, cache offline).
- Fase 2: `editor.js` (canvas, pinch/pan, frecce, linee, mano libera con tenuta 0,5 s e chiusura automatica, testo con direttrice allo spigolo piu' vicino, selezione/hit-test, colore/spessore/tratteggio/dimensione testo ciclici, undo/redo 10 passi, esportazione).
- Fase 3: `pdf.js` (PDF minimale, una foto per pagina A4, orientamento segue la foto).
- Fase 4: `app.js` (apertura foto/cartella, ordinamento per data e apertura dell'ultima, swipe, salvataggio `_mid.jpg` lato lungo 1600 px JPEG 0.75, condivisione, PDF, impostazioni).

Scelte non presenti nella specifica (da confermare):
- File dell'app nella radice di `7_Foto rilievi`.
- Pulsanti ‹ › nella barra alta per scorrere le foto, oltre allo swipe.
- Il pulsante Colore cicla i colori come il tocco ripetuto sullo strumento.
- Con "Apri cartella" le foto gia' `_mid` vengono ignorate.
- Impostazione unica: salvataggio automatico al cambio foto (attivo di default).
- Icona dell'app in SVG; per iOS l'icona viene generata a runtime.
- Le annotazioni non vengono ricaricate dopo la chiusura: il risultato e' il file `_mid.jpg`.
