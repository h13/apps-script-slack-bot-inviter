# Slack Bot Inviter

[![CI](https://github.com/h13/apps-script-slack-bot-inviter/actions/workflows/ci.yml/badge.svg)](https://github.com/h13/apps-script-slack-bot-inviter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/h13/apps-script-slack-bot-inviter/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4.svg)](https://developers.google.com/apps-script)

[English](README.md)

**スラッシュコマンド1つで、自分が所属する全 Slack チャンネルに bot を一括招待。** ワークスペースの誰でも使える。各自が初回に1度だけ認可すれば、アプリは「その人のメンバーシップ」で動くので、トークンを手で扱うことなく private チャンネルにも招待できる。

[apps-script-fleet](https://github.com/h13/apps-script-fleet) テンプレートから生成。[apps-script-slack-channel-archiver](https://github.com/h13/apps-script-slack-channel-archiver) のコンパニオンツール — アーカイバ bot は public チャンネルには自分で参加できるが、private チャンネルには*招待*が必要。その招待を自動化する。

## 仕組み

```
/bot-inviter archiver
  → doPost（GAS ウェブアプリ）
      → 初回: 「Authorize」リンクを ephemeral で返す（Slack OAuth v2, user scopes）
          → doGet が code を交換し、ユーザートークンを保存（Script Properties）
      → 2回目以降: ジョブ登録 + ワンショットトリガー、「処理中」と即応答
  → processInviteJobs（トリガー）
      → users.conversations: 自分が所属するチャンネル一覧（デフォルトは private のみ）
      → conversations.invite: 各チャンネルに bot を招待
      → 結果サマリーを response_url 経由で ephemeral 投稿
```

設計原則: **招待はユーザーの行為、アーカイブはアプリの行為。** 本アプリはユーザー毎のトークン（`xoxp`、OAuth で取得 — 誰も手で入力・閲覧しない）を使い、アーカイバのような bot はユーザー非依存の `xoxb` を使い続ける。責務ごとに正しいトークンモデルを1つずつ。

## クイックスタート（デプロイする人向け）

### 1. Apps Script ウェブアプリのデプロイ

[apps-script-fleet](https://github.com/h13/apps-script-fleet)（`./scripts/init.sh`）または `clasp create` で dev/prod のスクリプトプロジェクトを用意し:

```bash
pnpm install
pnpm run deploy        # dev
pnpm run deploy:prod   # prod
```

Apps Script エディタで **デプロイ → 新しいデプロイ → ウェブアプリ**:

- **次のユーザーとして実行**: 自分
- **アクセスできるユーザー**: 全員

ウェブアプリ URL（`https://script.google.com/macros/s/…/exec`）を控える。以降のコード更新は **デプロイを管理** から*同じデプロイ*に対して行うと URL が変わらない。

### 2. Slack アプリの作成

[api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest** → [`slack-app-manifest.yml`](slack-app-manifest.yml) の `REPLACE_WITH_DEPLOYMENT_ID` を含む URL 2箇所を手順1の URL に置き換えて貼り付け → **Install to Workspace**。

### 3. Script Properties の設定

Apps Script エディタ: プロジェクトの設定（歯車アイコン）→ スクリプト プロパティ:

| key                        | value                                                                  | 必須   |
| -------------------------- | ---------------------------------------------------------------------- | ------ |
| `SLACK_CLIENT_ID`          | App credentials → Client ID                                            | はい   |
| `SLACK_CLIENT_SECRET`      | App credentials → Client Secret                                        | はい   |
| `SLACK_VERIFICATION_TOKEN` | App credentials → Verification Token                                   | はい   |
| `TARGET_BOTS`              | `alias=BOT_USER_ID[,alias=BOT_USER_ID…]` 例: `archiver=U0123ABCD`      | はい   |
| `INCLUDE_PUBLIC_CHANNELS`  | `true` で public チャンネルにも招待（デフォルト: private のみ）        | いいえ |

bot のユーザー ID の調べ方: Slack で bot のプロフィールを開く → 「…」メニュー → **メンバー ID をコピー**（`U…`/`W…`）。

### 4. 使い方

ワークスペースの誰でも:

```
/bot-inviter            # 設定済み bot が1つだけのとき
/bot-inviter archiver   # エイリアスで bot を指定
```

初回は **Authorize** リンクが返る（1人1回だけ）。認可後にもう一度コマンドを実行すると、1分以内に「招待した / 参加済み / 失敗」のチャンネル別サマリーが届く。

## セキュリティモデル

- **ユーザー毎の OAuth トークン**（`xoxp`）は Slack の OAuth v2 フローで取得し、Script Properties（`USER_TOKEN_<ユーザーID>`）に保存。誰もトークンを入力・閲覧しない。各トークンは所有者が所属するチャンネルにしか作用せず、所有者のアカウントと運命を共にする — 招待という操作にはそれが正しいスコープ。
- **Script Properties は Apps Script プロジェクトの編集者から読める。** プロジェクトの編集者は管理者だけに絞ること。利用者は Slack → **Settings & administration → Manage apps → Bot Inviter** からいつでも認可を取り消せる。失効したトークンは次回実行時に検出して削除される。
- **CSRF**: OAuth の `state` は、コマンドを実行した Slack ユーザーに紐づく使い捨てノンス（TTL 10分）。認可したユーザーがノンスの発行先と一致しない場合は拒否する。
- **SSRF**: `response_url` は `https://hooks.slack.com/` 配下の場合のみ POST する。
- **リクエスト検証**: GAS ウェブアプリは HTTP ヘッダを公開しないため、署名シークレット方式（`X-Slack-Signature`）はこのランタイムでは検証不可能。代わりにレガシーの verification token を検証する — 弱いため verification token は秘密情報として扱うこと。漏えいした場合、偽装者は認可済みユーザーの代わりに*設定済み* bot の招待を発火させ、その結果サマリー（チャンネル名を含む）を任意の response_url で受け取れる。漏えいが疑われる場合はアプリ設定からトークンを再生成する。

## 制限

- Script Properties は最大約500キー — 1デプロイあたり約490人まで認可可能。
- 1回の実行は5分で打ち切り（GAS の上限は6分）、打ち切り時はその旨を報告。コマンドを再実行すれば続きから処理される。
- `conversations.invite` は Slack 側のレート制限（Tier 3）を受ける。所属チャンネルが非常に多い場合は数回に分かれることがある。

## プロジェクト構成

```
src/
├── index.ts          # GAS エントリポイント（doPost, doGet, processInviteJobs）
├── config.ts         # 型・Script Property キー・スコープ・制限値
├── target-bots.ts    # TARGET_BOTS のパースとエイリアス解決（純粋関数）
├── oauth-url.ts      # OAuth v2 認可 URL 生成（純粋関数）
├── messages.ts       # Slack メッセージ組み立て（純粋関数）
├── store.ts          # Script Properties / キャッシュ / トリガー管理
├── slack-client.ts   # Slack Web API ラッパー（ステートレス）
└── setProperties.ts  # CI/CD からの clasp run 用プロパティ注入ヘルパー
test/
├── target-bots.test.ts
├── oauth-url.test.ts
└── messages.test.ts
```

## 開発

| コマンド               | 説明                                     |
| ---------------------- | ---------------------------------------- |
| `pnpm run check`       | lint + typecheck + test（全チェック）    |
| `pnpm run build`       | TypeScript をバンドルして `dist/` に出力 |
| `pnpm run test`        | Jest（カバレッジ付き）                   |
| `pnpm run deploy`      | check → build → dev にデプロイ           |
| `pnpm run deploy:prod` | check → build → 本番にデプロイ           |

## CI/CD

CI は全 push と PR で実行。CD は `dev` または `main` へのマージで自動デプロイ — GitHub Actions の environment 別 secrets/variables で設定する。詳細は [apps-script-fleet のドキュメント](https://github.com/h13/apps-script-fleet#cicd-パイプライン)を参照。

## 注意事項

- `src/index.ts` の関数に `export` キーワードは付けない（GAS ランタイムは ES モジュール構文を認識できない）
- `src/index.ts`, `src/slack-client.ts`, `src/store.ts`, `src/setProperties.ts` はテストカバレッジ対象外（GAS グローバルが Node.js で実行不可のため）
- カバレッジ閾値: 全メトリクス 80%（`jest.config.json` で変更可）

## ライセンス

[MIT](LICENSE)
