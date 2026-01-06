# YouTube Live Chat 取得（配信URL）→ AIRI 会話入力化：計画まとめ

## ゴール
- **YouTube配信のライブチャット**をリアルタイム取得し、AIRIへ **`input:text` イベント**として流して「会話入力」にする。
- **stage-web / stage-tamagotchi（Electron）両方**で同じ設定UIから操作できるようにする。
- **スーパーチャット/スーパーステッカー**を初期から考慮し、テキスト整形に反映する。

---

## 全体アーキテクチャ（案A：モジュール側でOAuth callback待受）
- **UI（stage-web / stage-tamagotchi）**
  - 設定画面に YouTube LiveChat モジュールを追加
  - 配信URLの入力、接続/切断、状態表示
  - 設定を **`ui:configure`** でサーバーチャネルへ送る（既存Discord/Xと同じ）
- **YouTubeモジュール（新規 service/plugin）**
  - `@proj-airi/server-sdk` の `Client` として server-runtime のWSへ接続
  - **localhost callback を待ち受けるOAuthサーバ**を持つ（案A）
  - トークン取得/更新/保持、YouTube API呼び出し、ポーリング、重複排除
  - チャットを **`input:text`** でAIRIへ送出

---

## 認証方式（第一候補）
- **YouTube Data API v3 + OAuth 2.0（Authorization Code + PKCE）**
- **redirect_uri（localhost loopback）**で統一して両対応（Web/Electron）
  - 例: `http://127.0.0.1:17845/oauth/google/callback`
- **Google Cloud Console 側の準備（未作成）**
  - プロジェクト作成
  - **YouTube Data API v3** 有効化
  - OAuth同意画面の設定
  - OAuthクライアント作成（推奨: **Web application**）
  - redirect_uri に localhost callback を登録

---

## 入力仕様（初期は配信URLのみ）
- **入力**: 配信URL（`watch?v=...` / `youtu.be/...` / `live/...` 等）
- **解決フロー**
  - URL → `videoId` 抽出
  - `videos.list(part=liveStreamingDetails&id=videoId)` → `activeLiveChatId`
  - `liveChatMessages.list(liveChatId, part=snippet,authorDetails)` をポーリング
- **運用**
  - `pollingIntervalMillis` に従って間隔調整
  - `message.id` ベースで重複排除（短期キャッシュ）
  - エラー時は指数バックオフで再試行、ライブ終了も検知

---

## 出力仕様（AIRIに会話入力として流す）
- **送出イベント**: `input:text`
- **整形方針（スパチャ考慮）**
  - 通常: `"{author}: {message}"`
  - Super Chat: `"[SUPERCHAT {amountDisplayString}] {author}: {message}"`
  - Super Sticker: `"[SUPERSTICKER {amountDisplayString}] {author}"`
- **意図**
  - 初期はイベント型を増やさず **テキストにメタを埋め込む**ことで最短で価値を出す
  - 将来的にYouTube固有メタを構造化したければ `server-shared` のイベント型拡張を検討

---

## 実装マイルストーン（TODOベース）
### 1. 実現方式確定（完了）
- YouTube Data API v3 + OAuth 2.0（PKCE）で進める

### 2. 入力仕様確定（進行中）
- 配信URL→ `videoId` → `liveChatId` → ポーリング、重複排除、再接続戦略を固める

### 3. イベント/整形仕様確定（進行中）
- `input:text` への整形（通常/スパチャ/ステッカー）を決める

### 4. OAuth UIフロー設計（進行中）
- **モジュール側**が localhost callback を待受
- UIは「接続開始」操作と状態表示、設定保存（`ui:configure`）に専念
- トークン取得/更新/保持の責務はモジュール側へ集約

### 5. YouTubeモジュール実装（未着手）
- OAuth待受・トークン交換/更新
- LiveChat取得（API呼び出し・ポーリング・整形）
- `input:text` 送出（server-sdk `Client.send`）

### 6. UI実装（未着手）
- settings/modules に YouTube項目追加（modules list・ページ・store・component）
- 「Googleで接続」ボタン、配信URL入力、状態/エラー表示
- 設定保存で `ui:configure` を投げる

### 7. 検証（未着手）
- 実配信URLで受信→AIRI側に入力として流れることを確認
- レート制限/再接続/ライブ終了の挙動確認
- 設定手順（Google Cloud側含む）の整備

---

## 既知の注意点（現時点の前提）
- `plugins/airi-plugin-bilibili-laplace` は現状 **WIP** のため、実装パターンは **Discord/X（services側）のClient接続モデル**を踏襲する。
- OAuth関連コードは既存に薄そうなので、**新規でPKCE/待受/トークン交換**を作る必要がある。
