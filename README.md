# lang — 言葉の小川

Brian Eno の Oblique Strategies 翻案。英語・日本語の詩行が小川のように流れ続けるシステム。

## 構成

```
generator-en/   Python  gpt2-medium 連続生成 → stdout JSON Lines  (Mac mini)
generator-ja/   Python  rinna/japanese-gpt2-medium → stdout JSON Lines  (Mac mini)
broker/         Node.js ring buffer + /peek HTTP + /stream WebSocket
shrine/         Node.js MCP サーバ (visit / receive / linger / leave)
web/            React   フロントエンド可視化
```

### デプロイ構成

```
Mac mini
  ├── generator-en  (GPT-2 heavy, runs locally)
  ├── generator-ja  (rinna GPT-2, runs locally)
  └── broker (local)  ──POST /ingest──▶  Render: lang-broker
                                              │
                                         Render: lang-shrine
```

---

## ローカル起動

### 前提

- Python 3.11+, [uv](https://docs.astral.sh/uv/)
- Node.js 20+, npm

### broker + generators を一括起動

```bash
cd broker && npm install && npm run dev
```

broker が `../generator-en` と `../generator-ja` を自動起動します。
初回は GPT-2 モデル (各 ~1.5 GB) をダウンロードします。

### shrine を起動

```bash
cd shrine && npm install && npm run dev
```

### エンドポイント確認

```bash
# 直近 10 秒の詩行を取得
curl http://localhost:3030/peek

# shrine MCP
curl -X POST http://localhost:3031/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### broker 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `PORT` | `3030` | HTTP ポート |
| `GENERATOR_EN_DIR` | `../generator-en` | generator-en のパス |
| `GENERATOR_JA_DIR` | `../generator-ja` | generator-ja のパス |
| `SPAWN_GENERATORS` | `true` | `false` で generator 起動を無効化 |
| `INGEST_SECRET` | (なし) | Bearer token 認証。設定時は POST /ingest に必須 |
| `REMOTE_BROKER_URL` | (なし) | 設定時、ローカル generator の出力をリモート broker に転送 |

---

## Render へのデプロイ

### 初回セットアップ

1. [Render](https://render.com) でアカウント作成・リポジトリ連携
2. リポジトリルートの `render.yaml` から Blueprint をデプロイ

   ```
   Render Dashboard → New → Blueprint → リポジトリを選択
   ```

3. `lang-broker` サービスの `INGEST_SECRET` 環境変数の値をコピーする

### Mac mini の broker 設定

ローカルの broker から Render の broker に転送するため、以下の環境変数を設定:

```bash
export REMOTE_BROKER_URL=https://lang-broker.onrender.com
export INGEST_SECRET=<Render で生成された値>
```

その後 broker を起動:

```bash
cd broker && npm run dev
```

generator の出力が自動的に Render の broker にも転送されます。

### shrine の BROKER_URL

Render 上の shrine は `render.yaml` で `BROKER_URL` が自動設定されます (`lang-broker` の `RENDER_EXTERNAL_URL`)。

---

## MCP tools (shrine)

shrine は [Model Context Protocol](https://modelcontextprotocol.io) サーバとして動作します。
Claude Desktop や Claude Code から接続して言葉の川を体験できます。

### ツール一覧

| ツール | 説明 |
|--------|------|
| `visit` | 神社に参拝する。言葉の川から最初の言葉を受け取る |
| `receive` | 川から言葉をさらに 1 つ受け取る |
| `linger` | 神社に佇み、これまで受け取った全言葉を振り返る |
| `leave` | 神社を去る。受け取った全言葉をおみくじとして持ち帰る |

### `.mcp.json` 設定例 (ローカル)

```json
{
  "mcpServers": {
    "lang-shrine": {
      "type": "http",
      "url": "http://localhost:3031/mcp"
    }
  }
}
```

### Render 上の shrine に接続する場合

```json
{
  "mcpServers": {
    "lang-shrine": {
      "type": "http",
      "url": "https://lang-shrine.onrender.com/mcp"
    }
  }
}
```

### shrine ダッシュボード

`http://localhost:3031/` (または Render URL) で現在の参拝者一覧を確認できます (5 秒自動更新)。

---

## POST /ingest (broker)

外部から詩行を直接 broker に追加できます。

```bash
curl -X POST http://localhost:3030/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <INGEST_SECRET>" \
  -d '{"text": "the mirror forgets", "lang": "en"}'
```

`INGEST_SECRET` が未設定の場合、認証なしで受け付けます。

---

## 開発マイルストーン

- [x] **M1**: generator-en (gpt2-medium, MPS, JSON Lines stdout)
- [x] **M2**: broker (ring buffer, `/peek` HTTP)
- [x] **M3**: broker `/stream` WebSocket + web フロントエンド
- [x] **M4**: generator-ja (rinna/japanese-gpt2-medium)
- [x] **M5**: shrine MCP サーバ
- [x] **M6**: `peeked by agent` インジケータ
- [x] **M7**: Render deploy (broker + shrine)
