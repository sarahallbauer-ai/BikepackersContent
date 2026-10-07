// Sara Hallpower Theme
// Klar, warm, sportlich: echte Bilder im Fokus, wenig grafischer Ballast.

import { DISPLAY_FONT, BODY_FONT } from './brand.js';

export const THEMES = {
  hallpower: {
    id: 'hallpower',
    label: 'Sara Hallpower',
    palette: {
      ink: '#202321',
      paper: '#F4F1EA',
      accent: '#F28C28',
      scrim: '#202321',
      bgTop: '#F4F1EA',
      bgBottom: '#E8E3D8',
    },
    fonts: { display: DISPLAY_FONT, body: BODY_FONT, serif: 'Georgia' },
    motion: 'calm',
  },

  hallpowerWomen: {
    id: 'hallpowerWomen',
    label: 'Sara Hallpower · Women Ride',
    palette: {
      ink: '#202321',
      paper: '#FFF8FA',
      accent: '#D94F70',
      scrim: '#202321',
      bgTop: '#FFF3F6',
      bgBottom: '#F7E4EA',
    },
    fonts: { display: DISPLAY_FONT, body: BODY_FONT, serif: 'Georgia' },
    motion: 'calm',
  },

  hallpowerNature: {
    id: 'hallpowerNature',
    label: 'Sara Hallpower · Outdoor',
    palette: {
      ink: '#202321',
      paper: '#F4F1EA',
      accent: '#346B68',
      scrim: '#1A2A29',
      bgTop: '#E8EFEC',
      bgBottom: '#DDE8E4',
    },
    fonts: { display: DISPLAY_FONT, body: BODY_FONT, serif: 'Georgia' },
    motion: 'calm',
  },
};

export const DEFAULT_THEME = 'hallpower';

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}
