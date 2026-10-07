// deck.json-Schema als Normalisierung + Defaults (Konzept 4).
// Positionen als 0..1. Jedes Textelement kann per Drag frei verschoben werden
// (slide.pos[field] = {x,y} Offset, null = Template-Anker).

import { DEFAULT_FORMAT } from './formats.js';
import { DEFAULT_THEME } from './themes.js';
import { DEFAULT_LAYOUT } from './layouts.js';

export const SCHEMA_VERSION = 3;

export function makeId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function normDecor(d) {
  return {
    id: d.id || makeId('decor'),
    assetId: d.assetId || null,
    x: d.x ?? 0.5, y: d.y ?? 0.5,
    scale: d.scale ?? 1.0, rot: d.rot ?? 0, opacity: d.opacity ?? 1, z: d.z ?? 30,
    layer: d.layer || 'mid',      // 'back' (hinter Overlay) | 'mid' | 'front' (vor Text)
  };
}

function normSlide(s) {
  return {
    id: s.id || makeId('s'),
    role: s.role || 'item',
    layout: s.layout || DEFAULT_LAYOUT,
    kicker: s.kicker ?? '',
    headline: s.headline ?? '',
    subline: s.subline ?? '',
    body: s.body ?? '',
    textColor: s.textColor ?? null,      // Fallback-Farbe (Migration/alle)
    colors: s.colors || {},              // Farbe pro Feld: { headline:'#..', subline:'#..', ... }
    fontSizes: s.fontSizes || {},        // individuelle Schriftgrößen pro Textfeld
    pos: s.pos || {},                    // { kicker:{x,y}, headline:{x,y}, ... } Offsets 0..1
    background: {
      assetId: s.background?.assetId ?? null,
      color: s.background?.color ?? null,
      fit: s.background?.fit ?? 'cover',
      kenburns: s.background?.kenburns ?? true,
    },
    overlay: s.overlay
      ? { assetId: s.overlay.assetId ?? null, opacity: s.overlay.opacity ?? 0.3, blend: s.overlay.blend ?? 'screen' }
      : null,
    scrim: s.scrim ?? 0,   // heller Marken-Look braucht keinen dunklen Scrim
    decor: (s.decor || []).map(normDecor),
    motion: s.motion || null,
  };
}

export function normalizeDeck(raw) {
  const d = raw || {};
  return {
    meta: {
      title: d.meta?.title ?? 'Neues Deck',
      structure: d.meta?.structure ?? 'listicle',
      format: d.meta?.format ?? DEFAULT_FORMAT,
      lang: d.meta?.lang ?? 'de',
      createdAt: d.meta?.createdAt ?? new Date().toISOString(),
      version: SCHEMA_VERSION,
    },
    theme: { id: d.theme?.id ?? DEFAULT_THEME, motion: d.theme?.motion ?? 'calm' },
    // Eigene hochgeladene Assets: id -> { type, src(dataURL), w, h }
    assets: d.assets ? { ...d.assets } : {},
    brand: {
      logoAssetId: d.brand?.logoAssetId ?? 'logo-radunff',
      x: d.brand?.x ?? null, y: d.brand?.y ?? null,   // null = Template-Ecke oben rechts
      scale: d.brand?.scale ?? 1,
      show: d.brand?.show ?? false,   // Platzhalter-Logo aus, bis eigenes gesetzt
    },
    slides: (d.slides || []).map(normSlide),
  };
}
