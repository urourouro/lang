import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BROKER_URL = process.env.BROKER_URL ?? "http://localhost:3030";

const server = new McpServer({
  name: "lang-stream",
  version: "0.1.0",
});

server.tool(
  "peek",
  "いま「言葉の小川」に流れている直近の詩行を取得する。覗くだけで何も変えない。",
  {
    window_seconds: z
      .number()
      .default(10)
      .describe("何秒前までの行を取得するか"),
    max_lines: z.number().default(20).describe("最大行数"),
  },
  async ({ window_seconds, max_lines }) => {
    const url = `${BROKER_URL}/peek?window_seconds=${window_seconds}&max_lines=${max_lines}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`broker returned ${res.status}`);
    }
    const data = await res.json();

    // M6: notify broker that an agent peeked (fire-and-forget)
    fetch(`${BROKER_URL}/notify-peeked`, { method: "POST" }).catch(() => {});

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
