import { type CustomLayerMatrix, matrixForWebGl } from '$shared/map';

// 4 floats * 4 bytes per vertex: [posX, posY, localX, localY]. posX/posY are a mercator-coordinate
// quad corner; localX/localY are the corner in [-1,1] for the polar mapping.
const VERTEX_STRIDE = 16;
const QUAD_FLOATS = 24;

function fillQuad(out: Float32Array, cx: number, cy: number, half: number): void {
  const x0 = cx - half;
  const x1 = cx + half;
  const y0 = cy - half;
  const y1 = cy + half;
  out[0] = x0;
  out[1] = y0;
  out[2] = -1;
  out[3] = -1;
  out[4] = x1;
  out[5] = y0;
  out[6] = 1;
  out[7] = -1;
  out[8] = x0;
  out[9] = y1;
  out[10] = -1;
  out[11] = 1;
  out[12] = x1;
  out[13] = y0;
  out[14] = 1;
  out[15] = -1;
  out[16] = x1;
  out[17] = y1;
  out[18] = 1;
  out[19] = 1;
  out[20] = x0;
  out[21] = y1;
  out[22] = -1;
  out[23] = 1;
}

export function quadVertices(cx: number, cy: number, half: number): Float32Array {
  const out = new Float32Array(QUAD_FLOATS);
  fillQuad(out, cx, cy, half);
  return out;
}

