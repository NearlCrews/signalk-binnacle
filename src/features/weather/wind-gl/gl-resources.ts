export type GL = WebGLRenderingContext | WebGL2RenderingContext;

function createShader(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  }
  return shader;
}

export function createProgram(gl: GL, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  const vertShader = createShader(gl, gl.VERTEX_SHADER, vert);
  const fragShader = createShader(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  }
  // The linked program is self-contained, so release the shader objects after linking; otherwise
  // every built program leaks its two compiled shaders.
  gl.detachShader(program, vertShader);
  gl.detachShader(program, fragShader);
  gl.deleteShader(vertShader);
  gl.deleteShader(fragShader);
  return program;
}

export function createTexture(
  gl: GL,
  filter: number,
  data: Uint8Array | null,
  w: number,
  h: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

export function createBuffer(gl: GL, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('createBuffer failed');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}
