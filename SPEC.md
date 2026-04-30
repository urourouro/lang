# lang — 言葉の小川 / a stream of language

## 1. コンセプト

Brian Eno の Oblique Strategies の翻案。カードを引く代わりに、**両言語(英語/日本語)の現代詩風の行が小川のように途切れなく流れ続けるWebページ**を作る。並行して **MCP サーバ**を立て、エージェント(Claude等)が好きなタイミングで「いま川に流れている言葉」を `peek` できるようにする。

エージェントは流れてくる言葉に**プロンプトインジェクションされる**ことが意図された動作である。流れる言葉に従うか、抗うか、無視するかはエージェントの自由。これがEnoの「カードを引いた作家」の構造に対応する。

## 2. ねらい(美学)

- **壊れている**ことを良しとする。文法の崩壊、意味の脱線、未完の文末、これらを除去せず作品成分として扱う。
- 滑らかな最新LLMの「上手すぎる」出力ではなく、GPT-2 medium 級の**やや壊れた生成**を使う。
- コーパスのfine-tuneは**しない**。素のGPT-2/rinna に高温度サンプリングとポストプロセスを掛けることで「散文を詩のレイアウトで切る」ことの認識論的ズレを作品にする。
- 言語が混ざることそのものが意味になる。**1本の川に英日が混在する**(2列に分けない)。

## 3. 全体構成

```
generator-en/   Python  gpt2-medium 連続生成 → stdout に1行ずつ
generator-ja/   Python  rinna/japanese-gpt2-medium 連続生成 → stdout
broker/         Node    両generatorのstdoutを読み、ring buffer 保持
                        - WebSocket: /stream  (web購読用)
                        - HTTP:      GET /peek?window_seconds=10&max_lines=20
mcp/            TS      MCPサーバ。tool: peek(window_seconds, max_lines)
                        broker の /peek を呼び出して整形
web/            Next.js WebSocket購読、行をfade-in / fade-out で縦に流す
```

各プロセスは独立して起動可。`pnpm`/`npm` でmonorepo化(turborepoは過剰、単純なnpm workspaces で十分)。Python側は `uv` 推奨、最低 venv。

## 4. コンポーネント詳細

### 4.1 generator-en / generator-ja

**目的**:詩の「行」を一本ずつ無限に吐き出し続ける。

**モデル**
- en: `gpt2-medium`(355M)
- ja: `rinna/japanese-gpt2-medium`(336M)
- 両方 transformers + `device="mps"` で動作。fp16 ロード。

**生成パラメータ**(両方共通)
- `temperature`: 1.3〜1.6 (起動時に環境変数で調整可)
- `top_p`: 0.95
- `top_k`: 0(無効化)
- `repetition_penalty`: 1.0(ループ容認)
- `max_new_tokens`: 30〜80程度

**プロンプトseed**(短く曖昧に)
- en 例:`"the mirror"`, `"once,"`, `"in the corner of"`, `"forget"`, `""`(空でも可)
- ja 例:`"夜の"`, `"もう、"`, `"鏡"`, `"わたしは"`, `""`
- ランダムに選択。一度の生成ごとに別のseed。

**ポストプロセス**(これが効く)
1. 生成テキストから句読点・改行・空白で**フラグメント化**
2. 文長フィルタ:概ね 5〜25文字(ja) / 3〜10語(en)程度の行を抽出
3. 文の途中で切る寛容さ(「……であ」のような未完を許す)
4. 抽出された各フラグメントを stdout に**1行 = 1 詩行**として出力

**出力フォーマット**(stdout、1行1JSON)
```json
{"text": "the mirror forgets", "lang": "en", "ts": "2026-04-28T16:24:00.123Z"}
```

**ペース**:1行を吐いたら 0.5〜2.0秒のランダム sleep(broker側でmergeすると自然になる)。

### 4.2 broker

**目的**:両generatorのstdoutを統合し、(a) WebSocketでwebに配信、(b) ring bufferに保持して `/peek` を提供。

**ring buffer**
- 直近 **5分間** の行を保持(memory only、永続化なし)
- 各行に `id`(uuid)、`text`、`lang`、`emitted_at`(ISO8601)を持つ

**HTTP API**
```
GET /peek?window_seconds=10&max_lines=20

200 OK
{
  "now": "2026-04-28T16:24:00.500Z",
  "lines": [
    {
      "id": "...",
      "text": "the mirror forgets",
      "lang": "en",
      "age_ms": 200,
      "opacity": 1.0
    },
    {
      "id": "...",
      "text": "もう、ひかりが",
      "lang": "ja",
      "age_ms": 2400,
      "opacity": 0.7
    },
    {
      "id": "...",
      "text": "rooms inside rooms",
      "lang": "en",
      "age_ms": 5800,
      "opacity": 0.3
    }
  ]
}
```

`opacity` は `1.0 - (age_ms / (window_seconds * 1000))` をclamp [0, 1]。エージェントが「消えかけ」と「現れたて」を区別するためのメタ。

新しい順 → 古い順で並べる。`max_lines` 件数で打ち切り。

**WebSocket** `/stream`
- 接続中の全クライアントに、新行を即座にbroadcastする。
- メッセージ:`{"type": "line", "id": "...", "text": "...", "lang": "...", "emitted_at": "..."}`

### 4.3 mcp

**目的**:Claude Code 等から `peek` を呼べる MCPサーバ。

**Tool定義**(1個だけ)

```
name: peek
description: いま「言葉の小川」に流れている直近の詩行を取得する。覗くだけで何も変えない。
input_schema:
  type: object
  properties:
    window_seconds:
      type: number
      default: 10
      description: 何秒前までの行を取得するか
    max_lines:
      type: number
      default: 20
      description: 最大行数
output: brokerの/peekレスポンスをそのまま返す
```

