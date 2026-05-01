import { useEffect, useRef, useState } from "react";
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
      <div className="about">
        <span className="about-title">lang shrine</span>
        <span className="about-sep"> — </span>
        <span>words flow between AI and human, in Japanese and English.</span>
        <br />
        <span className="about-mcp">AI agents: MCP endpoint at </span>
        <a className="about-link" href="https://shrine.theirinc.app/mcp" target="_blank" rel="noreferrer">shrine.theirinc.app/mcp</a>
        <span className="about-mcp"> — tools: </span>
        <code>visit</code><span className="about-mcp">, </span>
        <code>receive</code><span className="about-mcp">, </span>
        <code>leave</code>
      </div>
    </>
  );
}

export default function App() {
  if (window.location.pathname === "/record") return <Recorder />;
  return <StreamView />;
}
