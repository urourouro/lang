import { type CSSProperties, useEffect, useRef, useState } from "react";

interface RecordLine {
  id: string;
  text: string;
  lang: "en" | "ja";
  key: number;
  arrivedAt: number;
}

const WS_URL = `ws://${window.location.hostname}:3030/stream`;
const REC_W = 1920;
const REC_H = 1080;

const VERT = /* glsl */ `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

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

  float scale = 1.4 + u_text_len * 1.8;
  vec2 p = uv * scale;

  vec2 q = vec2(
    fbm(p + vec2(0.00, 0.00) + t * 0.28),
    fbm(p + vec2(5.20, 1.30) - t * 0.22)
  );

  float pattern = fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 0.08);

  float brightness = pattern * (0.09 + u_text_len * 0.07);

  vec3 cool = vec3(0.20, 0.34, 0.58);
  vec3 warm = vec3(0.58, 0.32, 0.12);
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

type BtnVariant = "start" | "stop" | "disabled";
function btnStyle(v: BtnVariant): CSSProperties {
  const base: CSSProperties = {
    padding: "10px 20px",
    border: "none",
    borderRadius: 6,
    fontFamily: "Inter, sans-serif",
    fontSize: 14,
    cursor: v === "disabled" ? "not-allowed" : "pointer",
  };
  if (v === "stop") return { ...base, background: "rgba(220,50,50,0.85)", color: "white" };
  if (v === "start") return { ...base, background: "rgba(255,255,255,0.15)", color: "white", backdropFilter: "blur(8px)" };
  return { ...base, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" };
}

export default function Recorder() {
  const webglCanvasRef = useRef<HTMLCanvasElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef<RecordLine[]>([]);
  const liveRef = useRef({ targetLang: 0, currentLang: 0, targetTextLen: 0.2, currentTextLen: 0.2 });
  const glStateRef = useRef<{
    gl: WebGLRenderingContext;
    uTime: WebGLUniformLocation | null;
    uLang: WebGLUniformLocation | null;
    uTextLen: WebGLUniformLocation | null;
    uRes: WebGLUniformLocation | null;
  } | null>(null);
  const t0 = useRef(performance.now());
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufRef = useRef<AudioBuffer | null>(null);

  const [recording, setRecording] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  const [status, setStatus] = useState("待機中");
  const [wsConnected, setWsConnected] = useState(false);

  // WebSocket — broker stream
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let counter = 0;

    function connect() {
      setWsConnected(false);
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data as string) as {
            type: string; id: string; text: string; lang: "en" | "ja";
          };
          if (d.type === "line") {
            const line: RecordLine = {
              id: d.id, text: d.text, lang: d.lang,
              key: counter++, arrivedAt: Date.now(),
            };
            linesRef.current = [line, ...linesRef.current].slice(0, 20);
            liveRef.current.targetLang = d.lang === "ja" ? 1 : 0;
            liveRef.current.targetTextLen = Math.min(d.text.length / 30, 1);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!stopped) timer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => { stopped = true; if (timer) clearTimeout(timer); ws?.close(); };
  }, []);

  // WebGL setup on off-screen canvas
  useEffect(() => {
    const canvas = webglCanvasRef.current;
    if (!canvas) return;
    canvas.width = REC_W;
    canvas.height = REC_H;

    // preserveDrawingBuffer so ctx.drawImage() can read it after each frame
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) return;

    const prog = gl.createProgram()!;
    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.useProgram(prog);

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
    gl.viewport(0, 0, REC_W, REC_H);

    glStateRef.current = {
      gl,
      uTime: gl.getUniformLocation(prog, "u_time"),
      uLang: gl.getUniformLocation(prog, "u_lang"),
      uTextLen: gl.getUniformLocation(prog, "u_text_len"),
      uRes: gl.getUniformLocation(prog, "u_resolution"),
    };

    return () => { gl.deleteProgram(prog); gl.deleteBuffer(buf); };
  }, []);

  // Composite canvas RAF — merges WebGL + text
  useEffect(() => {
    const composite = compositeCanvasRef.current;
    const webgl = webglCanvasRef.current;
    if (!composite || !webgl) return;
    composite.width = REC_W;
    composite.height = REC_H;

    const ctx = composite.getContext("2d");
    if (!ctx) return;

    let rafId: number;

    function loop() {
      // 1. Advance WebGL shader
      const state = glStateRef.current;
      if (state) {
        const { gl, uTime, uLang, uTextLen, uRes } = state;
        const s = liveRef.current;
        s.currentLang += (s.targetLang - s.currentLang) * 0.012;
        s.currentTextLen += (s.targetTextLen - s.currentTextLen) * 0.06;
        gl.uniform1f(uTime, (performance.now() - t0.current) / 1000);
        gl.uniform1f(uLang, s.currentLang);
        gl.uniform1f(uTextLen, s.currentTextLen);
        gl.uniform2f(uRes, REC_W, REC_H);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      // 2. Blit WebGL → composite
      ctx!.clearRect(0, 0, REC_W, REC_H);
      ctx!.drawImage(webgl!, 0, 0);

      // 3. Text overlay — newest at bottom, fade-in per line
      const now = Date.now();
      const visible = [...linesRef.current].reverse(); // oldest → newest (bottom-most)
      ctx!.font = '300 38px Inter, "Noto Sans JP", sans-serif';
      const lh = 60;
      const bottomY = REC_H - 120;
      const leftX = 120;
      const maxW = REC_W - 240;

      for (let i = 0; i < visible.length; i++) {
        const line = visible[i];
        const age = now - line.arrivedAt;
        const alpha = Math.min(age / 400, 1) * 0.88;
        const y = bottomY - (visible.length - 1 - i) * lh;
        if (y < 40) continue;
        ctx!.globalAlpha = alpha;
        ctx!.fillStyle = "white";
        ctx!.fillText(line.text, leftX, y, maxW);
      }
      ctx!.globalAlpha = 1;

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Try to load audio from web/public/uro_125.wav
  useEffect(() => {
    fetch("/uro_125.wav")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const ac = new AudioContext();
        return ac.decodeAudioData(buf).then((decoded) => { ac.close(); return decoded; });
      })
      .then((decoded) => {
        audioBufRef.current = decoded;
        setAudioReady(true);
      })
      .catch(() => {
        setAudioErr(
          "/uro_125.wav が見つかりません。web/public/ に配置するか、下でファイルを選択してください。"
        );
      });
  }, []);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file
      .arrayBuffer()
      .then((buf) => {
        const ac = new AudioContext();
        return ac.decodeAudioData(buf).then((decoded) => { ac.close(); return decoded; });
      })
      .then((decoded) => {
        audioBufRef.current = decoded;
        setAudioReady(true);
        setAudioErr(null);
      })
      .catch((err: Error) => setAudioErr(`デコードエラー: ${err.message}`));
  }

  function startRecording() {
    const composite = compositeCanvasRef.current;
    if (!composite || !audioBufRef.current) return;
    chunksRef.current = [];

    const videoStream = composite.captureStream(30);

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();

    const src = audioCtx.createBufferSource();
    src.buffer = audioBufRef.current;
    src.connect(dest);
    src.connect(audioCtx.destination); // monitor through speakers
    audioSrcRef.current = src;

    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mimeType =
      ["video/webm; codecs=vp8,opus", "video/webm; codecs=vp9,opus", "video/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t)
      ) ?? "video/webm";

    const recorder = new MediaRecorder(combined, { mimeType });
    mediaRecRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lang-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setStatus("ダウンロード完了");
      setRecording(false);
    };

    recorder.start(1000); // collect chunks every 1s
    src.start(0);
    setRecording(true);
    setStatus("録画中...");
  }

  function stopRecording() {
    mediaRecRef.current?.stop();
    try { audioSrcRef.current?.stop(); } catch { /* already stopped */ }
    audioCtxRef.current?.close().catch(() => {});
    setStatus("書き出し中...");
  }

  const canRecord = audioReady && !recording;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#080808", overflow: "hidden" }}>
      {/* WebGL canvas — kept off-screen so the browser doesn't skip rendering */}
      <canvas
        ref={webglCanvasRef}
        style={{ position: "fixed", left: -(REC_W + 10), top: 0, pointerEvents: "none" }}
      />

      {/* Composite canvas — letterboxed to viewport */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <canvas
          ref={compositeCanvasRef}
          style={{ maxWidth: "100%", maxHeight: "100%", display: "block" }}
        />
      </div>

      {/* Control panel */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 10,
          fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        }}
      >
        {/* Broker status dot */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: wsConnected ? "#4ade80" : "#f87171",
              flexShrink: 0,
            }}
          />
          <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 12 }}>
            {wsConnected ? "broker 接続中" : "broker 未接続 (再接続中...)"}
          </span>
        </div>

        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>{status}</div>

        {/* Audio error + file picker */}
        {audioErr && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 6,
            }}
          >
            <span
              style={{
                color: "rgba(255,130,130,0.9)",
                fontSize: 12,
                maxWidth: 340,
                textAlign: "right",
                lineHeight: 1.5,
              }}
            >
              {audioErr}
            </span>
            <label
              style={{
                padding: "6px 14px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.8)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              音声ファイル選択
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
            </label>
          </div>
        )}

        {/* Record / Stop button */}
        {recording ? (
          <button onClick={stopRecording} style={btnStyle("stop")}>
            ■ 停止してダウンロード
          </button>
        ) : (
          <button
            onClick={startRecording}
            disabled={!canRecord}
            style={btnStyle(canRecord ? "start" : "disabled")}
          >
            ● 録画開始
          </button>
        )}
      </div>
    </div>
  );
}
