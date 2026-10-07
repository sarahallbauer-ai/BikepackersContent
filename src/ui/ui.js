// Schlanke UI: Toolbar (Format, Undo/Redo, Safe, +Slide, Export), Thumbnail-Streifen
// mit Drag-Reorder + Hover-Aktionen, und eine Asset-Leiste unten als Drag-Quelle.
// KEIN Inspector, KEIN JSON — alles passiert direkt auf der Slide.

import { FORMATS } from '../model/formats.js';
import { LAYOUTS } from '../model/layouts.js';
import { assetsByType, loadAssetImage, getAsset, getLoadedImage, preloadDeckAssets, registerCustomAsset } from '../model/assets.js';
import { generateDeck, MODELS, DEFAULT_MODEL } from '../ai/generate.js';
import { TEXT_COLORS, DEFAULT_TEXT_COLOR } from '../model/brand.js';
import { EXAMPLE_DECK } from '../model/example-deck.js';
import { removeBackground } from '../render/bg-remove.js';
import { OffscreenRenderer } from '../export/offscreen.js';
import { exportCurrentPNG, exportAllPNG } from '../export/png.js';
import { exportPDF } from '../export/pdf.js';
import { exportMP4, mp4Supported } from '../export/mp4.js';

export class UI {
  constructor(store, renderer, inlineEditor, folder) {
    this.store = store;
    this.renderer = renderer;
    this.inlineEditor = inlineEditor;
    this.folder = folder || { backgrounds: [], overlays: [], artwork: [] };
    this.thumbRenderer = new OffscreenRenderer();
    this._dragFrom = null;
    this._lastSlide = store.slideIndex;

    this._bindToolbar();
    this._bindTimeline();
    this._bindTray();
    this._bindFontSize();

    renderer.onEditText = (field) => this.inlineEditor.open(field);
    renderer.onFrame = (t, dur) => this._syncTime(t, dur);
    renderer.enableAssetDrop((kind, id) => {
      if (kind === 'bg') store.setBackground(id);
      else if (kind === 'overlay') store.setOverlay(id, getAsset(id));
    });
    // (Elemente-Upload/Datei-Drop vorerst deaktiviert — nur Gradient + DNA)
    this._bindSelectionUI();
    this._bindContextMenu();
    this._bindDeckMenu();
    this._bindGenerate();
    this._bindReset();

    store.on('deck', () => {
      this.renderThumbs();
      this._syncToolbar();
      if (!this.renderer.playing) {
        if (this._lastSlide !== store.slideIndex) { this._lastSlide = store.slideIndex; this.scrub.value = 0; }
        this._updateTimeLabel();
      }
    });
    store.on('format', () => { this._syncToolbar(); this.renderer.fit(); this.renderThumbs(); });

    this.renderThumbs();
    this._syncToolbar();
  }

