// Sara Hallpower Beispiel-Deck:
// Instagram-Karussell im 4:5-Format mit wiederverwendbarer Tour-Tipp-Struktur.

export const EXAMPLE_DECK = {
  meta: {
    title: 'Sara Hallpower · Tour Tipp',
    structure: 'listicle',
    format: '4-5',
    lang: 'de'
  },
  theme: { id: 'hallpower', motion: 'calm' },
  brand: { show: false },
  slides: [
    {
      role: 'hook',
      kicker: 'TOUR TIPP',
      headline: 'Diese Tour solltest Du im Herbst fahren.',
      subline: 'Karwendeltal → Karwendelhaus',
      body: 'Goldene Farben, lange Schotterpassagen und ganz viel Karwendel.'
    },

    {
      role: 'context',
      kicker: 'AUF EINEN BLICK',
      headline: 'Eine Tour für alle, die Gravel und Berge lieben.',
      subline: 'Start: Mittenwald',
      body: 'Ideal als sportliche Tagestour mit genügend Zeit zum Schauen, Anhalten und Genießen.'
    },

    {
      role: 'item',
      kicker: '01',
      headline: 'Die Strecke',
      subline: 'Gravel, Wald und Bergkulisse',
      body: 'Der Weg zieht gleichmäßig durchs Karwendeltal und wird mit jedem Kilometer alpiner.'
    },

    {
      role: 'item',
      kicker: '02',
      headline: 'Mein Lieblingsmoment',
      subline: 'Nicht nur Kilometer sammeln.',
      body: 'Im Herbst lohnt es sich, Tempo rauszunehmen. Ich habe unterwegs sogar Wacholderbeeren gesammelt.'
    },

    {
      role: 'item',
      kicker: '03',
      headline: 'Warum im Herbst?',
      subline: 'Weil das Karwendel dann leuchtet.',
      body: 'Bunte Wälder, klare Luft und diese Ruhe, die eine bekannte Tour plötzlich wieder ganz neu wirken lässt.'
    },

    {
      role: 'cta',
      kicker: 'SPEICHERN',
      headline: 'Rad schnappen. Losfahren.',
      subline: 'Mehr Touren & Bikepacking: @sara_hallpower',
      body: 'Speichere Dir den Tour-Tipp für Deinen nächsten freien Herbsttag.'
    }
  ],
};
