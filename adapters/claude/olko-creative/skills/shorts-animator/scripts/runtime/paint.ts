/*
 * THE PAINT PASS: a flat drawing in, a painted frame out.
 *
 * Every scene is first drawn flat (kit.js): clean shapes, no texture. This
 * pass repaints it on the GPU in the short's look. "strokes" lays three
 * layers of brush strokes (big, medium, small), each stroke one colour picked
 * from the drawing at its centre, turned along the shapes and a slow swirl,
 * with bristle streaks and a little impasto light. Big strokes stop at edges
 * like a careful painter; the small ones finish the edges ragged. "wash" is
 * watercolour: soft bleed, pigment pooled at the edges, granulation, paper.
 * "flat" keeps the shapes and only adds the paper, grain and grade. Any mode
 * can add ink lines and posterize.
 *
 * Every number lives in the look (looks/*.json, references/looks.md), so a
 * style described in words becomes a look file, and the same scene can be
 * painted any way.
 *
 * Frame by frame: `tick` is the drawing number. With boil > 0, that share of
 * strokes is laid again on every drawing, so the paint shimmers the way
 * hand-made animation does.
 */
(function () {
  const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

  const FS = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform vec2 uRes;
uniform float uS;      // px scale: frame height / 1920
uniform float uTick;
uniform float uMode;   // 0 strokes, 1 wash, 2 flat
uniform float uBrush, uLen, uLayers, uSwirl, uFlow, uBristle, uImpasto, uCurve;
uniform float uHueJ, uValJ, uSatJ, uRespect, uBoil;
uniform float uPaper, uGrain, uWash, uOutline, uPoster, uSat, uContrast, uWarm, uVig, uBloom, uBleed;
uniform vec3 uInk, uPaperCol;
out vec4 o;

vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), u.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + 7.1; a *= .5; } return s; }

vec3 img(vec2 px, float lod){ return textureLod(uImg, px / uRes, lod).rgb; }
float lum(vec3 c){ return dot(c, vec3(.299, .587, .114)); }

vec3 hueShift(vec3 c, float a){
  const mat3 toYIQ = mat3(.299, .596, .211, .587, -.274, -.523, .114, -.322, .312);
  const mat3 toRGB = mat3(1., 1., 1., .956, -.272, -1.106, .621, -.647, 1.703);
  vec3 y = toYIQ * c; float h = atan(y.z, y.y) + a, ch = length(y.yz);
  return toRGB * vec3(y.x, ch*cos(h), ch*sin(h));
}

vec2 flowDir(vec2 c){
  float e = 7.*uS;
  float gx = lum(img(c + vec2(e, 0.), 3.)) - lum(img(c - vec2(e, 0.), 3.));
  float gy = lum(img(c + vec2(0., e), 3.)) - lum(img(c - vec2(0., e), 3.));
  float ang = fbm(c / (uFlow*uS) + vec2(uTick*.013*uBoil, 0.)) * 6.2832 * 1.7;
  vec2 nd = vec2(cos(ang), sin(ang));
  vec2 g = vec2(gx, gy);
  float gl = length(g);
  if (gl < 1e-4) return nd;
  vec2 ed = vec2(-g.y, g.x) / gl;
  if (dot(ed, nd) < 0.) ed = -ed;
  float w = clamp(gl*9., 0., 1.) * (1. - .75*uSwirl);
  return normalize(mix(nd, ed, w));
}

