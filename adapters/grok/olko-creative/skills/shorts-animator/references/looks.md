# Looks: from words to numbers

A look is a JSON object. Start from a shipped one (`"base": "oil"`) and override.

| key | what it does | range |
|---|---|---|
| `mode` | `strokes` (paint/pastel), `wash` (watercolour/ink), `flat` | |
| `brush` | stroke size in px at 1920 tall | 5 fine … 11 oil … 18 bold |
| `length` | stroke length ÷ width | 2 dabs … 4.6 hatching |
| `swirl` | strokes follow a swirl (1) or the shapes (0) | 0 … 1 |
| `curve` | strokes bend | 0 … 1 |
| `bristle` | streaks inside a stroke, broken dry ends | 0 … 1 |
| `impasto` | thick paint catching light | 0 … 1 |
| `hueJitter` `valueJitter` `satJitter` | colour variation stroke to stroke | 0 … 0.4 |
| `respect` | big strokes stop at edges (crisper subjects) | 0 … 1 |
| `boil` | share of strokes redrawn every drawing (the shimmer) | 0 still … 1 lively |
| `wash` `bleed` | watercolour pooling, blooms, granulation; how far colour runs | 0 … 1 |
| `outline` `ink` | hand-inked lines, their colour | 0 … 1 |
| `paper` `paperColor` `grain` | canvas/paper texture, grain | 0 … 1.6 |
| `posterize` | flat colour bands (screen print, retro) | 0 off, 4 … 8 |
| `saturation` `contrast` `warmth` | grade | ~0.8 … 1.3 |
| `vignette` `bloom` | dark corners, glow from lights | 0 … 0.6 |
| `captions` | `{ style, size, y, box, color, font, case }` | |

Words → moves:
- "thicker / bolder paint" → brush +4, impasto +0.2 · "finer" → brush −3
- "swirly / Van Gogh" → swirl 0.9, curve 1, hueJitter 0.25 · "calmer" → swirl 0.3, boil 0.2
- "dreamy / soft" → watercolor, bleed 1 · "crisp" → respect 1, boil 0.2
- "vintage / old film" → saturation 0.8, warmth 0.5, grain 1, vignette 0.5
- "comic / graphic novel" → ink, posterize 6 · "screen print / retro poster" → gouache, posterize 5
- "night is too dark" → contrast 0.95 and lighten the palette, not the look
- "for kids" → pastel or gouache, saturation 1.1, warm palette, playful music
