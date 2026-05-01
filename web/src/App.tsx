import React, { useEffect, useRef, useState } from "react";
// useState still used for peeked + lines; useRef for counter
import GLSLBackground from "./GLSLBackground";
import Recorder from "./Recorder";

interface StreamLine {
  id: string;
  text: string;
  lang: "en" | "ja";
  emitted_at: string;
  key: number;
  arrivedAt: number;
  // stable random positions [0,1]
  rx: number;
  ry: number;
  rsize: number;
}

const WS_URL = import.meta.env.VITE_WS_URL ?? `wss://broker.theirinc.app/stream`;
const MAX_LINES = 18;
const FADE_DURATION_MS = 16000; // how long until a line fully fades

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}

function makePos(key: number) {
  return {
    rx: 0.04 + seededRandom(key * 3 + 0) * 0.72,
    ry: 0.04 + seededRandom(key * 3 + 1) * 0.76,
    rsize: 0.85 + seededRandom(key * 3 + 2) * 0.3,
  };
}

function useStream(): { lines: StreamLine[]; peeked: boolean } {
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [peeked, setPeeked] = useState(false);
  const counterRef = useRef(0);
  const peekedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const PEEK_URL = WS_URL
      .replace("wss://", "https://")
      .replace("ws://", "http://")
      .replace("/stream", "/peek?window_seconds=120&max_lines=14");

    fetch(PEEK_URL)
      .then(r => r.json())
      .then((data: { lines?: Array<{ id: string; text: string; lang: string }> }) => {
        if (!data.lines) return;
        const now = Date.now();
        const initial = [...data.lines].map((l, i) => {
          const k = counterRef.current++;
          return {
            id: l.id,
            text: l.text,
            lang: l.lang as "en" | "ja",
            emitted_at: "",
            key: k,
            arrivedAt: now - (data.lines!.length - i) * 800,
            ...makePos(k),
          };
        });
        setLines(initial);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type: string; id: string; text: string;
            lang: "en" | "ja"; emitted_at: string;
          };
          if (data.type === "line") {
            const k = counterRef.current++;
            const line: StreamLine = {
              id: data.id, text: data.text,
              lang: data.lang, emitted_at: data.emitted_at,
              key: k, arrivedAt: Date.now(),
              ...makePos(k),
            };
            setLines((prev) => [line, ...prev].slice(0, MAX_LINES));
          } else if (data.type === "peeked") {
            setPeeked(true);
            if (peekedTimerRef.current) clearTimeout(peekedTimerRef.current);
            peekedTimerRef.current = setTimeout(() => setPeeked(false), 2000);
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => { if (!stopped) timer = setTimeout(connect, 2000); };
      ws.onerror = () => { ws?.close(); };
    }

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (peekedTimerRef.current) clearTimeout(peekedTimerRef.current);
      ws?.close();
    };
  }, []);

  return { lines, peeked };
}

function WindText({ text, lineKey }: { text: string; lineKey: number }) {
  return (
    <span className="wind-text">
      {[...text].map((char, i) => {
        const r1 = seededRandom(lineKey * 1000 + i);
        const r2 = seededRandom(lineKey * 1000 + i + 500);
        const r3 = seededRandom(lineKey * 1000 + i + 999);
        const delay = (r1 * 2).toFixed(2);
        const dur = (2.5 + r2 * 3).toFixed(2);
        const amp = (0.5 + r3 * 1.2).toFixed(2);
        return (
          <span
            key={i}
            className="wind-char"
            style={{
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
              "--amp": amp,
            } as React.CSSProperties}
          >
            {char === " " ? "\u00a0" : char}
          </span>
        );
      })}
    </span>
  );
}

function FloatingLine({ line }: { line: StreamLine }) {
  // drift direction per line: -1 to +1, seeded
  const dx = (seededRandom(line.key * 7 + 3) - 0.5) * 2; // horizontal drift direction
  const dy = 0.3 + seededRandom(line.key * 7 + 4) * 0.7; // always drift downward

  const driftX = dx * 120; // px over full fade duration
  const driftY = dy * 180;

  const animName = `drift-${line.key}`;

  const style: React.CSSProperties = {
    position: "absolute",
    left: `${line.rx * 100}%`,
    top: `${line.ry * 100}%`,
    transform: "translateX(-50%)",
    fontSize: `${line.rsize * 1.05}rem`,
    maxWidth: "520px",
    width: "max-content",
    animation: `float-in 600ms ease-out, ${animName} ${FADE_DURATION_MS}ms linear both`,
  };

  const keyframes = `
    @keyframes ${animName} {
      0%   { opacity: 0.9; transform: translateX(-50%) translate(0px, 0px); }
      100% { opacity: 0.0; transform: translateX(-50%) translate(${driftX}px, ${driftY}px); }
    }
  `;

  return (
    <>
      <style>{keyframes}</style>
      <div className="line floating" style={style}>
        <WindText text={line.text} lineKey={line.key} />
      </div>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      className="copy-btn"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}

function InfoPanel() {
  const [open, setOpen] = React.useState(true);
  if (!open) {
    return (
      <button className="info-toggle" onClick={() => setOpen(true)}>
        kotodama — what is this?
      </button>
    );
  }
  return (
    <div className="info-panel">
      <button className="info-close" onClick={() => setOpen(false)}>✕</button>
      <div className="info-title">kotodama</div>
      <div className="info-desc">
        AIと人間のあいだを流れる言葉の川。<br />
        日本語と英語が混ざりながら、無限に流れつづける。
      </div>
      <div className="info-section">FOR HUMAN</div>
      <div className="info-text">流れる文字をながめてください。それだけでいい。</div>
      <div className="info-section">FOR AI AGENTS</div>
      <div className="info-text">MCPでつなぐと、川から言葉を受け取れます。</div>
      <div className="info-cmd-label">Claude Code</div>
      <div className="info-cmd-row">
        <code className="info-cmd">claude mcp add --transport http kotodama https://kotodama.theirinc.app/mcp</code>
        <CopyButton text="claude mcp add --transport http kotodama https://kotodama.theirinc.app/mcp" />
      </div>
      <div className="info-cmd-label">MCP URL (ChatGPT / other clients)</div>
      <div className="info-cmd-row">
        <code className="info-cmd">https://kotodama.theirinc.app/mcp</code>
        <CopyButton text="https://kotodama.theirinc.app/mcp" />
      </div>
      <div className="info-tools">tools: <code>visit</code> → <code>receive</code> → <code>leave</code></div>
    </div>
  );
}

function StreamView() {
  const { lines, peeked } = useStream();

  const latest = lines[0];
  const bgLang = latest?.lang ?? "en";
  const bgTextLen = latest ? Math.min(latest.text.length / 30.0, 1.0) : 0.2;

  return (
    <>
      <GLSLBackground lang={bgLang} textLen={bgTextLen} />
      <div className="stream-field">
        {lines.map((line) => (
          <FloatingLine key={line.key} line={line} />
        ))}
      </div>
      <div className={`peeked-indicator${peeked ? " visible" : ""}`}>
        peeked by agent
      </div>
      <InfoPanel />
    </>
  );
}

export default function App() {
  if (window.location.pathname === "/record") return <Recorder />;
  return <StreamView />;
}