実装は thin wrapper。MCP仕様は `@modelcontextprotocol/sdk` (TS版) を使う。stdio transport。

**設定例**(Claude Code 側 `.mcp.json` 等)
```json
{
  "mcpServers": {
    "lang-stream": {
      "command": "node",
      "args": ["/path/to/mcp/dist/index.js"],
      "env": { "BROKER_URL": "http://localhost:3030" }
    }
  }
}
```

### 4.4 web

**目的**:人間が眺める用のフロントエンド。詩行が小川のように縦に流れる。

**フレームワーク**:Next.js (App Router) または Vite + React。SSR必須ではない。

**画面**
- 黒〜濃灰背景、サンセリフ細字(Inter / Noto Sans JP)
- 中央1カラム、最大幅 600px 程度
- 新しい行が**下から現れて上にゆっくり流れていく**(または上→下、好みで)
- 各行 fade-in 400ms、表示中はopacity 1.0、画面外に近づくにつれfade-out
- 流速:**読めるが追いきれない**速度。1行2〜4秒間隔(brokerからの配信タイミングそのまま)
- 言語の混在を視覚的に演出しない(色分けしない、フォントも分けない、混ざっていることが意味)
- スクロールバーなし、ヘッダーなし、タイトルもなし。**ただ流れる**だけ

**接続**:WebSocket `/stream` を購読。再接続のretry handling。

**任意機能**(余裕があれば)
- 右下に小さく `peeked by agent` インジケータ:エージェントが peek した瞬間に薄く光る。MCPサーバから broker に notify する経路を追加すれば実現できる。これは作品的に**強い**ので余力あればぜひ。

## 5. データ仕様まとめ

### Line(共通スキーマ)
```ts
type Line = {
  id: string;          // uuid
  text: string;
  lang: "en" | "ja";
  emitted_at: string;  // ISO8601
};
```

### PeekResponse
```ts
type PeekResponse = {
  now: string;  // ISO8601
  lines: Array<{
    id: string;
    text: string;
    lang: "en" | "ja";
    age_ms: number;
    opacity: number;  // 0.0 - 1.0
  }>;
};
```

## 6. 技術スタック

| 領域 | 採用 |
|------|------|
| generator | Python 3.11+, PyTorch (MPS backend), transformers |
| broker | Node 20+, TypeScript, Fastify or Express, ws |
| mcp | Node 20+, TypeScript, @modelcontextprotocol/sdk |
| web | Next.js 15 + React 19, TailwindCSS |
| プロセス管理 | dev: 各々別ターミナル / `concurrently` |

ハードウェア前提:Apple Silicon (M4 Pro / M4 Max など) 16GB unified memory。両generator + web + broker 同時起動でメモリ8GB前後消費を見込む。

## 7. 開発マイルストーン

1. **M1: generator-en 単体**
   - gpt2-medium を MPS で読み込み
   - 高tempサンプリング + ポストプロセス
   - stdout に JSON Lines で吐き続ける
   - 動作確認:ターミナルでそれっぽい行が流れること

2. **M2: broker + /peek**
   - generator-en の stdout を読み、ring buffer
   - `/peek` HTTP endpoint
   - `curl localhost:3030/peek` で peek の手触り検証
   - **この時点で MCP も web もなくてコンセプト検証ができる**

3. **M3: web (WebSocket流し)**
   - broker に WebSocket /stream 追加
   - Next.js から購読、fade-in/out で表示

4. **M4: generator-ja 追加**
   - rinna gpt2-medium を別プロセスで起動
   - broker に2本目のstdin経路を追加
   - 川が日英混在で流れることを確認

5. **M5: MCP**
   - peek tool の MCPサーバ実装
   - Claude Code から peek を呼べることを確認

6. **M6 (任意): peek通知をwebにフィードバック**
   - `peeked by agent` インジケータ

## 8. 非機能要件・制約

- **永続化なし**:DB不要。再起動で過去の行は消える(川なので)。
- **認証なし**:ローカル運用前提。外部公開する場合は別途検討。
- **CORS**:dev中は web から broker への接続を許可。
- **ログ**:各プロセス stdout に最低限。詩行そのものはログに残さない方針(残してもいいが、川は残らない美学)。
- **エラーハンドリング**:generator が落ちても broker と web は生きる。reconnect、retry。

## 9. 明示的に未決定(実装者の裁量)

これらは仕様で固定せず、実装/試走で良い感触を探ってほしい:

- 行の流れる方向(下→上 か 上→下 か)
- 行間アニメーションのカーブ(linear / ease-in-out / 水のような揺らぎ)
- 言語比率(英:日 = 4:6 をデフォルトに、好みで)
- generator の seed 語彙の選定(seed.txt として外出しすると調整しやすい)
- 行のフラグメント化のしきい値(5-25文字, 3-10語あたりは目安)
- 流速(2-4秒/行を初期値、調整可能に)
- フォント / 文字色 / 背景色

## 10. 受け入れ基準(完了の定義)

- [ ] generator-en, generator-ja が個別に詩行をstdoutに吐き続ける
- [ ] broker が両者を統合し ring buffer に保持
- [ ] `curl /peek` で直近の行が age_ms / opacity 付きで返る
- [ ] web が WebSocket購読で fade-in/out しながら詩行を流し続ける
- [ ] Claude Code から MCP `peek` が呼べ、流れている言葉が取れる
- [ ] 5〜10分連続稼働してメモリリーク・generator hangがないこと

---

参考:Brian Eno & Peter Schmidt, *Oblique Strategies* (1975-) / Allison Parrish のAI詩作品 / Ross Goodwin *1 the Road* (2018)
