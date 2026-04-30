import express, { Request, Response } from "express";
import cors from "cors";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { randomUUID } from "crypto";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

interface BufferLine {
  id: string;
  text: string;
  lang: "en" | "ja";
  emitted_at: string;
}

const PORT = parseInt(process.env.PORT ?? "3030", 10);
const GENERATOR_EN_DIR =
  process.env.GENERATOR_EN_DIR ?? path.resolve(__dirname, "../../generator-en");
const GENERATOR_JA_DIR =
  process.env.GENERATOR_JA_DIR ?? path.resolve(__dirname, "../../generator-ja");
const RING_BUFFER_MS = 5 * 60 * 1000;
const INGEST_SECRET = process.env.INGEST_SECRET;
const REMOTE_BROKER_URL = process.env.REMOTE_BROKER_URL;
const SPAWN_GENERATORS = process.env.SPAWN_GENERATORS !== "false";

const ringBuffer: BufferLine[] = [];
const wsClients = new Set<WebSocket>();

function pruneBuffer() {
  const cutoff = Date.now() - RING_BUFFER_MS;
  while (ringBuffer.length > 0 && new Date(ringBuffer[0].emitted_at).getTime() < cutoff) {
    ringBuffer.shift();
  }
}

function addLine(text: string, lang: "en" | "ja", ts: string) {
  pruneBuffer();
  const line: BufferLine = { id: randomUUID(), text, lang, emitted_at: ts };
  ringBuffer.push(line);

  const msg = JSON.stringify({ type: "line", ...line });
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

async function forwardToRemote(text: string, lang: "en" | "ja"): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (INGEST_SECRET) headers["Authorization"] = `Bearer ${INGEST_SECRET}`;
  const res = await fetch(`${REMOTE_BROKER_URL}/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, lang }),
  });
  if (!res.ok) throw new Error(`remote broker returned ${res.status}`);
}

function spawnGenerator(dir: string, name: string) {
  console.log(`[broker] spawning ${name} from ${dir}`);
  const proc = spawn("uv", ["run", "python", "generate.py"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "inherit"],
  });

  proc.on("error", (err) => {
    console.error(`[broker] ${name} spawn error: ${err.message}`);
  });

  proc.on("exit", (code) => {
    console.error(`[broker] ${name} exited (code=${code}), restarting in 3s`);
    setTimeout(() => spawnGenerator(dir, name), 3000);
  });

  if (proc.stdout) {
    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      try {
        const data = JSON.parse(line) as { text: string; lang: string; ts: string };
        if (data.text && data.lang && data.ts) {
          addLine(data.text, data.lang as "en" | "ja", data.ts);
          if (REMOTE_BROKER_URL) {
            forwardToRemote(data.text, data.lang as "en" | "ja").catch((err) => {
              console.error(`[broker] remote forward error: ${err.message}`);
            });
          }
        }
      } catch {
        // ignore malformed lines
      }
    });
  }
}

if (SPAWN_GENERATORS) {
  spawnGenerator(GENERATOR_EN_DIR, "generator-en");
  spawnGenerator(GENERATOR_JA_DIR, "generator-ja");
} else {
  console.log("[broker] generator spawning disabled (SPAWN_GENERATORS=false)");
}

const app = express();
app.use(cors());
app.use(express.json());

app.post("/ingest", (req: Request, res: Response) => {
  if (INGEST_SECRET) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${INGEST_SECRET}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }
  const { text, lang } = req.body as { text?: string; lang?: string };
  if (!text || (lang !== "en" && lang !== "ja")) {
    res.status(400).json({ error: "invalid body: text and lang (en|ja) required" });
    return;
  }
  addLine(text, lang as "en" | "ja", new Date().toISOString());
  res.json({ ok: true });
});

app.post("/notify-peeked", (_req: Request, res: Response) => {
  const msg = JSON.stringify({ type: "peeked" });
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
  res.json({ ok: true });
});

app.get("/peek", (req: Request, res: Response) => {
  const windowSeconds = parseFloat((req.query["window_seconds"] as string) ?? "10");
  const maxLines = parseInt((req.query["max_lines"] as string) ?? "20", 10);

  pruneBuffer();
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;

  const lines = ringBuffer
    .filter((l) => new Date(l.emitted_at).getTime() >= cutoff)
    .slice(-maxLines)
    .reverse()
    .map((l) => {
      const age_ms = now - new Date(l.emitted_at).getTime();
      const opacity = Math.max(0, Math.min(1, 1 - age_ms / (windowSeconds * 1000)));
      return { id: l.id, text: l.text, lang: l.lang, age_ms, opacity };
    });

  res.json({ now: new Date(now).toISOString(), lines });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/stream" });

wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`[broker] listening on :${PORT}`);
});
