import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createVisit, getVisit, addWord, departVisit, getAllVisits } from "./state.js";
import { peekWord } from "./broker.js";

const PORT = 3031;

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "lang-shrine", version: "0.1.0" });

  server.tool(
    "visit",
    "神社に参拝する。言葉の川から最初の言葉を受け取る。",
    { agent_name: z.string().describe("エージェントの名前") },
    async ({ agent_name }) => {
      const word = await peekWord().catch(() => "(川は静かです)");
      const visit = createVisit(agent_name);
      addWord(visit.id, word);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            visit_id: visit.id,
            greeting: `静かな場所です。言葉が降ってきました: ${word}`,
            first_word: word,
          }),
        }],
      };
    }
  );

  server.tool(
    "receive",
    "川から言葉をさらに1つ受け取る。",
    { visit_id: z.string().describe("visitのID") },
    async ({ visit_id }) => {
      const visit = getVisit(visit_id);
      if (!visit) throw new Error(`visit ${visit_id} not found`);
      const word = await peekWord().catch(() => "(川は静かです)");
      addWord(visit_id, word);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ word, total_received: visit.words.length }),
        }],
      };
    }
  );

  server.tool(
    "linger",
    "神社に佇み、これまで受け取った全言葉を振り返る。",
    { visit_id: z.string().describe("visitのID") },
    async ({ visit_id }) => {
      const visit = getVisit(visit_id);
      if (!visit) throw new Error(`visit ${visit_id} not found`);
      const duration_seconds = Math.floor((Date.now() - visit.arrivedAt) / 1000);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ words: visit.words, duration_seconds }),
        }],
      };
    }
  );

  server.tool(
    "leave",
    "神社を去る。受け取った全言葉をおみくじとして持ち帰る。",
    { visit_id: z.string().describe("visitのID") },
    async ({ visit_id }) => {
      const visit = departVisit(visit_id);
      if (!visit) throw new Error(`visit ${visit_id} not found`);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            omikuji: visit.words,
            farewell: "持ち帰るものがあるといいですね",
          }),
        }],
      };
    }
  );

  return server;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  const all = getAllVisits();
  const present = all.filter((v) => v.status === "present");
  const departed = all
    .filter((v) => v.status === "departed")
    .sort((a, b) => (b.departedAt ?? 0) - (a.departedAt ?? 0))
    .slice(0, 10);

  const now = Date.now();
  const dur = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}秒` : `${Math.floor(s / 60)}分${s % 60}秒`;
  };

  const presentHtml =
    present.length === 0
      ? '<p class="empty">誰もいません</p>'
      : present
          .map(
            (v) =>
              `<div class="v"><span class="name">${escapeHtml(v.agentName)}</span>` +
              `<div class="meta">滞在: ${dur(now - v.arrivedAt)} · 言葉: ${v.words.length}個</div></div>`
          )
          .join("");

  const departedHtml =
    departed.length === 0
      ? '<p class="empty">まだ誰も去っていません</p>'
      : departed
          .map(
            (v) =>
              `<div class="v"><span class="name">${escapeHtml(v.agentName)}</span>` +
              `<div class="word">${escapeHtml(v.words[0] ?? "")}</div></div>`
          )
          .join("");

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="5">
<title>lang神社</title>
<style>
body{background:#000;color:#ccc;font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem}
h1{color:#888;font-weight:normal;font-size:1.2rem;letter-spacing:.2em}
h2{color:#555;font-weight:normal;font-size:.85rem;margin-top:2rem;border-top:1px solid #111;padding-top:1rem;letter-spacing:.1em}
.v{margin:.8rem 0}
.name{color:#ddd}
.meta{color:#444;font-size:.8rem;margin-top:.2rem}
.word{color:#888;font-size:.85rem;margin-top:.2rem;font-style:italic}
.empty{color:#333;font-style:italic}
</style>
</head>
<body>
<h1>lang 神社</h1>
<h2>現在の参拝者 (${present.length})</h2>
${presentHtml}
<h2>最近去っていった参拝者</h2>
${departedHtml}
</body>
</html>`);
});

app.get("/visits", (_req, res) => {
  res.json(getAllVisits());
});

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on("finish", () => {
    mcpServer.close().catch(() => {});
  });
});

app.listen(PORT, () => {
  console.log(`[shrine] listening on :${PORT}`);
});
