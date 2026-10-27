# The drawing kit

Every scene is `(k) => { ... }`. Positions are fractions of the frame (x 0→1 left→right, y 0→1 top→bottom);
sizes in px are for a 1920-tall frame and scale with it (`k.u`). Draw back to front: sky, far, middle, near.

| in `k` | what |
|---|---|
| `k.g` | the 2D canvas context (camera already applied): draw anything the helpers don't cover |
| `k.W`, `k.H`, `k.u` | frame size, and the scale (H/1920) |
| `k.X(x)`, `k.Y(y)` | fraction → pixels |
| `k.t`, `k.p` | seconds into the shot (on twos), progress 0→1 |
| `k.r()` | random, the same on every drawing of the shot |
| `k.rng(seed)`, `k.noise1(x)` | a seeded random source; smooth 1D noise |
| `k.pal`, `k.beat` | the short's palette; this shot's beat (scene, line, move) |
| `k.mix(a, b, t)`, `k.alpha(c, a)` | colour helpers |
| `IMAGES.name` | an image from `assets/` (a logo, a reference), for `k.g.drawImage` |

## Sky and light
- `k.sky({ stops: [top, …, bottom], y0, y1 })`: a gradient
- `k.clouds({ y, band, n, size, color, shade, drift, seed })`: small cumulus in a band, drifting
- `k.sun({ x, y, r, color, glow, glowSize, glowAlpha })`: sun, moon, a bright bulb
- `k.glow({ x, y, r, color, a })`: any soft light (windows, lanterns, a halo)
- `k.stars({ n, y1 })`, `k.motes({ n, y0, y1, color })` (fireflies, embers), `k.rain({ n, a, slant })`
- `k.rays({ x, y, angle, spread, n, a, width })`: god rays through trees or clouds
- `k.haze({ y, h, color, a })`: air between planes

## Land and water
- `k.ridge({ y, amp, freq, color, top, shape, seed })`: filled ridge: `soft` hills, `peaks` mountains,
  `pines` a conifer line, `bush` a broadleaf line, `rocky`
- `k.ground({ y, color, far, stripes, stripe, flowers })`: the ground plane, mown stripes, flowers
- `k.path({ x, y, near, far, color, bend })`: a road to the horizon
- `k.water({ y0, y1, color, deep, glint, glints })`: lake or sea with moving glints
- `k.waterfall({ x, w, y0, y1 })`
- `k.shape({ pts: [[x,y],…], color, smooth })`: any shape: a cliff, a giant tree trunk, an island

## Plants
- `k.tree({ x, y, h, kind, crown, trunk, fruit })`: kind `round` `pine` `autumn` `bare` `palm` `column`
- `k.trees({ n, y, h, x0, x1, kind, crown })`: a row
- `k.foliage({ side, x, depth, y0, y1, color, light })`: leaves hanging into frame from a side
- `k.trunks({ n, color, light, width, x0, x1 })`: inside a forest

## Built things
- `k.house({ x, y, w, h, wall, roof, window, lit, floors, aFrame })`
- `k.city({ y, h, color, lit, litColor, density, n })`: skyline, windows lit at night
- `k.pagoda({ x, y, h, color })`, `k.pole({ x, y, h })`, `k.lamp({ x, y, h, light })`
- `k.block({ x0, y0, x1, y1, color, edge })`: walls, doorways, a lit edge
- `k.heart({ x, y, s, color })`

## People
`k.person({ x, y, h, pose, facing, hair, skin, hairColor, top, bottom, shoes, robe, rim, silhouette, walk, dx, flip, build })`
- feet at (x, y), `h` = height as a fraction of the frame (0.25 is a full figure in a landscape)
- `pose`: `stand` `walk` `cheer` `open` `wave` `point` `reach` `pray` `hug` `sit` `kneel` `hold`
- `facing`: `front` | `back` (faces are left blank on purpose: it's the style, and it reads at any size)
- `hair`: `short` `long` `curly` `afro` `bun` `hood` `hat` `cap` `bald`
- `robe: true`: a long garment (biblical, monks, a dress)
- `silhouette: "#111"`: one colour (backlit, sunset); `rim: "#9db6f0"`: a lit outline (night)
- `dx`: moves over the shot (0.05 = 5% of the width); `walk`: steps per second
- `k.people([{...}, {...}])`: several `person` calls in one
- Two people walking together read as a relationship; a tiny figure in a huge landscape reads as awe or loneliness.
