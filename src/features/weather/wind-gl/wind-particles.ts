import { type CustomLayerMatrix, matrixForWebGl } from '$shared/map';
import { RAMP_MAX_SPEED, RAMP_WIDTH } from '../wind-color-texture';
import type { WindField } from '../wind-field-texture';
import { createBuffer, createProgram, createTexture, type GL } from './gl-resources';
import { DRAW_FRAG, DRAW_VERT, QUAD_VERT, SCREEN_FRAG, UPDATE_FRAG } from './shaders';

// Two RGBA trail textures are kept for the fade ping-pong. Cap each at one megapixel and 2048 on
// either axis so a high-density or ultrawide display cannot turn the weather overlay into an
// unbounded GPU allocation. WebGL 1 implementations support textures at least this large.
export const MAX_WIND_TRAIL_PIXELS = 1024 * 1024;
const MAX_WIND_TRAIL_DIMENSION = 2048;

export interface WindTrailSize {
  width: number;
  height: number;
}

export function windTrailSize(widthPx: number, heightPx: number): WindTrailSize {
  const width = Number.isFinite(widthPx) ? Math.max(1, Math.floor(widthPx)) : 1;
  const height = Number.isFinite(heightPx) ? Math.max(1, Math.floor(heightPx)) : 1;
  const scale = Math.min(
    1,
    MAX_WIND_TRAIL_DIMENSION / width,
    MAX_WIND_TRAIL_DIMENSION / height,
    Math.sqrt(MAX_WIND_TRAIL_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export interface WindParticlesOptions {
  // Square root of the particle count; particleCount = resolution^2. ~90 gives ~8100 on a Pi GPU.
  resolution?: number;
  // Scales velocity into a per-frame offset in grid-normalized units, with no aspect correction:
  // motion direction skews slightly in non-square bboxes, an accepted approximation for an
  // ambient flow visualization (the upstream webgl-wind technique does the same).
  speedFactor?: number;
  dropRate?: number;
  dropRateBump?: number;
  fadeOpacity?: number;
}

type Uniform = WebGLUniformLocation | null;

// Attribute and uniform locations are constant for the life of a linked program, and
// getAttribLocation/getUniformLocation are slow GL calls. They are resolved once at construction
// and read from these caches every frame instead of being re-queried in the render loop.
interface ScreenLoc {
  aPos: number;
  uScreen: Uniform;
  uOpacity: Uniform;
}
interface UpdateLoc {
  aPos: number;
  uParticles: Uniform;
  uWind: Uniform;
  uWindMin: Uniform;
  uWindMax: Uniform;
  uRandSeed: Uniform;
  uSpeedFactor: Uniform;
  uDropRate: Uniform;
  uDropRateBump: Uniform;
}
interface DrawLoc {
  aIndex: number;
  uParticles: Uniform;
  uWind: Uniform;
  uColorRamp: Uniform;
  uParticlesRes: Uniform;
  uMatrix: Uniform;
  uWindMin: Uniform;
  uWindMax: Uniform;
  uSpeedMax: Uniform;
  uBounds: Uniform;
}

export class WindParticles {
  #gl: GL;
  // The GL resources are built by #build, called from the constructor and again from reinit after a
  // WebGL context-loss/restore, so they carry definite-assignment assertions.
  #updateProgram!: WebGLProgram;
  #drawProgram!: WebGLProgram;
  #screenProgram!: WebGLProgram;
  #screenLoc!: ScreenLoc;
  #updateLoc!: UpdateLoc;
  #drawLoc!: DrawLoc;
  #quadBuffer!: WebGLBuffer;
  #indexBuffer!: WebGLBuffer;
  #framebuffer!: WebGLFramebuffer;
  #colorRamp!: WebGLTexture;
  #wind: WebGLTexture | undefined;
  #field: WindField | undefined;
  #rampPixels: Uint8Array | undefined;
  #state0!: WebGLTexture;
  #state1!: WebGLTexture;
  #screen0!: WebGLTexture;
  #screen1!: WebGLTexture;
  #screenW = 0;
  #screenH = 0;
  #res: number;
  #count: number;
  #speedFactor: number;
  #dropRate: number;
  #dropRateBump: number;
  #fadeOpacity: number;
  #opacity = 1;
  readonly #matrixScratch = new Float32Array(16);

  constructor(gl: GL, options: WindParticlesOptions = {}) {
    this.#gl = gl;
    this.#res = options.resolution ?? 90;
    this.#count = this.#res * this.#res;
    this.#speedFactor = options.speedFactor ?? 0.0008;
    this.#dropRate = options.dropRate ?? 0.003;
    this.#dropRateBump = options.dropRateBump ?? 0.01;
    this.#fadeOpacity = options.fadeOpacity ?? 0.96;
    this.#build();
  }

  #build(): void {
    const gl = this.#gl;
    this.#updateProgram = createProgram(gl, QUAD_VERT, UPDATE_FRAG);
    this.#drawProgram = createProgram(gl, DRAW_VERT, DRAW_FRAG);
    this.#screenProgram = createProgram(gl, QUAD_VERT, SCREEN_FRAG);
    this.#screenLoc = {
      aPos: gl.getAttribLocation(this.#screenProgram, 'a_pos'),
      uScreen: gl.getUniformLocation(this.#screenProgram, 'u_screen'),
      uOpacity: gl.getUniformLocation(this.#screenProgram, 'u_opacity'),
    };
    this.#updateLoc = {
      aPos: gl.getAttribLocation(this.#updateProgram, 'a_pos'),
      uParticles: gl.getUniformLocation(this.#updateProgram, 'u_particles'),
      uWind: gl.getUniformLocation(this.#updateProgram, 'u_wind'),
      uWindMin: gl.getUniformLocation(this.#updateProgram, 'u_wind_min'),
      uWindMax: gl.getUniformLocation(this.#updateProgram, 'u_wind_max'),
      uRandSeed: gl.getUniformLocation(this.#updateProgram, 'u_rand_seed'),
      uSpeedFactor: gl.getUniformLocation(this.#updateProgram, 'u_speed_factor'),
      uDropRate: gl.getUniformLocation(this.#updateProgram, 'u_drop_rate'),
      uDropRateBump: gl.getUniformLocation(this.#updateProgram, 'u_drop_rate_bump'),
    };
    this.#drawLoc = {
      aIndex: gl.getAttribLocation(this.#drawProgram, 'a_index'),
      uParticles: gl.getUniformLocation(this.#drawProgram, 'u_particles'),
      uWind: gl.getUniformLocation(this.#drawProgram, 'u_wind'),
      uColorRamp: gl.getUniformLocation(this.#drawProgram, 'u_color_ramp'),
      uParticlesRes: gl.getUniformLocation(this.#drawProgram, 'u_particles_res'),
      uMatrix: gl.getUniformLocation(this.#drawProgram, 'u_matrix'),
      uWindMin: gl.getUniformLocation(this.#drawProgram, 'u_wind_min'),
      uWindMax: gl.getUniformLocation(this.#drawProgram, 'u_wind_max'),
      uSpeedMax: gl.getUniformLocation(this.#drawProgram, 'u_speed_max'),
      uBounds: gl.getUniformLocation(this.#drawProgram, 'u_bounds'),
    };
    this.#quadBuffer = createBuffer(gl, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
    const indices = new Float32Array(this.#count);
    for (let i = 0; i < this.#count; i += 1) indices[i] = i;
    this.#indexBuffer = createBuffer(gl, indices);
    const fb = gl.createFramebuffer();
    if (!fb) throw new Error('createFramebuffer failed');
    this.#framebuffer = fb;
    this.#colorRamp = createTexture(gl, gl.LINEAR, null, RAMP_WIDTH, 1);
    const seed = this.#randomState();
    this.#state0 = createTexture(gl, gl.NEAREST, seed, this.#res, this.#res);
    this.#state1 = createTexture(gl, gl.NEAREST, seed, this.#res, this.#res);
    this.#screen0 = createTexture(gl, gl.NEAREST, null, 1, 1);
    this.#screen1 = createTexture(gl, gl.NEAREST, null, 1, 1);
    this.#wind = undefined;
    this.#screenW = 0;
    this.#screenH = 0;
  }

  // Rebuild every GL resource after a WebGL context-loss/restore, then re-push the last theme ramp
  // and wind field so the field recovers instead of staying dead with stale handles. The opacity is
  // a plain number, so it survives untouched.
  reinit(): void {
    this.#build();
    if (this.#rampPixels) this.setTheme(this.#rampPixels);
    if (this.#field) this.setWind(this.#field);
  }

  #randomState(): Uint8Array {
    const state = new Uint8Array(this.#count * 4);
    for (let i = 0; i < state.length; i += 1) state[i] = Math.floor(Math.random() * 256);
    return state;
  }

  setWind(field: WindField): void {
    const gl = this.#gl;
    const prev = this.#field;
    this.#field = field;
    // Reuse the existing texture when dimensions match (the common case for time-step advances
    // on the same forecast model), avoiding the delete/create overhead. Falls back to a full
    // texture creation on a size change, the first call, or after a context-loss rebuild (#wind
    // is cleared then, so this always takes the recreate path once regardless of prev's size).
    if (this.#wind && prev && prev.width === field.width && prev.height === field.height) {
      gl.bindTexture(gl.TEXTURE_2D, this.#wind);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        field.width,
        field.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        field.data,
      );
      gl.bindTexture(gl.TEXTURE_2D, null);
    } else {
      if (this.#wind) gl.deleteTexture(this.#wind);
      this.#wind = createTexture(gl, gl.LINEAR, field.data, field.width, field.height);
    }
  }

  setTheme(rampPixels: Uint8Array): void {
    this.#rampPixels = rampPixels;
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#colorRamp);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      RAMP_WIDTH,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rampPixels,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  setOpacity(opacity: number): void {
    this.#opacity = opacity;
  }

  #resizeScreen(viewportWidth: number, viewportHeight: number): WindTrailSize {
    const { width, height } = windTrailSize(viewportWidth, viewportHeight);
    if (width === this.#screenW && height === this.#screenH) return { width, height };
    const gl = this.#gl;
    gl.deleteTexture(this.#screen0);
    gl.deleteTexture(this.#screen1);
    // A null upload allocates zero-initialized texture storage without also creating a same-sized
    // CPU buffer for each resize.
    this.#screen0 = createTexture(gl, gl.NEAREST, null, width, height);
    this.#screen1 = createTexture(gl, gl.NEAREST, null, width, height);
    this.#screenW = width;
    this.#screenH = height;
    return { width, height };
  }

  #bindAttribute(buffer: WebGLBuffer, location: number, size: number): void {
    const gl = this.#gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  #drawTexture(texture: WebGLTexture, opacity: number): void {
    const gl = this.#gl;
    const loc = this.#screenLoc;
    gl.useProgram(this.#screenProgram);
    this.#bindAttribute(this.#quadBuffer, loc.aPos, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(loc.uScreen, 0);
    gl.uniform1f(loc.uOpacity, opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  #updateParticles(): void {
    const gl = this.#gl;
    if (!this.#wind || !this.#field) return;
    const loc = this.#updateLoc;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#state1, 0);
    gl.viewport(0, 0, this.#res, this.#res);
    gl.useProgram(this.#updateProgram);
    this.#bindAttribute(this.#quadBuffer, loc.aPos, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#state0);
    gl.uniform1i(loc.uParticles, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#wind);
    gl.uniform1i(loc.uWind, 1);
    gl.uniform2f(loc.uWindMin, this.#field.uMin, this.#field.vMin);
    gl.uniform2f(loc.uWindMax, this.#field.uMax, this.#field.vMax);
    gl.uniform1f(loc.uRandSeed, Math.random());
    gl.uniform1f(loc.uSpeedFactor, this.#speedFactor);
    gl.uniform1f(loc.uDropRate, this.#dropRate);
    gl.uniform1f(loc.uDropRateBump, this.#dropRateBump);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const tmp = this.#state0;
    this.#state0 = this.#state1;
    this.#state1 = tmp;
  }

  #drawParticles(matrix: CustomLayerMatrix): void {
    const gl = this.#gl;
    if (!this.#wind || !this.#field) return;
    const loc = this.#drawLoc;
    gl.useProgram(this.#drawProgram);
    this.#bindAttribute(this.#indexBuffer, loc.aIndex, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#state0);
    gl.uniform1i(loc.uParticles, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#wind);
    gl.uniform1i(loc.uWind, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.#colorRamp);
    gl.uniform1i(loc.uColorRamp, 2);
    gl.uniform1f(loc.uParticlesRes, this.#res);
    gl.uniformMatrix4fv(loc.uMatrix, false, matrixForWebGl(matrix, this.#matrixScratch));
    gl.uniform2f(loc.uWindMin, this.#field.uMin, this.#field.vMin);
    gl.uniform2f(loc.uWindMax, this.#field.uMax, this.#field.vMax);
    gl.uniform1f(loc.uSpeedMax, RAMP_MAX_SPEED);
    gl.uniform4f(
      loc.uBounds,
      this.#field.west,
      this.#field.south,
      this.#field.east,
      this.#field.north,
    );
    gl.drawArrays(gl.POINTS, 0, this.#count);
  }

  // Run the update, draw into the fading trail buffer, and blit to the map. `moved` clears the trail
  // so screen-space accumulation never smears after a pan or zoom.
  render(matrix: CustomLayerMatrix, widthPx: number, heightPx: number, moved: boolean): void {
    const gl = this.#gl;
    if (!this.#wind || !this.#field) return;
    const trailSize = this.#resizeScreen(widthPx, heightPx);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    this.#updateParticles();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#screen1, 0);
    // The map matrix produces clip-space coordinates, so drawing into a proportionally scaled
    // viewport and stretching the finished texture back to the full viewport preserves alignment.
    gl.viewport(0, 0, trailSize.width, trailSize.height);
    if (moved) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else {
      this.#drawTexture(this.#screen0, this.#fadeOpacity);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.#drawParticles(matrix);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, widthPx, heightPx);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.#drawTexture(this.#screen1, this.#opacity);
    gl.disable(gl.BLEND);

    const tmp = this.#screen0;
    this.#screen0 = this.#screen1;
    this.#screen1 = tmp;
  }

  // Re-blit the last composed trail (in #screen0 after the most recent render swap) to the map without
  // stepping the simulation. Used on throttled frames so the field stays visible every map composite
  // while the particles advance only at the capped rate.
  blit(widthPx: number, heightPx: number): void {
    const gl = this.#gl;
    if (!this.#wind || !this.#field) return;
    this.#resizeScreen(widthPx, heightPx);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, widthPx, heightPx);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.#drawTexture(this.#screen0, this.#opacity);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.#gl;
    gl.deleteProgram(this.#updateProgram);
    gl.deleteProgram(this.#drawProgram);
    gl.deleteProgram(this.#screenProgram);
    gl.deleteBuffer(this.#quadBuffer);
    gl.deleteBuffer(this.#indexBuffer);
    gl.deleteFramebuffer(this.#framebuffer);
    gl.deleteTexture(this.#colorRamp);
    gl.deleteTexture(this.#state0);
    gl.deleteTexture(this.#state1);
    gl.deleteTexture(this.#screen0);
    gl.deleteTexture(this.#screen1);
    if (this.#wind) gl.deleteTexture(this.#wind);
  }
}
