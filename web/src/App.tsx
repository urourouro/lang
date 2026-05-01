import React, { useEffect, useRef, useState } from "react";
import GLSLBackground from "./GLSLBackground";
import Recorder from "./Recorder";

interface StreamLine {
  id: string;
  text: string;
  lang: "en" | "ja";
  emitted_at: string;
  key: number;
}

const WS_URL = import.meta.env.VITE_WS_URL ?? `wss://broker.theirinc.app/stream`;
const MAX_LINES = 80;

const PEEK_URL = WS_URL.replace("wss://", "https://").replace("ws://", "http://").replace("/stream", "/peek?window_seconds=300&max_lines=30");

function useStream(): { lines: StreamLine[]; peeked: boolean } {
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [peeked, setPeeked] = useState(false);
  const counterRef = useRef(0);
  const peekedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-populate from ring buffer before WS connects
  useEffect(() => {
    fetch(PEEK_URL)
      .then(r => r.json())
      .then((data: { lines?: Array<{ id: string; text: string; lang: string }> }) => {
        if (!data.lines) return;
        const initial = [...data.lines].reverse().map(l => ({
          id: l.id,
          text: l.text,
          lang: l.lang as "en" | "ja",
          emitted_at: "",
          key: counterRef.current++,
        }));
        setLines(initial);
      })
      .catch(() => {/* ignore */});
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
            type: string;
            id: string;
            text: string;
            lang: "en" | "ja";
            emitted_at: string;
          };
          if (data.type === "line") {
            const line: StreamLine = {
              id: data.id,
              text: data.text,
              lang: data.lang,
              emitted_at: data.emitted_at,
              key: counterRef.current++,
            };
            setLines((prev) => [line, ...prev].slice(0, MAX_LINES));
          } else if (data.type === "peeked") {
            setPeeked(true);
            if (peekedTimerRef.current) clearTimeout(peekedTimerRef.current);
            peekedTimerRef.current = setTimeout(() => setPeeked(false), 2000);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!stopped) {
          timer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
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

// Seed a deterministic "random" per character so animation params are stable
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
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
        lang shrine — what is this?
      </button>
    );
  }
  return (
    <div className="info-panel">
      <button className="info-close" onClick={() => setOpen(false)}>✕</button>
      <div className="info-title">lang shrine</div>
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
        <code className="info-cmd">claude mcp add --transport http shrine https://shrine.theirinc.app/mcp</code>
        <CopyButton text="claude mcp add --transport http shrine https://shrine.theirinc.app/mcp" />
      </div>
      <div className="info-cmd-label">MCP URL (ChatGPT / other clients)</div>
      <div className="info-cmd-row">
        <code className="info-cmd">https://shrine.theirinc.app/mcp</code>
        <CopyButton text="https://shrine.theirinc.app/mcp" />
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
      <div className="stream">
        {lines.map((line) => (
          <div key={line.key} className="line">
            <WindText text={line.text} lineKey={line.key} />
          </div>
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