// One layer of strokes of a given size. rgb + coverage.
vec4 strokes(vec2 px, float size, float lseed, float respect){
  vec2 cell = floor(px / size);
  float bestZ = -1.;
  vec4 res = vec4(0.);
  vec3 here = img(px, 0.);
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){
    vec2 c = cell + vec2(float(i), float(j));
    float boil = hash12(c + lseed*3.1) < uBoil ? uTick : 0.;
    vec3 h = hash32(c*1.37 + lseed + boil*.618);
    vec2 ctr = (c + .1 + .8*h.xy) * size;
    vec2 d = px - ctr;
    float W = size*(.34 + .22*h.z);
    float Lh = size*uLen*.5*(.7 + .6*h.y);
    if (dot(d, d) > (Lh + W)*(Lh + W)) continue;
    float z = hash12(c + lseed + 19.7 + boil);
    if (z < bestZ) continue;
    vec2 dir = flowDir(ctr);
    float u = dot(d, dir), v = dot(d, vec2(-dir.y, dir.x));
    v -= (h.x - .5) * uCurve * u*u / Lh;
    float un = u / Lh;
    if (abs(un) > 1.) continue;
    float taper = sqrt(max(0., 1. - pow(abs(un), 2.4)));
    float wv = W*taper*(.82 + .36*vnoise(vec2(u/(6.*uS), h.z*40.)));
    float edge = abs(v) - wv;
    if (edge > 0.) continue;
    vec3 col = img(ctr, .6);
    // a careful painter stops a big stroke at an edge
    float a = clamp(-edge / (1.3*uS), 0., 1.);
    a *= 1. - respect*smoothstep(.10, .28, distance(here, col));
    if (a <= .02) continue;
    float br = vnoise(vec2(v/(1.7*uS) + h.x*91., un*.7 + h.y*13.));
    a *= mix(1., step(.38, br), smoothstep(.55, 1., abs(un))*uBristle);
    if (a <= .02) continue;
    // colour of this stroke: the drawing's, nudged
    col = hueShift(col, (h.x - .5)*uHueJ);
    col *= 1. + (h.y - .5)*uValJ;
    float l = lum(col); col = mix(vec3(l), col, 1. + (h.z - .5)*uSatJ);
    // bristle streaks along the stroke, and the ridge catching light
    col *= 1. + (br - .5)*uBristle*.32;
    float side = v / max(wv, 1e-3);
    float lit = dot(vec2(-dir.y, dir.x), normalize(vec2(-.6, -.8)));
    col *= 1. + uImpasto*(.16*side*lit + .08*(1. - side*side) - .05);
    bestZ = z;
    res = vec4(col, a);
  }
  return res;
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 col;
  if (uMode < .5){
    col = img(px + (vec2(fbm(px/(9.*uS)), fbm(px/(9.*uS) + 5.)) - .5)*4.*uS, 1.5);
    float b = uBrush*uS;
    for (int k = 0; k < 3; k++){
      float fk = float(k);
      if (fk >= uLayers) break;
      float size = b * (fk == 0. ? 2.3 : fk == 1. ? 1.35 : .78);
      float respect = uRespect * (fk == 0. ? 1. : fk == 1. ? .8 : .35);
      vec4 s = strokes(px, size, fk*17.31 + 3., respect);
      col = mix(col, s.rgb, s.a);
    }
  } else if (uMode < 1.5){
    // the wash moves a little each drawing (boil), and bleeds past the line
    float bt = floor(uTick*uBoil + .5)*.37;
    vec2 q = px + (vec2(fbm(px/(16.*uS) + bt), fbm(px/(16.*uS) + 9. + bt)) - .5)*uBleed*22.*uS;
    col = img(q, 1.4 + uBleed);
    // pigment pools at the edge of each wash
    float wet = length(img(q, 0.) - img(q, 3.5));
    col = mix(col, col*col*1.12, uWash*.9*smoothstep(.02, .16, wet));
    // blooms: the wash dried unevenly
    col *= 1. + uWash*.3*(fbm(px/(95.*uS) + 3.) - .5);
    col = mix(col, col*mix(vec3(1.), vec3(.92, .95, 1.05), fbm(px/(60.*uS))), uWash*.6);
    // granulation in the tooth of the paper
    col *= 1. - uWash*.24*(fbm(px/(2.2*uS)) - .5);
    // the paper showing through where the brush ran dry
    float dry = smoothstep(.62, .82, fbm(px/(22.*uS) + 7. + bt));
    col = mix(col, uPaperCol, uWash*(.08 + .3*dry*smoothstep(.0, .12, wet)));
    col = mix(col, uPaperCol, .12*uWash);
  } else {
    col = img(px, 0.);
  }
  if (uOutline > 0.){
    float e = 1.4*uS;
    float gx = lum(img(px + vec2(e,0.), .5)) - lum(img(px - vec2(e,0.), .5));
    float gy = lum(img(px + vec2(0.,e), .5)) - lum(img(px - vec2(0.,e), .5));
    float wob = .7 + .6*vnoise(px/(30.*uS) + uTick*.37);
    float line = smoothstep(.06, .2, length(vec2(gx, gy))*wob);
    col = mix(col, uInk, line*uOutline);
  }
  if (uPoster > 1.) col = floor(col*uPoster + .5) / uPoster;
  // ground: canvas weave or paper tooth, then grain
  float weave = sin(px.x*3.1416/(2.6*uS)) * sin(px.y*3.1416/(2.6*uS));
  float tooth = fbm(px/(3.*uS));
  col *= 1. + uPaper*(.05*weave + .09*(tooth - .5));
  col += (hash12(px + fract(uTick*.137)*911.) - .5) * uGrain * .07;
  // grade
  col += uBloom * max(img(px, 5.) - .55, 0.) * 1.4;
  float l = lum(col);
  col = mix(vec3(l), col, uSat);
  col = (col - .5)*uContrast + .5;
  col += vec3(.035, .01, -.03)*uWarm;
  vec2 uv = px / uRes - .5;
  col *= 1. - uVig*dot(uv*vec2(1.2, .9), uv*vec2(1.2, .9))*1.3;
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

  const DEFAULTS: PaintSettings = {
    mode: "strokes", brush: 9, length: 2.6, layers: 3, swirl: 0.55, flow: 160, curve: 0.5,
    bristle: 0.6, impasto: 0.5, hueJitter: 0.12, valueJitter: 0.14, satJitter: 0.25, respect: 0.85,
    boil: 0.5, paper: 0.6, grain: 0.5, wash: 0, bleed: 0, outline: 0, ink: "#1a1612",
    paperColor: "#f3eee2", posterize: 0, saturation: 1.12, contrast: 1.06, warmth: 0.2,
    vignette: 0.35, bloom: 0.25,
  };

  const MODES = new Map<string, number>([["strokes", 0], ["wash", 1], ["flat", 2]]);

  // shader uniform name -> the look setting that feeds it
  const NUMBER_UNIFORMS: [string, PaintNumberKey][] = [
    ["uBrush", "brush"], ["uLen", "length"], ["uLayers", "layers"], ["uSwirl", "swirl"],
    ["uFlow", "flow"], ["uCurve", "curve"], ["uBristle", "bristle"], ["uImpasto", "impasto"],
    ["uHueJ", "hueJitter"], ["uValJ", "valueJitter"], ["uSatJ", "satJitter"],
    ["uRespect", "respect"], ["uBoil", "boil"], ["uPaper", "paper"], ["uGrain", "grain"],
    ["uWash", "wash"], ["uBleed", "bleed"], ["uOutline", "outline"], ["uPoster", "posterize"],
    ["uSat", "saturation"], ["uContrast", "contrast"], ["uWarm", "warmth"],
    ["uVig", "vignette"], ["uBloom", "bloom"],
  ];

  function hex(c: string): number[] {
    const n = parseInt(String(c).replace("#", ""), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
    const s = gl.createShader(type);
    if (!s) throw new Error("WebGL2 could not create a shader");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
    return s;
  }

  function link(gl: WebGL2RenderingContext): WebGLProgram {
    const prog = gl.createProgram();
    if (!prog) throw new Error("WebGL2 could not create a program");
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "program link failed");
    return prog;
  }

  function makeTexture(gl: WebGL2RenderingContext): WebGLTexture {
    const tex = gl.createTexture();
    if (!tex) throw new Error("WebGL2 could not create a texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function Painter(canvas: HTMLCanvasElement): Painter {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available");
    const prog = link(gl);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = makeTexture(gl);
    const U = (n: string) => gl.getUniformLocation(prog, n);

    return {
      paint(flat, look, tick) {
        const L = { ...DEFAULTS, ...look };
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.uniform2f(U("uRes"), canvas.width, canvas.height);
        gl.uniform1f(U("uS"), canvas.height / 1920);
        gl.uniform1f(U("uTick"), tick);
        gl.uniform1f(U("uMode"), MODES.get(L.mode) ?? 0);
        for (const [name, key] of NUMBER_UNIFORMS) gl.uniform1f(U(name), L[key]);
        gl.uniform3fv(U("uInk"), hex(L.ink));
        gl.uniform3fv(U("uPaperCol"), hex(L.paperColor));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
    };
  }

  window.ShortsPaint = { Painter, DEFAULTS };
})();