  // ---- Toolbar ----------------------------------------------------------
  _bindToolbar() {
    const fmtSel = document.getElementById('formatSelect');
    const groups = {};
    Object.values(FORMATS).forEach((f) => { (groups[f.group] ||= []).push(f); });
    fmtSel.innerHTML = Object.entries(groups).map(([g, list]) =>
      `<optgroup label="${g}">` + list.map((f) => `<option value="${f.id}">${f.label}</option>`).join('') + '</optgroup>'
    ).join('');
    fmtSel.value = this.store.format;
    fmtSel.onchange = () => this.store.setFormat(fmtSel.value);

    const layoutSel = document.getElementById('layoutSelect');
    layoutSel.innerHTML = Object.values(LAYOUTS)
      .map((l) => `<option value="${l.id}">${l.label}</option>`)
      .join('');
    layoutSel.value = this.store.slide.layout || 'text-bottom';
    layoutSel.onchange = () => this.store.updateSlide({ layout: layoutSel.value }, 'layout');
    const safeBtn = document.getElementById('safeBtn');
    safeBtn.classList.toggle('active', this.renderer.showSafe);   // Startzustand spiegeln
    safeBtn.onclick = (e) => {
      const on = !this.renderer.showSafe;
      this.renderer.setSafeZones(on);
      e.currentTarget.classList.toggle('active', on);
    };

    // Seitenübersicht ein-/ausklappen (Desktop: Spalte, Mobil: Overlay)
    const app = document.querySelector('.app');
    if (window.innerWidth > 640) app.classList.add('thumbs-open');
    const tt = document.getElementById('thumbsToggle');
    tt.classList.toggle('active', app.classList.contains('thumbs-open'));
    tt.onclick = () => { const on = app.classList.toggle('thumbs-open'); tt.classList.toggle('active', on); };

    // Hilfe-Popover
    const helpBtn = document.getElementById('helpBtn');
    const helpMenu = document.getElementById('helpMenu');
    helpBtn.onclick = (e) => { e.stopPropagation(); helpMenu.classList.toggle('open'); };
    document.addEventListener('click', () => helpMenu.classList.remove('open'));

    // Export als einzelnes Kontextmenü
    const btn = document.getElementById('exportBtn');
    const menu = document.getElementById('exportMenu');
    btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    document.addEventListener('click', () => menu.classList.remove('open'));
    if (!mp4Supported()) {
      const v = menu.querySelector('[data-export="mp4"]');
      v.disabled = true; v.title = 'WebCodecs nötig (Chrome/Edge)';
    }
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-export]'); if (!b || b.disabled) return;
      menu.classList.remove('open');
      const k = b.dataset.export;
      if (k === 'png') this._run('PNG', () => exportCurrentPNG(this.store));
      else if (k === 'png-all') this._run('PNG-Set', (p) => exportAllPNG(this.store, p));
      else if (k === 'pdf') this._run('PDF', (p) => exportPDF(this.store, p));
      else if (k === 'mp4') this._run('Video', (p) => exportMP4(this.store, { onProgress: p }));
    });
  }
  _syncToolbar() {
    const fs = document.getElementById('formatSelect');
    if (fs) fs.value = this.store.format;
    const ls = document.getElementById('layoutSelect');
    if (ls) ls.value = this.store.slide.layout || 'text-bottom';
  }

  _bindFontSize() {
    const smaller = document.getElementById('fontSmaller');
    const larger = document.getElementById('fontLarger');
    if (smaller) smaller.onclick = () => this.store.adjustFontSize(-4);
    if (larger) larger.onclick = () => this.store.adjustFontSize(4);
  }

  // ---- Timeline ---------------------------------------------------------
  _bindTimeline() {
    this.playBtn = document.getElementById('playBtn');
    this.scrub = document.getElementById('scrub');
    this.timeLabel = document.getElementById('timeLabel');
    this.playBtn.onclick = () => {
      if (this.renderer.playing) { this.renderer.pause(); this.playBtn.textContent = '▶'; }
      else { this.renderer.play(); this.playBtn.textContent = '⏸'; }
    };
    this.scrub.oninput = () => {
      if (this.renderer.playing) { this.renderer.pause(); this.playBtn.textContent = '▶'; }
      const dur = this.renderer.slideDuration();
      const t = (this.scrub.value / 1000) * dur;
      this.renderer.seek(t); this._syncTime(t, dur);
    };
    this._updateTimeLabel();   // Startzustand: 0.0 / Gesamtdauer
  }
  _syncTime(t, dur) {
    this.scrub.value = Math.round((t / dur) * 1000);
    this.timeLabel.textContent = `${t.toFixed(1)} / ${dur.toFixed(1)}s`;
  }
  // Zeigt aktuelle Position / Gesamtdauer der Slide-Animation.
  _updateTimeLabel() {
    const dur = this.renderer.slideDuration();
    const t = (this.scrub.value / 1000) * dur;
    this.timeLabel.textContent = `${t.toFixed(1)} / ${dur.toFixed(1)}s`;
  }

  // ---- Thumbnails (Drag-Reorder + Hover-Aktionen) ----------------------
  renderThumbs() {
    const wrap = document.getElementById('thumbs');
    wrap.innerHTML = '';
    this.store.deck.slides.forEach((slide, i) => {
      const el = document.createElement('div');
      el.className = 'thumb' + (i === this.store.slideIndex ? ' active' : '');
      el.draggable = true;
      const url = this.thumbRenderer.thumbDataURL(slide, this.store.deck, this.store.format, 150);
      el.innerHTML = `<span class="thumb-idx">${i + 1}</span>
        <img src="${url}" alt="">
        <div class="thumb-actions">
          <button data-dup title="Duplizieren">⧉</button>
          <button data-del title="Löschen">✕</button>
        </div>`;
      el.onclick = (e) => {
        if (e.target.closest('button')) return;
        this.store.goTo(i);
        if (window.innerWidth <= 640) document.querySelector('.app').classList.remove('thumbs-open');
      };
      el.querySelector('[data-dup]').onclick = (e) => { e.stopPropagation(); this._dupSlide(i); };
      el.querySelector('[data-del]').onclick = (e) => { e.stopPropagation(); this._delSlide(i); };
      el.ondragstart = (e) => { this._dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'slide'); };
      el.ondragover = (e) => { e.preventDefault(); el.classList.add('drop'); };
      el.ondragleave = () => el.classList.remove('drop');
      el.ondrop = (e) => {
        e.preventDefault(); el.classList.remove('drop');
        if (this._dragFrom != null && this._dragFrom !== i) this.store.reorderSlides(this._dragFrom, i);
        this._dragFrom = null;
      };
      wrap.appendChild(el);
    });

    const add = document.createElement('button');
    add.className = 'thumb-add'; add.textContent = '+'; add.title = 'Neue Folie';
    add.onclick = () => this._addSlide();
    wrap.appendChild(add);
  }

  // ---- Asset-Leiste (Drag-Quelle + Klick) ------------------------------
  _bindTray() {
    // Drei öffnenbare Menüs: Hintergrund / Overlay / Artwork
    this._buildPicker('background', 'background', 'backgrounds', { onPick: (id) => this.store.setBackground(id) });
    this._buildPicker('overlay', 'overlay', 'overlays', { none: true, onPick: (id) => this.store.setOverlay(id, id ? getAsset(id) : null) });
    this._buildPicker('artwork', 'decor', 'artwork', { art: true, onPick: async (id) => {
      await loadAssetImage(id);            // Bild bereitstellen, dann als Element einfügen
      this.store.addDecor(id, 0.5, 0.5);
    } });

    document.querySelectorAll('.picker-btn').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const panel = document.getElementById('panel-' + btn.dataset.cat);
        const wasOpen = panel.classList.contains('open');
        this._closePickers();
        if (!wasOpen) panel.classList.add('open');
      };
    });
    document.addEventListener('click', () => this._closePickers());

    // Textfarbe: Marken-Swatches + eigener Farbwähler
    const txtWrap = document.getElementById('trayText');
    if (txtWrap) {
      txtWrap.innerHTML = TEXT_COLORS.map((c) =>
        `<button class="chip color" data-hex="${c.hex}" title="${c.id}" style="background:${c.hex}"></button>`).join('')
        + `<label class="chip color custom" title="Eigene Farbe"><input type="color" id="txtCustom"></label>`;
      txtWrap.addEventListener('click', (e) => {
        const c = e.target.closest('.chip.color'); if (c && c.dataset.hex) this.store.setTextColor(c.dataset.hex);
      });
      const custom = txtWrap.querySelector('#txtCustom');
      custom.value = DEFAULT_TEXT_COLOR;
      custom.oninput = () => { this.store.applyTextColor(custom.value); this.store.touch(); this.renderer.rebuild(); };
      custom.onchange = () => this.store.commit('textcolor');
    }
  }

  // Baut ein Asset-Menü (scrollbares Raster) für eine Kategorie.
  _buildPicker(cat, assetType, folderName, opts = {}) {
    const panel = document.getElementById('panel-' + cat);
    if (!panel) return;
    const items = assetsByType(assetType);
    let grid = '<div class="picker-grid">';
    // Eigene Dateien hinzufügen (nur in dieser Sitzung, nichts wird gespeichert)
    grid += `<label class="picker-item upload" title="Eigene Dateien hinzufügen – nur in dieser Sitzung"><span>+</span><input type="file" accept="image/*" multiple hidden></label>`;
    if (opts.none) grid += `<button class="picker-item none" data-none title="keine">&#8709;</button>`;
    items.forEach((a) => {
      const cls = 'picker-item' + (opts.art ? ' art' : ' cover');
      grid += `<button class="${cls}" data-id="${a.id}" title="${a.label || ''}"><img src="${a.src}" loading="lazy" alt=""></button>`;
    });
    grid += '</div>';
    panel.innerHTML = grid;

    const fileInput = panel.querySelector('.upload input[type=file]');
    if (fileInput) fileInput.onchange = () => {
      this._addUploadedAssets(cat, assetType, folderName, opts, fileInput.files);
      fileInput.value = '';                       // gleiche Datei erneut wählbar
    };

    panel.onclick = (e) => {
      if (e.target.closest('.picker-item.upload')) { e.stopPropagation(); return; }  // Datei-Dialog macht das <label>
      const it = e.target.closest('.picker-item'); if (!it) return;
      opts.onPick(it.dataset.none !== undefined ? null : it.dataset.id);
      this._closePickers();
    };
  }
  // Eigene Assets aus Dateien registrieren – nur im Speicher (blob:), weg beim Neuladen/Schließen.
  async _addUploadedAssets(cat, assetType, folderName, opts, fileList) {
    const files = [...(fileList || [])].filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    const prefix = assetType === 'background' ? 'bg' : assetType === 'overlay' ? 'ov' : 'art';
    const extra = assetType === 'overlay' ? { blend: 'source-over', defaultOpacity: 0.45 }
                : assetType === 'decor'   ? { transparent: true } : {};
    const ids = [];
    for (const f of files) {
      this._uploadSeq = (this._uploadSeq || 0) + 1;
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const id = `${prefix}-up-${this._uploadSeq}-${base}`;
      registerCustomAsset({ id, type: assetType, src: URL.createObjectURL(f), label: f.name.replace(/\.[^.]+$/, ''), external: true, uploaded: true, ...extra });
      ids.push(id);
    }
    await Promise.all(ids.map((id) => loadAssetImage(id)));
    // Hochgeladene Hintergründe/Overlays auch fürs Auto-Belegen beim Deck-Import verfügbar machen.
    if (this.folder[folderName]) this.folder[folderName].push(...ids);
    this._buildPicker(cat, assetType, folderName, opts);
    document.getElementById('panel-' + cat)?.classList.add('open');
    this._toast(`${ids.length} ${ids.length === 1 ? 'Datei' : 'Dateien'} hinzugefügt`, 'success');
  }
  _closePickers() {
    document.querySelectorAll('.picker-panel.open').forEach((p) => p.classList.remove('open'));
  }

  // ---- Auswahl: schwebender Lösch-Button --------------------------------
  _bindSelectionUI() {
    const btn = document.createElement('button');
    btn.className = 'elem-delete';
    btn.title = 'Element entfernen (oder Entf-Taste)';
    btn.textContent = '✕';
    btn.style.display = 'none';
    document.body.appendChild(btn);
    this.delBtn = btn;

    btn.onmousedown = (e) => e.preventDefault();   // Auswahl nicht verlieren
    btn.onclick = () => {
      const sel = this.store.selection;
      if (sel?.kind === 'decor') this.store.removeDecor(sel.id);
      else if (sel?.kind === 'logo') { this.store.deck.brand.show = false; this.store.selection = null; this.store.commit('logo-hide'); }
    };

    // Background-Eraser (nur für Artwork/Decor)
    const erase = document.createElement('button');
    erase.className = 'elem-erase';
    erase.title = 'Hintergrund entfernen';
    erase.innerHTML = '<svg width="13" height="13" viewBox="0 0 12 12"><rect x="0" y="0" width="6" height="6" fill="currentColor"/><rect x="6" y="6" width="6" height="6" fill="currentColor"/></svg>';
    erase.style.display = 'none';
    document.body.appendChild(erase);
    this.eraseBtn = erase;
    erase.onmousedown = (e) => e.preventDefault();
    erase.onclick = () => this._eraseBackground();

    this.renderer.onSelectionRect = (rect, kind) => {
      if (!rect || (kind !== 'decor' && kind !== 'logo')) { btn.style.display = 'none'; erase.style.display = 'none'; return; }
      btn.style.display = 'flex';
      btn.style.left = (rect.left + rect.width - 12) + 'px';
      btn.style.top = (rect.top - 14) + 'px';
      if (kind === 'decor') {
        erase.style.display = 'flex';
        erase.style.left = (rect.left + rect.width - 42) + 'px';
        erase.style.top = (rect.top - 14) + 'px';
      } else { erase.style.display = 'none'; }
    };
  }

  // Rechtsklick-Kontextmenü für Artwork: Ebene ändern / entfernen.
  _bindContextMenu() {
    const m = document.createElement('div');
    m.className = 'ctx-menu';
    m.style.display = 'none';
    document.body.appendChild(m);
    this.ctxMenu = m;
    m.onmousedown = (e) => e.preventDefault();
    document.addEventListener('click', () => { m.style.display = 'none'; });

    const ORDER = ['back', 'mid', 'front'];   // hinter Overlay · Standard · vor Text
    this.renderer.onDecorContext = (id, x, y) => {
      const d = this.store.slide.decor.find((dd) => dd.id === id);
      const L = ORDER.includes(d?.layer) ? d.layer : 'mid';
      const i = ORDER.indexOf(L);
      const atFront = L === 'front', atBack = L === 'back';
      const item = (label, target, disabled) =>
        `<button data-target="${target}" ${disabled ? 'disabled' : ''}>${label}</button>`;
      m.innerHTML =
        item('In den Vordergrund', 'front', atFront)
        + item('Nach vorne', ORDER[Math.min(i + 1, 2)], atFront)
        + item('Nach hinten', ORDER[Math.max(i - 1, 0)], atBack)
        + item('In den Hintergrund', 'back', atBack)
        + `<div class="ctx-sep"></div>`
        + `<button data-act="delete" class="danger">Entfernen</button>`;
      m.style.display = 'block';
      m.style.left = Math.min(x, window.innerWidth - 210) + 'px';
      m.style.top = Math.min(y, window.innerHeight - 210) + 'px';
      m.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          if (b.disabled) return;
          if (b.dataset.act === 'delete') this.store.removeDecor(id);
          else this.store.setDecorLayer(id, b.dataset.target);
          m.style.display = 'none';
        };
      });
    };
  }

  // ---- Deck-Menü: einfügen / Teilen-Link / kopieren -------------------
  _bindDeckMenu() {
    const btn = document.getElementById('deckBtn');
    const menu = document.getElementById('deckMenu');
    if (!btn) return;
    btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    document.addEventListener('click', () => menu.classList.remove('open'));
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-deck]'); if (!b) return;
      menu.classList.remove('open');
      if (b.dataset.deck === 'import') this._pickDeckFile();
      else if (b.dataset.deck === 'paste') this._openDeckModal();
    });

    // Datei-Dialog (Deck importieren …)
    const file = document.getElementById('deckFile');
    if (file) file.onchange = async () => {
      const f = file.files?.[0]; file.value = '';        // reset -> gleiche Datei erneut wählbar
      if (f) await this._loadDeckFile(f);
    };
    this._bindDeckDrop();      // deck.json irgendwo in die App ziehen

    const modal = document.getElementById('deckModal');
    const ta = document.getElementById('deckPaste');
    document.getElementById('deckCancel').onclick = () => modal.classList.remove('active');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    document.getElementById('deckLoad').onclick = async () => {
      const text = ta.value.trim();
      if (!text) return;
      try { await this._loadDeckJSON(text); modal.classList.remove('active'); this._toast('Deck geladen', 'success'); }
      catch (err) { console.error(err); this._toast('Ungültiges deck.json', 'error'); }
    };
  }
  // ---- Zurücksetzen: Inhalte / Grafiken / API-Key / Alles -------------
  _bindReset() {
    const btn = document.getElementById('resetBtn');
    const menu = document.getElementById('resetMenu');
    if (!btn) return;
    btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    document.addEventListener('click', () => menu.classList.remove('open'));
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-reset]'); if (!b) return;
      menu.classList.remove('open');
      const what = b.dataset.reset;
      if (what === 'inhalte') this._resetContent();
      else if (what === 'grafiken') this._resetGraphics();
      else if (what === 'key') this._resetKey();
      else if (what === 'alles') this._resetAll();
    });
  }
  _resetContent() {
    const ex = EXAMPLE_DECK.slides;                     // Start-Blindtext wiederherstellen
    this.store.deck.slides.forEach((s, i) => {
      const e = ex[i % ex.length];
      s.kicker = e.kicker; s.headline = e.headline; s.subline = e.subline; s.body = e.body;
      s.colors = {}; s.pos = {};
    });
    this.store.commit('reset-content');                 // Undo-fähig, rebuild via Event
    this._toast('Inhalte auf Start-Text zurückgesetzt (Cmd+Z macht es rückgängig)', 'success');
  }
  _resetGraphics() {
    this.store.deck.slides.forEach((s) => {
      s.background = { ...s.background, assetId: null };
      s.overlay = null;
      s.decor = [];
    });
    this._assignFolderBackgrounds();                    // Standard-Hintergrund/Overlay wieder zuweisen
    this.store.commit('reset-graphics');
    this._toast('Grafiken zurückgesetzt (Cmd+Z macht es rückgängig)', 'success');
  }
  _resetKey() {
    sessionStorage.removeItem('cpe.aiKey');
    sessionStorage.removeItem('cpe.aiModel');
    this._toast('API-Key entfernt', 'success');
  }
  _resetAll() {
    if (!confirm('Wirklich ALLES zurücksetzen? Inhalte, Grafiken, hochgeladene Bilder und der API-Key gehen verloren.')) return;
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    location.reload();
  }

  // ---- KI: Folien mit Claude erzeugen (eigener Key, direkt im Browser) --
  _bindGenerate() {
    const btn = document.getElementById('genBtn');
    const modal = document.getElementById('genModal');
    if (!btn || !modal) return;
    const $ = (id) => document.getElementById(id);

    // Modell-Auswahl füllen
    const sel = $('genModel');
    sel.innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
    sel.value = sessionStorage.getItem('cpe.aiModel') || DEFAULT_MODEL;

    // Erklärung nur zeigen, solange kein Key drin ist; Key sofort in der Sitzung merken.
    const keyEl = $('genKey'), helpBox = $('genKeyHelpBox');
    const syncHelp = () => { helpBox.hidden = keyEl.value.trim().length > 0; };
    keyEl.addEventListener('input', syncHelp);
    keyEl.addEventListener('change', () => { const v = keyEl.value.trim(); if (v) sessionStorage.setItem('cpe.aiKey', v); });

    // Eingaben, die für „neu generieren" in der Sitzung gemerkt werden.
    const FIELDS = { genThema: 'cpe.aiThema', genZiel: 'cpe.aiZiel', genTon: 'cpe.aiTon', genStruktur: 'cpe.aiStruktur', genCount: 'cpe.aiCount' };

    // Zeichenzähler + Längen-Limit für den Quelltext (zu lange Texte scheitern sonst).
    const MAX_SOURCE = 8000;
    const themaEl = $('genThema'), themaCount = $('themaCount'), errEl = $('genError');
    const nf = (n) => n.toLocaleString('de-DE');
    const syncCount = () => {
      const n = themaEl.value.length;
      themaCount.textContent = `${nf(n)} / ${nf(MAX_SOURCE)} Zeichen`;
      themaCount.classList.toggle('over', n > MAX_SOURCE);
    };
    themaEl.addEventListener('input', syncCount);

    btn.onclick = () => {
      const savedKey = sessionStorage.getItem('cpe.aiKey') || '';
      keyEl.value = savedKey;                             // in der Sitzung gemerkter Key
      Object.entries(FIELDS).forEach(([id, k]) => { $(id).value = sessionStorage.getItem(k) || ''; });
      syncHelp(); syncCount(); errEl.hidden = true;
      modal.classList.add('active');
      setTimeout(() => (savedKey ? $('genThema') : keyEl).focus(), 0);
    };
    $('genCancel').onclick = () => modal.classList.remove('active');
    // „Neu starten": Eingaben leeren (Key bleibt), für ein frisches Thema.
    $('genReset').onclick = () => {
      Object.entries(FIELDS).forEach(([id, k]) => { $(id).value = ''; sessionStorage.removeItem(k); });
      $('genThema').focus();
    };
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

    const run = $('genRun');
    run.onclick = async () => {
      errEl.hidden = true;
      const apiKey = $('genKey').value.trim();
      const thema = $('genThema').value.trim();
      if (!apiKey) { this._toast('Bitte API-Key eingeben', 'error'); $('genKey').focus(); return; }
      if (!thema)  { this._toast('Bitte ein Thema eingeben', 'error'); $('genThema').focus(); return; }
      if (thema.length > MAX_SOURCE) {
        errEl.textContent = `Der Text ist zu lang (${nf(thema.length)} Zeichen). Bitte auf höchstens ${nf(MAX_SOURCE)} Zeichen kürzen – oder nur den relevanten Abschnitt einfügen.`;
        errEl.hidden = false; themaEl.focus(); return;
      }

      sessionStorage.setItem('cpe.aiKey', apiKey);       // nur Sitzung, weg beim Schließen
      sessionStorage.setItem('cpe.aiModel', sel.value);
      Object.entries(FIELDS).forEach(([id, k]) => sessionStorage.setItem(k, $(id).value));  // Eingaben merken

      const anzahl = parseInt($('genCount').value, 10);
      run.disabled = true; const label = run.textContent; run.textContent = 'Generiere …';
      try {
        const deck = await generateDeck({
          apiKey, model: sel.value, thema,
          zielgruppe: $('genZiel').value.trim(),
          tonalitaet: $('genTon').value.trim(),
          struktur: $('genStruktur').value.trim(),
          anzahl: Number.isFinite(anzahl) && anzahl > 0 ? anzahl : null,
        });
        await this._loadDeckJSON(JSON.stringify(deck));   // gleicher Pfad wie Import: Assets belegen, rendern
        modal.classList.remove('active');
        this._toast(`${deck.slides.length} Folien erzeugt`, 'success');
      } catch (err) {
        console.error(err);
        errEl.textContent = 'Fehler bei der Generierung: ' + (err.message || 'unbekannt');
        errEl.hidden = false;
        this._toast('KI: ' + (err.message || 'Fehler'), 'error');
      } finally {
        run.disabled = false; run.textContent = label;
      }
    };
  }
  _openDeckModal() {
    const m = document.getElementById('deckModal');
    document.getElementById('deckPaste').value = '';
    m.classList.add('active');
    setTimeout(() => document.getElementById('deckPaste').focus(), 0);
  }
  // Toleriert Code-Fences / Fließtext um das JSON (externe KI-Ausgaben).
  _extractJSON(text) {
    let t = (text || '').trim();
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const i = t.indexOf('{'), j = t.lastIndexOf('}');
    return (i !== -1 && j !== -1) ? t.slice(i, j + 1) : t;
  }
  async _loadDeckJSON(text) {
    const obj = JSON.parse(this._extractJSON(text));   // wirft bei ungültigem JSON
    this.store.loadDeck(obj);
    this._assignFolderBackgrounds();              // Hintergrund/Overlay automatisch belegen
    await preloadDeckAssets(this.store.deck);
    this.renderer.fit();
    this.renderThumbs();
  }
  // --- Import: Datei-Dialog, Datei-Drop, Zwischenablage (Cmd+V) ----------
  _pickDeckFile() { document.getElementById('deckFile')?.click(); }
  async _loadDeckFile(file) {
    try {
      const text = await file.text();
      await this._loadDeckJSON(text);
      this._toast(`„${file.name}" geladen`, 'success');
    } catch (err) { console.error(err); this._toast('Ungültiges deck.json', 'error'); }
  }
  // Sieht ein Text nach einem Deck aus? (grobe Prüfung vor dem Laden)
  _looksLikeDeck(text) {
    const t = (text || '').trim();
    if (t[0] !== '{') return false;
    try { const o = JSON.parse(t); return !!o && Array.isArray(o.slides); } catch { return false; }
  }
  _bindDeckDrop() {
    const app = document.querySelector('.app') || document.body;
    const isJsonDrag = (e) => [...(e.dataTransfer?.items || [])]
      .some((it) => it.kind === 'file' && (it.type === 'application/json' || it.type === ''));
    app.addEventListener('dragover', (e) => {
      if (!isJsonDrag(e)) return;            // Asset-Drops auf die Bühne nicht stören
      e.preventDefault(); app.classList.add('deck-drop');
    });
    app.addEventListener('dragleave', (e) => { if (e.target === app) app.classList.remove('deck-drop'); });
    app.addEventListener('drop', async (e) => {
      const f = [...(e.dataTransfer?.files || [])].find((x) => /\.json$/i.test(x.name) || x.type === 'application/json');
      if (!f) return;
      e.preventDefault(); app.classList.remove('deck-drop');
      await this._loadDeckFile(f);
    });
    // Cmd/Ctrl+V: Deck aus der Zwischenablage laden (nur wenn nicht getippt wird)
    document.addEventListener('paste', async (e) => {
      const tag = document.activeElement?.tagName;
      if (this.inlineEditor?.field != null || tag === 'INPUT' || tag === 'TEXTAREA') return;
      const text = e.clipboardData?.getData('text');
      if (!this._looksLikeDeck(text)) return;
      e.preventDefault();
      try { await this._loadDeckJSON(text); this._toast('Deck aus Zwischenablage geladen', 'success'); }
      catch (err) { console.error(err); this._toast('Ungültiges deck.json', 'error'); }
    });
  }
  // Wie applyFolderBackgrounds in main.js, aber zur Laufzeit (Paste/Link).
  _assignFolderBackgrounds() {
    const { backgrounds, overlays } = this.folder;
    this.store.deck.slides.forEach((s, i) => {
      if ((!s.background?.assetId || !getAsset(s.background.assetId)) && backgrounds.length) {
        s.background = { ...s.background, assetId: backgrounds[i % backgrounds.length] };
      }
      if ((!s.overlay?.assetId || !getAsset(s.overlay.assetId)) && overlays.length) {
        const a = getAsset(overlays[i % overlays.length]);
        s.overlay = { assetId: overlays[i % overlays.length], opacity: a?.defaultOpacity ?? 0.45, blend: a?.blend || 'source-over' };
      }
    });
  }
  _deckToLink() {
    const b64 = btoa(unescape(encodeURIComponent(this.store.exportJSON())));
    return location.origin + location.pathname + '#deck=' + encodeURIComponent(b64);
  }
  async _copyShareLink() { this._copyText(this._deckToLink(), 'Teilen-Link kopiert'); }
  async _copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); this._toast(okMsg, 'success'); }
    catch { this._toast('Kopieren nicht möglich', 'error'); }
  }

  // Entfernt den Hintergrund des ausgewählten Artwork-Elements (Flood-Fill).
  async _eraseBackground() {
    const sel = this.store.selection;
    if (sel?.kind !== 'decor') return;
    const decor = this.store.slide.decor.find((d) => d.id === sel.id);
    if (!decor) return;
    const img = getLoadedImage(decor.assetId);
    if (!img) return;
    try {
      const { src, w, h } = removeBackground(img);
      const id = 'art-nobg-' + Math.random().toString(36).slice(2, 7);
      this.store.addCustomAsset({ id, type: 'decor', src, w, h });
      await loadAssetImage(id);
      decor.assetId = id;
      this.store.commit('remove-bg');
      this._toast('Hintergrund entfernt', 'success');
    } catch (e) { console.error(e); this._toast('Hintergrund entfernen fehlgeschlagen', 'error'); }
  }

  // ---- Uploads (eigene Bilder als Element / Logo) ----------------------
  _pickFiles(cb) {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.multiple = true;
    i.onchange = () => { if (i.files.length) cb([...i.files]); };
    i.click();
  }
  readImageFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => resolve({ src: fr.result, w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject; img.src = fr.result;
      };
      fr.onerror = reject; fr.readAsDataURL(file);
    });
  }
  async _importFiles(files, x, y, onLogo) {
    let i = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const { src, w, h } = await this.readImageFile(file);
        const id = 'up_' + Math.random().toString(36).slice(2, 9);
        this.store.addCustomAsset({ id, type: onLogo && i === 0 ? 'logo' : 'decor', src, w, h });
        await loadAssetImage(id);                    // Bild für Render/Export bereitstellen
        if (onLogo && i === 0) this.store.setLogoAsset(id);
        else this.store.addDecor(id, Math.min(0.92, x + i * 0.05), y);
        i++;
      } catch (e) { console.error(e); this._toast('Bild konnte nicht geladen werden', 'error'); }
    }
    this._bindTray();                                 // neue Chips in der Leiste zeigen
    this._toast(onLogo ? 'Logo ersetzt' : `${i} Element${i === 1 ? '' : 'e'} hinzugefügt`, 'success');
  }

  // ---- Slide-Ops --------------------------------------------------------
  _blank() {
    return { role: 'item', kicker: 'Kicker', headline: 'Neue Headline', subline: 'Subzeile',
      body: 'Neuer Text.', scrim: 0.22, decor: [], pos: {} };
  }
  _norm(s) { return { id: 's_' + Math.random().toString(36).slice(2, 8), overlay: null, motion: null, ...s,
    background: { fit: 'cover', kenburns: true, ...s.background } }; }
  _addSlide() {
    const i = this.store.slideIndex + 1;
    const { backgrounds: g, overlays: d } = this.folder;
    const s = this._norm(this._blank());
    if (g.length) s.background = { fit: 'cover', kenburns: true, assetId: g[i % g.length] };
    if (d.length) { const a = getAsset(d[i % d.length]); s.overlay = { assetId: d[i % d.length], opacity: a?.defaultOpacity ?? 0.45, blend: a?.blend || 'source-over' }; }
    this.store.deck.slides.splice(i, 0, s);
    this.store.slideIndex = i; this.store.commit('add-slide');
  }
  _dupSlide(i) {
    const copy = JSON.parse(JSON.stringify(this.store.deck.slides[i]));
    copy.id = 's_' + Math.random().toString(36).slice(2, 8);
    (copy.decor || []).forEach((d) => (d.id = 'decor_' + Math.random().toString(36).slice(2, 8)));
    this.store.deck.slides.splice(i + 1, 0, copy);
    this.store.slideIndex = i + 1; this.store.commit('dup-slide');
  }
  _delSlide(i) {
    if (this.store.deck.slides.length <= 1) return this._toast('Mindestens eine Slide nötig', 'error');
    this.store.deck.slides.splice(i, 1);
    if (this.store.slideIndex >= this.store.deck.slides.length) this.store.slideIndex--;
    this.store.commit('del-slide');
  }

  // ---- Export-Fortschritt / Toast --------------------------------------
  async _run(label, fn) {
    const bar = document.getElementById('progress');
    const fill = document.getElementById('progressFill');
    const txt = document.getElementById('progressTxt');
    bar.classList.add('active'); fill.style.width = '0%'; txt.textContent = `${label} …`;
    try { await fn((p) => { fill.style.width = Math.round(p * 100) + '%'; }); this._toast(`${label} exportiert`, 'success'); }
    catch (err) { console.error(err); this._toast(err.message || `${label} fehlgeschlagen`, 'error'); }
    finally { setTimeout(() => bar.classList.remove('active'), 400); }
  }
  _toast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
}

function dominant(id) {
  const map = { 'bg-radunff': '#1e3f49', 'bg-teal-deep': '#123038', 'bg-teal-bright': '#215863',
    'bg-cool-deep': '#12263f', 'bg-violet': '#3b2560', 'bg-warm-dusk': '#5a2038', 'bg-slate': '#242833' };
  return map[id] || '#1a2b4c';
}
