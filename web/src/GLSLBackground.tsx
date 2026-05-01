import { useEffect, useRef } from "react";

interface Props {
  lang: "en" | "ja";
  textLen: number; // normalised 0-1
}

const VERT = /* glsl */ `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Domain-warped fBm — dark, flowing, dissolving.
// u_lang:     0.0=en (cool blue-grey)  1.0=ja (warm amber)
// u_text_len: 0.0-1.0 — density / brightness
const FRAG = /* glsl */ `
precision mediump float;

uniform float u_time;
uniform float u_lang;
uniform float u_text_len;
uniform vec2  u_resolution;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.35));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),               hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  // rotate-scale matrix rows embedded inline for GLSL ES 1.0 compat
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    float px = 1.6 * p.x + 1.2 * p.y;
    float py = -1.2 * p.x + 1.6 * p.y;
    p = vec2(px, py);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * 0.10;

  // scale: denser / more turbulent with longer text
  float scale = 1.4 + u_text_len * 1.8;
  vec2 p = uv * scale;

  // domain warping — two rounds
  vec2 q = vec2(
    fbm(p + vec2(0.00, 0.00) + t * 0.28),
    fbm(p + vec2(5.20, 1.30) - t * 0.22)
  );

  float pattern = fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 0.08);

  // subtle texture on light background (multiply blend)
  float brightness = 0.82 + pattern * (0.12 + u_text_len * 0.08);

  vec3 cool = vec3(0.78, 0.82, 0.92); // cool grey-blue (en)
  vec3 warm = vec3(0.92, 0.80, 0.68); // warm beige (ja)
  vec3 col  = mix(cool, warm, u_lang) * brightness;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

export default function GLSLBackground({ lang, textLen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mutable state shared between prop-update effect and RAF loop
  const live = useRef({
    targetLang: lang === "ja" ? 1.0 : 0.0,
    currentLang: lang === "ja" ? 1.0 : 0.0,
    targetTextLen: textLen,
    currentTextLen: textLen,
  });

  // Keep targets in sync with props (no teardown needed)
  useEffect(() => {
    live.current.targetLang = lang === "ja" ? 1.0 : 0.0;
    live.current.targetTextLen = textLen;
  }, [lang, textLen]);

  // WebGL setup — runs once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl");
    if (!gl) return;

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Full-screen triangle pair
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const posLoc = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uLang = gl.getUniformLocation(prog, "u_lang");
    const uTextLen = gl.getUniformLocation(prog, "u_text_len");
    const uResolution = gl.getUniformLocation(prog, "u_resolution");

    const t0 = performance.now();

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl!.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener("resize", resize);

    let rafId: number;

    function loop() {
      const s = live.current;
      // Slow lerp for lang (colour shift ~3-4 s), fast for text_len
      s.currentLang += (s.targetLang - s.currentLang) * 0.012;
      s.currentTextLen += (s.targetTextLen - s.currentTextLen) * 0.06;

      gl!.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl!.uniform1f(uLang, s.currentLang);
      gl!.uniform1f(uTextLen, s.currentTextLen);
      gl!.uniform2f(uResolution, canvas!.width, canvas!.height);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
        display: "block",
        pointerEvents: "none",
        opacity: 0.35,
        mixBlendMode: "multiply",
      }}
    />
  );
}
