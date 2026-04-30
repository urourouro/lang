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

const WS_URL = `ws://${window.location.hostname}:3030/stream`;
const MAX_LINES = 80;

function useStream(): { lines: StreamLine[]; peeked: boolean } {
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [peeked, setPeeked] = useState(false);
  const counterRef = useRef(0);
  const peekedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            {line.text}
          </div>
        ))}
      </div>
      <div className={`peeked-indicator${peeked ? " visible" : ""}`}>
        peeked by agent
      </div>
    </>
  );
}

export default function App() {
  if (window.location.pathname === "/record") return <Recorder />;
  return <StreamView />;
}