const VERT = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
in vec2 a_pos;
in vec2 a_local;
out vec2 v_local;
void main() {
  v_local = a_local;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_data;
uniform sampler2D u_legend;
uniform float u_heading;
uniform float u_opacity;
uniform float u_blip;        // blip dilation radius in screen pixels; 0 disables it
uniform float u_sweep;       // current scan angle in a-units [0,1); negative disables the sweep
uniform vec3 u_sweepColor;   // themed sweep wedge color
in vec2 v_local;
out vec4 fragColor;
const float PI = 3.141592653589793;

// uv.x is the angle fraction [0,1), uv.y the range fraction [0,1). The data texture is laid out
// range-across-width and angle-down-height (matching mayara's renderer and the angle-major accumulator
// writeSpoke fills), so the texel lookup swaps to (range, angle). The data texel is a legend INDEX:
// recover the integer 0..255 index from the R8-normalized value and look up its RGBA, sampling level 0
// explicitly so no implicit-derivative LOD is needed inside the loop.
vec4 echoColor(vec2 uv) {
  float idx = floor(textureLod(u_data, vec2(uv.y, uv.x), 0.0).r * 255.0 + 0.5);
  return textureLod(u_legend, vec2((idx + 0.5) / 256.0, 0.5), 0.0);
}

void main() {
  float r = length(v_local);
  if (r > 1.0) discard;
  // atan(x, -y): the quad's local +y is mercator south (down on a north-up screen), so negating it puts
  // angle 0 at the top (dead ahead) and makes the angle increase clockwise, matching the radar's
  // rotation and mayara's renderer. Using +y here drew the sweep counter-clockwise.
  float theta = atan(v_local.x, -v_local.y) - u_heading;
  float a = mod(theta / (2.0 * PI), 1.0);

  vec4 echo;
  if (u_blip > 0.0) {
    // Dilate each return to a minimum SCREEN size so a sparse, sub-pixel echo still paints a visible
    // blip. The per-pixel texel size comes from the screen-space derivatives of the smooth v_local
    // coordinate (continuous across the 0/2pi seam), decomposed into radial and tangential parts, so the
    // dilation is a constant pixel radius at any zoom: large when zoomed out (where returns would alias
    // away), negligible when zoomed in. A 3x3 max-weighted kernel keeps the strongest nearby return,
    // brightest at the center and fading at the rim, which reads as a soft glow on dense radars too.
    vec2 dvx = dFdx(v_local);
    vec2 dvy = dFdy(v_local);
    float rr = max(r, 1e-4);
    vec2 rhat = v_local / rr;
    vec2 that = vec2(-rhat.y, rhat.x);
    float rPerPx = length(vec2(dot(dvx, rhat), dot(dvy, rhat)));
    float tPerPx = length(vec2(dot(dvx, that), dot(dvy, that)));
    float aPerPx = tPerPx / (rr * 2.0 * PI);
    float sa = u_blip * aPerPx;
    float sr = u_blip * rPerPx;
    echo = vec4(0.0);
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec4 c = echoColor(vec2(a + float(dx) * sa, r + float(dy) * sr));
        float w = max(0.0, 1.0 - 0.5 * length(vec2(float(dx), float(dy))));
        float contrib = c.a * w;
        if (contrib > echo.a) echo = vec4(c.rgb, contrib);
      }
    }
  } else {
    echo = echoColor(vec2(a, r));
  }

  vec3 rgb = echo.rgb;
  float alpha = echo.a;

  if (u_sweep >= 0.0) {
    // A bright leading edge at the current scan angle with an afterglow trail behind it, so the radar
    // reads as actively scanning even when returns are sparse.
    float behind = mod(u_sweep - a, 1.0);
    float trail = 0.14;
    if (behind < trail) {
      float g = 1.0 - behind / trail;
      float sweepA = g * g * 0.55;
      rgb = mix(rgb, u_sweepColor, sweepA);
      alpha = max(alpha, sweepA);
    }
  }

  if (alpha <= 0.0) discard;
  fragColor = vec4(rgb, alpha * u_opacity);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type) as WebGLShader;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`radar shader: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

interface Locations {
  pos: number;
  local: number;
  matrix: WebGLUniformLocation | null;
  heading: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  blip: WebGLUniformLocation | null;
  sweep: WebGLUniformLocation | null;
  sweepColor: WebGLUniformLocation | null;
  data: WebGLUniformLocation | null;
  legend: WebGLUniformLocation | null;
}

// Each return dilates to roughly this screen-pixel radius, so a sparse sub-pixel echo still paints a
// blip the eye can find.
const DEFAULT_BLIP_PX = 2.5;

export class RadarGl {
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram;
  readonly #buffer: WebGLBuffer;
  readonly #dataTex: WebGLTexture;
  readonly #legendTex: WebGLTexture;
  // Attribute and uniform locations are static after link, so they are looked up once here rather than
  // by string on every frame.
  readonly #loc: Locations;
  // A reusable vertex buffer, re-uploaded only when the quad's center or extent changes.
  readonly #quad = new Float32Array(QUAD_FLOATS);
  readonly #matrixScratch = new Float32Array(16);
  #spokes = 0;
  #texW = 0;
  #texH = 0;
  #legendUploaded = false;
  #opacity = 1;
  #heading = 0;
  #blip = DEFAULT_BLIP_PX;
  #sweep = -1;
  #sweepColor: [number, number, number] = [0.3, 1, 0.5];
  #lastCx = Number.NaN;
  #lastCy = Number.NaN;
  #lastHalf = Number.NaN;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    const program = gl.createProgram() as WebGLProgram;
    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`radar program: ${gl.getProgramInfoLog(program)}`);
    }
    // The linked program owns the compiled stages; detach and delete the shaders so the driver does
    // not keep their source alive for the life of the page.
    gl.detachShader(program, vert);
    gl.detachShader(program, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    this.#program = program;
    this.#buffer = gl.createBuffer() as WebGLBuffer;
    this.#dataTex = gl.createTexture() as WebGLTexture;
    this.#legendTex = gl.createTexture() as WebGLTexture;
    this.#loc = {
      pos: gl.getAttribLocation(program, 'a_pos'),
      local: gl.getAttribLocation(program, 'a_local'),
      matrix: gl.getUniformLocation(program, 'u_matrix'),
      heading: gl.getUniformLocation(program, 'u_heading'),
      opacity: gl.getUniformLocation(program, 'u_opacity'),
      blip: gl.getUniformLocation(program, 'u_blip'),
      sweep: gl.getUniformLocation(program, 'u_sweep'),
      sweepColor: gl.getUniformLocation(program, 'u_sweepColor'),
      data: gl.getUniformLocation(program, 'u_data'),
      legend: gl.getUniformLocation(program, 'u_legend'),
    };
  }

  setData(buffer: ArrayBuffer, spokesPerRev: number, maxSpokeLen: number): void {
    if (spokesPerRev <= 0 || maxSpokeLen <= 0) return;
    const gl = this.#gl;
    this.#spokes = spokesPerRev;
    const pixels = new Uint8Array(buffer);
    gl.bindTexture(gl.TEXTURE_2D, this.#dataTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (maxSpokeLen !== this.#texW || spokesPerRev !== this.#texH) {
      // First upload or a size change: allocate and set the filters. The accumulator is angle-major
      // (each spoke's range bins are contiguous), so the texture is range-across-width and
      // angle-down-height, matching mayara's renderer; the shader samples (range, angle). The data
      // texel is a palette index, so it is sampled NEAREST (interpolating indices would blend to
      // unrelated colors). Width is range (CLAMP) and height is angle (REPEAT, so the 0/2pi seam wraps).
      this.#texW = maxSpokeLen;
      this.#texH = spokesPerRev;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        maxSpokeLen,
        spokesPerRev,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        maxSpokeLen,
        spokesPerRev,
        gl.RED,
        gl.UNSIGNED_BYTE,
        pixels,
      );
    }
    // Restore the default unpack alignment so a later MapLibre glyph or sprite upload is not mis-strided.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  setLegend(rgba: Uint8Array): void {
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#legendTex);
    if (!this.#legendUploaded) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.#legendUploaded = true;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    }
  }

  setOpacity(o: number): void {
    this.#opacity = o;
  }

  setHeading(rad: number): void {
    this.#heading = rad;
  }

  // The current scan angle as a texture column fraction [0, 1); undefined parks the sweep off-screen so
  // no wedge draws until the first spoke arrives.
  setSweep(a: number | undefined): void {
    this.#sweep = a === undefined ? -1 : a;
  }

  setSweepColor(rgb: [number, number, number]): void {
    this.#sweepColor = rgb;
  }

  render(matrix: CustomLayerMatrix, cx: number, cy: number, half: number): void {
    const gl = this.#gl;
    if (this.#spokes === 0) return;
    const loc = this.#loc;
    gl.useProgram(this.#program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    if (cx !== this.#lastCx || cy !== this.#lastCy || half !== this.#lastHalf) {
      this.#lastCx = cx;
      this.#lastCy = cy;
      this.#lastHalf = half;
      fillQuad(this.#quad, cx, cy, half);
      gl.bufferData(gl.ARRAY_BUFFER, this.#quad, gl.DYNAMIC_DRAW);
    }
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.enableVertexAttribArray(loc.local);
    gl.vertexAttribPointer(loc.local, 2, gl.FLOAT, false, VERTEX_STRIDE, 8);
    gl.uniformMatrix4fv(loc.matrix, false, matrixForWebGl(matrix, this.#matrixScratch));
    gl.uniform1f(loc.heading, this.#heading);
    gl.uniform1f(loc.opacity, this.#opacity);
    gl.uniform1f(loc.blip, this.#blip);
    gl.uniform1f(loc.sweep, this.#sweep);
    gl.uniform3fv(loc.sweepColor, this.#sweepColor);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#dataTex);
    gl.uniform1i(loc.data, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#legendTex);
    gl.uniform1i(loc.legend, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Restore the shared GL state MapLibre does not reset between custom layers, so this overlay never
    // corrupts a sibling layer (the rings, AIS, the vessel) drawn after it.
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(loc.pos);
    gl.disableVertexAttribArray(loc.local);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  dispose(): void {
    const gl = this.#gl;
    gl.deleteBuffer(this.#buffer);
    gl.deleteTexture(this.#dataTex);
    gl.deleteTexture(this.#legendTex);
    gl.deleteProgram(this.#program);
  }
}
