// webgl-wind technique (Vladimir Agafonkin, ISC), adapted to MapLibre: the draw vertex shader
// projects each particle from grid-normalized space through lon/lat and mercator to the map matrix,
// so the simulation stays camera-independent. Particle positions are byte-packed (two bytes per
// coordinate) so the layer works on WebGL1 and WebGL2 without float-texture extensions.

// A full-screen quad, used by the update pass and the screen draw pass.
export const QUAD_VERT = `
precision mediump float;
attribute vec2 a_pos;
varying vec2 v_tex_pos;
void main() {
  v_tex_pos = a_pos;
  gl_Position = vec4(1.0 - 2.0 * a_pos, 0.0, 1.0);
}`;

// Draw a screen texture with an opacity factor; used to fade the trail buffer and to blit it out.
export const SCREEN_FRAG = `
precision mediump float;
uniform sampler2D u_screen;
uniform float u_opacity;
varying vec2 v_tex_pos;
void main() {
  vec4 color = texture2D(u_screen, 1.0 - v_tex_pos);
  gl_FragColor = vec4(floor(255.0 * color * u_opacity) / 255.0);
}`;

// Advance every particle by the wind at its position; randomly respawn to avoid clumping and to
// reseed particles that flow off-grid or onto land (alpha 0) cells.
export const UPDATE_FRAG = `
precision highp float;
uniform sampler2D u_particles;
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_rand_seed;
uniform float u_speed_factor;
uniform float u_drop_rate;
uniform float u_drop_rate_bump;
varying vec2 v_tex_pos;

const vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);
float rand(const vec2 co) {
  float t = dot(rand_constants.xy, co);
  return fract(sin(t) * (rand_constants.z + t));
}

void main() {
  vec4 color = texture2D(u_particles, v_tex_pos);
  vec2 pos = vec2(color.r / 255.0 + color.b, color.g / 255.0 + color.a);
  vec4 w = texture2D(u_wind, pos);
  vec2 velocity = w.a < 0.5 ? vec2(0.0) : mix(u_wind_min, u_wind_max, w.rg);
  vec2 max_abs = max(abs(u_wind_min), abs(u_wind_max));
  float speed_t = clamp(length(velocity) / max(length(max_abs), 0.0001), 0.0, 1.0);
  vec2 offset = velocity * u_speed_factor;
  pos = fract(1.0 + pos + offset);
  vec2 seed = (pos + v_tex_pos) * u_rand_seed;
  float drop_rate = u_drop_rate + speed_t * u_drop_rate_bump;
  float drop = step(1.0 - drop_rate, rand(seed));
  float reset = max(drop, w.a < 0.5 ? 1.0 : 0.0);
  vec2 random_pos = vec2(rand(seed + 1.3), rand(seed + 2.1));
  pos = mix(pos, random_pos, reset);
  gl_FragColor = vec4(fract(pos * 255.0), floor(pos * 255.0) / 255.0);
}`;

// Project a particle to the screen via lon/lat and mercator, and pass its speed for coloring.
// u_speed_max is the color ramp's absolute top speed (RAMP_MAX_SPEED), not the grid's component
// maxima: the ramp texture and the legend span 0 to that fixed speed, so normalizing by the grid
// max would recolor the same wind differently from one fetch to the next.
export const DRAW_VERT = `
precision mediump float;
attribute float a_index;
uniform sampler2D u_particles;
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_speed_max;
uniform float u_particles_res;
uniform mat4 u_matrix;
uniform vec4 u_bounds;
varying float v_speed_t;
const float PI = 3.141592653589793;
void main() {
  vec4 color = texture2D(u_particles, vec2(
    fract(a_index / u_particles_res),
    floor(a_index / u_particles_res) / u_particles_res));
  vec2 pos = vec2(color.r / 255.0 + color.b, color.g / 255.0 + color.a);
  vec4 w = texture2D(u_wind, pos);
  vec2 velocity = w.a < 0.5 ? vec2(0.0) : mix(u_wind_min, u_wind_max, w.rg);
  v_speed_t = length(velocity) / u_speed_max;
  float lon = mix(u_bounds.x, u_bounds.z, pos.x);
  float lat = mix(u_bounds.y, u_bounds.w, pos.y);
  float mx = (lon + 180.0) / 360.0;
  float my = (180.0 - (180.0 / PI) * log(tan(PI / 4.0 + lat * PI / 360.0))) / 360.0;
  gl_Position = u_matrix * vec4(mx, my, 0.0, 1.0);
  gl_PointSize = 1.5;
}`;

// Color the particle by its normalized speed from the ramp texture.
export const DRAW_FRAG = `
precision mediump float;
uniform sampler2D u_color_ramp;
varying float v_speed_t;
void main() {
  gl_FragColor = texture2D(u_color_ramp, vec2(clamp(v_speed_t, 0.0, 1.0), 0.5));
}`;
