// Der Store hält deck.json — die einzige Wahrheit (Konzept 1).
// Verantwortlich für: Selektion, Undo/Redo, Autosave (localStorage), Events.
//
// Events:
//   'deck'        — Deck-Struktur/Inhalt geändert (Rebuild nötig)
//   'select'      — Auswahl (Slide oder Node) geändert
//   'format'      — aktives Ausgabeformat geändert
//   'transient'   — leichte Live-Änderung (z.B. Drag), kein History-Push

import { Emitter } from './emitter.js';
import { normalizeDeck } from '../model/schema.js';
import { EXAMPLE_DECK } from '../model/example-deck.js';
import { registerDeckAssets, registerCustomAsset } from '../model/assets.js';

const LS_KEY = 'cpe.deck.v3';
const HISTORY_MAX = 80;

export class Store extends Emitter {
  constructor() {
    super();
    this.deck = normalizeDeck(this._loadPersisted() || EXAMPLE_DECK);
    registerDeckAssets(this.deck);
    this.format = this.deck.meta.format || '9-16';
    this.slideIndex = 0;
    this.selection = null;          // { kind:'text', field } | { kind:'decor', id } | null
    this._undo = [];
    this._redo = [];
    this._last = null;              // Basiszustand seit letztem commit (für korrektes Undo)
    this._saveTimer = null;
    this._last = this._snapshot();
  }

  // ---- Persistenz -------------------------------------------------------
  _loadPersisted() {
    try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.deck)); } catch {}
    }, 400);
  }

  // ---- History ----------------------------------------------------------
  _snapshot() { return JSON.parse(JSON.stringify(this.deck)); }

  commit(label = '') {
    // Den ZUSTAND VOR dieser Änderung (_last) als Wiederherstellungspunkt sichern,
    // dann _last auf den neuen Zustand setzen. So ist Undo korrekt (kein No-op).
    this._undo.push(this._last);
    if (this._undo.length > HISTORY_MAX) this._undo.shift();
    this._redo.length = 0;
    this._last = this._snapshot();
    this._scheduleSave();
    this.emit('deck', { label });
  }

  // Änderung ohne sofortigen History-Push (Live-Drag). Danach commit() aufrufen.
  touch() { this.emit('transient', {}); this._scheduleSave(); }

  undo() {
    if (!this._undo.length) return;
    this._redo.push(this._last);
    this.deck = normalizeDeck(this._undo.pop());
    this._last = this._snapshot();
    this._clampIndex();
    this._scheduleSave();
    this.emit('deck', { label: 'undo' });
  }
  redo() {
    if (!this._redo.length) return;
    this._undo.push(this._last);
    this.deck = normalizeDeck(this._redo.pop());
    this._last = this._snapshot();
    this._clampIndex();
    this._scheduleSave();
    this.emit('deck', { label: 'redo' });
  }

  // ---- Selektion / Navigation ------------------------------------------
  get slide() { return this.deck.slides[this.slideIndex]; }

  _clampIndex() {
    this.slideIndex = Math.max(0, Math.min(this.slideIndex, this.deck.slides.length - 1));
  }

  goTo(i) {
    this._clampIndex();
    const n = Math.max(0, Math.min(i, this.deck.slides.length - 1));
    if (n === this.slideIndex) return;
    this.slideIndex = n;
    this.selection = null;
    this.emit('select', {});
    this.emit('deck', { label: 'nav' });
  }
  next() { this.goTo(this.slideIndex + 1); }
  prev() { this.goTo(this.slideIndex - 1); }

  select(sel) {
    this.selection = sel;
    this.emit('select', {});
  }

  setFormat(fmt) {
    this.format = fmt;
    this.deck.meta.format = fmt;
    this._scheduleSave();
    this.emit('format', {});
  }

  // ---- Mutations (jeweils mit commit) ----------------------------------
  updateSlide(patch, label = 'edit') {
    Object.assign(this.slide, patch);
    this.commit(label);
  }

  reorderSlides(from, to) {
    const s = this.deck.slides;
    if (to < 0 || to >= s.length) return;
    const [m] = s.splice(from, 1);
    s.splice(to, 0, m);
    this.slideIndex = to;
    this.commit('reorder');
  }

  addDecor(assetId, x = 0.5, y = 0.5) {
    const d = { id: 'decor_' + Math.random().toString(36).slice(2, 8),
      assetId, x, y, scale: 1, rot: 0, opacity: 1, z: 30 };
    this.slide.decor.push(d);
    this.selection = { kind: 'decor', id: d.id };
    this.commit('add-decor');
  }
  setBackground(assetId) {
    this.slide.background = { ...this.slide.background, assetId };
    this.commit('bg');
  }
  // Textfarbe: gilt für das AUSGEWÄHLTE Textelement; ohne Auswahl für alle.
  applyTextColor(hex) {
    const sel = this.selection;
    this.slide.colors = this.slide.colors || {};
    if (sel?.kind === 'text') this.slide.colors[sel.field] = hex;
    else ['kicker', 'headline', 'subline', 'body'].forEach((f) => { this.slide.colors[f] = hex; });
  }
  setTextColor(hex) { this.applyTextColor(hex); this.commit('textcolor'); }
  adjustFontSize(delta) {
    const sel = this.selection;
    if (sel?.kind !== 'text') return;
    const defaults = { kicker: 30, headline: 92, subline: 42, body: 34 };
    this.slide.fontSizes = this.slide.fontSizes || {};
    const current = this.slide.fontSizes[sel.field] || defaults[sel.field] || 34;
    this.slide.fontSizes[sel.field] = Math.max(14, Math.min(140, current + delta));
    this.commit('fontsize');
  }
  // DNA-/Helix-Overlay setzen (assetId) oder entfernen (null).
  setOverlay(assetId, asset) {
    this.slide.overlay = assetId
      ? { assetId, opacity: asset?.defaultOpacity ?? 0.45, blend: asset?.blend || 'source-over' }
      : null;
    this.commit('overlay');
  }

  // Eigenes Asset (Upload) im Deck ablegen + zur Laufzeit registrieren.
  addCustomAsset(asset) {
    this.deck.assets[asset.id] = { type: asset.type, src: asset.src, w: asset.w, h: asset.h };
    registerCustomAsset({ id: asset.id, ...this.deck.assets[asset.id], transparent: true });
    return asset.id;
  }
  setLogoAsset(id) {
    this.deck.brand.logoAssetId = id;
    this.deck.brand.show = true;
    this.commit('logo-set');
  }
  removeDecor(id) {
    this.slide.decor = this.slide.decor.filter((d) => d.id !== id);
    this.selection = null;
    this.commit('remove-decor');
  }
  // Ebene eines Decor/Artwork: 'back' (hinter Overlay) | 'mid' | 'front' (vor Text).
  setDecorLayer(id, layer) {
    const d = this.slide.decor.find((x) => x.id === id);
    if (d) { d.layer = layer; this.commit('decor-layer'); }
  }

  loadDeck(raw) {
    this.deck = normalizeDeck(raw);
    registerDeckAssets(this.deck);
    this.format = this.deck.meta.format || '9-16';
    this.slideIndex = 0;
    this.selection = null;
    this._undo.length = 0; this._redo.length = 0;
    this._last = this._snapshot();
    this._scheduleSave();
    this.emit('format', {});
    this.emit('deck', { label: 'load' });
  }

  exportJSON() { return JSON.stringify(this.deck, null, 2); }
}
