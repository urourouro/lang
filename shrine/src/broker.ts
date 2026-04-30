const BROKER_URL = process.env.BROKER_URL ?? "http://localhost:3030";

interface PeekLine {
  id: string;
  text: string;
  lang: string;
  age_ms: number;
  opacity: number;
}

interface PeekResponse {
  now: string;
  lines: PeekLine[];
}

export async function peekWord(): Promise<string> {
  const res = await fetch(`${BROKER_URL}/peek?window_seconds=30&max_lines=20`);
  if (!res.ok) throw new Error(`broker returned ${res.status}`);
  const data = (await res.json()) as PeekResponse;
  if (!data.lines || data.lines.length === 0) return "(川は静かです)";
  const line = data.lines[Math.floor(Math.random() * data.lines.length)];
  return line.lang === "ja" ? `〔和〕${line.text}` : line.text;
}
