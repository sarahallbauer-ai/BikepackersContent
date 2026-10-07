// Reines Zeichnen einer Slide in 1080-Koordinaten (keine Interaktivität).
// Ebenenstapel: z0 BG · z10 Overlay · z20 Scrim · z30 Decor · z40 Text · z50 Logo.
// Template nach Screenshot-Prinzip. Wird identisch von Editor und Export benutzt.

import { getFormat, safeRect } from '../model/formats.js';
import { getTheme } from '../model/themes.js';
import { getLayout } from '../model/layouts.js';
import { getAsset, getLoadedImage } from '../model/assets.js';
import { getPreset, staticReveal, prefersReducedMotion } from './motion.js';
import { TYPE, fitFontSize } from './text-fit.js';
import { DEFAULT_TEXT_COLOR } from '../model/brand.js';

const Konva = window.Konva;
const TEXT_FIELDS = ['kicker', 'headline', 'subline', 'body'];

// Marken-Workflow: Gradient wird über Weiß mit ~21–24 % Deckkraft
// eingefügt, die DNA-Helix ganz weich darüber. Hier zentral einstellbar.
const GRADIENT_OPACITY = 0.23;

function hexToRgba(hex, a) {
  const h = (hex || '#000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function coverRect(iw, ih, w, h) {
  const s = Math.max(w / iw, h / ih);
  return { w: iw * s, h: ih * s };
}

export function paintSlide(slide, deck, opts = {}) {
  const t = opts.t ?? null;
  const fmt = getFormat(opts.format || deck.meta.format);
  const theme = getTheme(deck.theme.id);
  const pal = theme.palette;
  const presetName = slide.motion || deck.theme.motion || theme.motion;
  const preset = getPreset(presetName);
  const reveal = (t === null || prefersReducedMotion()) ? staticReveal() : preset.reveal(Math.max(0, t));

  const group = new Konva.Group({ x: 0, y: 0, width: fmt.w, height: fmt.h });
  const nodes = { decor: [], text: {}, logo: null };

  // Artwork/Decor auf drei Ebenen: 'back' (hinter Overlay), 'mid' (Standard, unter
  // Text), 'front' (vor Text). Wird an drei Stellen des Stapels aufgerufen.
  const decorList = slide.decor || [];
  const drawDecor = (which) => {
    decorList.forEach((d, i) => {
      if ((d.layer || 'mid') !== which) return;
      const img = d.assetId ? getLoadedImage(d.assetId) : null;
      if (!img) return;
      const anim = reveal.decor(i);
      const unit = (Math.min(fmt.w, fmt.h) * 0.28) / Math.max(img.width, img.height);
      const s = unit * (d.scale || 1) * (anim.scale ?? 1);
      const node = new Konva.Image({
        image: img, x: (d.x ?? 0.5) * fmt.w, y: (d.y ?? 0.5) * fmt.h + (anim.dy || 0),
        width: img.width, height: img.height, offsetX: img.width / 2, offsetY: img.height / 2,
        scaleX: s, scaleY: s, rotation: d.rot || 0, opacity: (d.opacity ?? 1) * (anim.opacity ?? 1),
        name: 'decor', id: d.id,
      });
      node._decorRef = d; node._unit = unit;
      group.add(node); nodes.decor.push({ node, decor: d });
    });
  };

  // ---- z0 Background: Weiß + Gradient @ ~23 % (Marken-Workflow) ---------
  const bgImg = slide.background?.assetId ? getLoadedImage(slide.background.assetId) : null;
  if (bgImg) {
    group.add(new Konva.Rect({ x: 0, y: 0, width: fmt.w, height: fmt.h, fill: '#ffffff', listening: false }));
    const r = coverRect(bgImg.width, bgImg.height, fmt.w, fmt.h);
    const kb = reveal.bg;
    group.add(new Konva.Image({
      image: bgImg, width: r.w, height: r.h,
      offsetX: r.w / 2, offsetY: r.h / 2, scaleX: kb.scale, scaleY: kb.scale,
      x: fmt.w / 2 + kb.dx, y: fmt.h / 2 + kb.dy,
      opacity: GRADIENT_OPACITY, listening: false,
    }));
  } else {
    group.add(new Konva.Rect({
      x: 0, y: 0, width: fmt.w, height: fmt.h,
      fillLinearGradientStartPoint: { x: 0, y: 0 },
      fillLinearGradientEndPoint: { x: fmt.w * 0.3, y: fmt.h },
      fillLinearGradientColorStops: [0, pal.bgTop || pal.paper, 1, pal.bgBottom || pal.paper],
      listening: false,
    }));
  }

  // ---- z5 Decor (hinter Overlay, über Hintergrund) ---------------------
  drawDecor('back');

  // ---- z10 Overlay (DNA-Helix, transparent) ----------------------------
  const ovImg = slide.overlay?.assetId ? getLoadedImage(slide.overlay.assetId) : null;
  if (ovImg) {
    const asset = getAsset(slide.overlay.assetId);
    let dw, dh, x, y = reveal.overlay.dy;
    if (asset?.anchor) {
      // eingebaute Helix: an einer Kante ausgerichtet
      const s = fmt.h / ovImg.height;
      dw = ovImg.width * s; dh = ovImg.height * s;
      x = asset.anchor === 'right-edge' ? fmt.w - dw * 0.72
        : asset.anchor === 'left-edge' ? -dw * 0.28 : (fmt.w - dw) / 2;
    } else {
      // eigene DNA-Datei: vollflächig einpassen (cover)
      const r = coverRect(ovImg.width, ovImg.height, fmt.w, fmt.h);
      dw = r.w; dh = r.h; x = (fmt.w - dw) / 2; y += (fmt.h - dh) / 2;
    }
    let blend = slide.overlay.blend || 'screen';
    if (blend === 'normal') blend = 'source-over';
    const ovScale = reveal.overlay.scale ?? 1;   // gegenläufiges Zoom (zentriert)
    group.add(new Konva.Image({
      image: ovImg,
      x: x + dw / 2 + reveal.overlay.dx, y: y + dh / 2,
      width: dw, height: dh, offsetX: dw / 2, offsetY: dh / 2,
      scaleX: ovScale, scaleY: ovScale,
      opacity: (slide.overlay.opacity ?? 0.3) * reveal.overlay.opacityMul,
      globalCompositeOperation: blend, listening: false,
    }));
  }

  // ---- z20 Scrim (dezent unten für Kontrast) ---------------------------
  const scrim = slide.scrim ?? 0.22;
  if (scrim > 0.01) {
    group.add(new Konva.Rect({
      x: 0, y: 0, width: fmt.w, height: fmt.h,
      fillLinearGradientStartPoint: { x: 0, y: fmt.h }, fillLinearGradientEndPoint: { x: 0, y: fmt.h * 0.4 },
      fillLinearGradientColorStops: [0, hexToRgba(pal.scrim, scrim), 1, hexToRgba(pal.scrim, 0)],
      listening: false,
    }));
  }

  // ---- z30 Decor (Standard-Ebene: über Overlay, unter Text) ------------
  drawDecor('mid');

  // ---- z40 Text (Template + freie Offsets) -----------------------------
  const safe = safeRect(fmt);
  const gap = fmt.h * 0.012;

  const mk = (field) => {
    const val = slide[field];
    if (!val) return null;
    const ty = TYPE[field];
    const fam = ty.fontKey === 'display' ? theme.fonts.display : theme.fonts.body;
    const fill = slide.colors?.[field] || slide.textColor || DEFAULT_TEXT_COLOR;
    return new Konva.Text({
      text: val, x: safe.x, y: 0, width: safe.w,
      fontFamily: fam, fontStyle: ty.weight,
      fontSize: ty.size, lineHeight: ty.lh, letterSpacing: ty.spacing,
      fill, align: 'left', wrap: 'word', listening: true,
      name: field,
    });
  };

  const T = {}; TEXT_FIELDS.forEach((f) => { T[f] = mk(f); });

  // Textblock je nach gewähltem Layout oben, mittig oder unten in der Safe-Area.
  const defY = {};
  const mgap = { headline: fmt.h * 0.028, subline: fmt.h * 0.04, body: fmt.h * 0.012 };
  const mainFields = ['kicker', 'headline', 'subline', 'body'].filter((f) => T[f]);
  const measure = () => {
    let tot = 0, first = true;
    mainFields.forEach((f) => { tot += (first ? 0 : (mgap[f] || gap)) + T[f].height(); first = false; });
    return tot;
  };
  let total = measure();
  if (total > safe.h) {
    const factor = safe.h / total;
    mainFields.forEach((f) => T[f].fontSize(Math.max(14, Math.floor(T[f].fontSize() * factor))));
    total = measure();
  }

  const layout = getLayout(slide.layout);
  let cursor = safe.y;
  if (layout.anchor === 'center') cursor = safe.y + (safe.h - total) / 2;
  else if (layout.anchor === 'bottom') cursor = safe.y + safe.h - total;

  let firstMain = true;
  mainFields.forEach((f) => {
    if (!firstMain) cursor += (mgap[f] || gap);
    defY[f] = cursor;
    cursor += T[f].height();
    firstMain = false;
  });

  TEXT_FIELDS.forEach((field) => {
    const n = T[field]; if (!n) return;
    const off = slide.pos?.[field];
    const rev = reveal[field] || { opacity: 1, dy: 0 };
    const defX = safe.x;
    const fx = defX + (off ? off.x * fmt.w : 0);
    const fy = defY[field] + (off ? off.y * fmt.h : 0);
    n.x(fx); n.y(fy + (rev.dy || 0)); n.opacity(rev.opacity ?? 1);
    n._field = field; n._defX = defX; n._defY = defY[field];
    n._layoutRect = { x: fx, y: fy, w: safe.w, h: n.height() };
    group.add(n); nodes.text[field] = n;
  });

  // ---- z45 Decor (vor dem Text) ----------------------------------------
  drawDecor('front');

  // ---- z50 Logo (Marke oben rechts, verschiebbar) ----------------------
  const brand = deck.brand;
  if (brand?.show && brand.logoAssetId) {
    const img = getLoadedImage(brand.logoAssetId);
    if (img) {
      const targetW = fmt.w * 0.14 * (brand.scale || 1);
      const s = targetW / img.width;
      const defX = fmt.w - fmt.safe.right * fmt.w * 0.5 - targetW;
      const defY = fmt.safe.top * fmt.h * 0.35;
      const x = brand.x != null ? brand.x * fmt.w : defX;
      const y = brand.y != null ? brand.y * fmt.h : defY;
      const node = new Konva.Image({
        image: img, x, y, width: img.width, height: img.height, scaleX: s, scaleY: s, name: 'logo',
      });
      node._defX = defX; node._defY = defY;
      node._logoUnit = (fmt.w * 0.14) / img.width;   // scaleX bei brand.scale = 1
      group.add(node); nodes.logo = node;
    }
  }

  return { group, nodes, fmt, safe };
}
