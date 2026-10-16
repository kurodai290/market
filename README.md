# COIN MARKET — Cloudflare版

架空コイン専用ゲーム。実際のお金や金融商品は扱いません。

## 含まれる機能
- 登録・ログイン（bcryptによるパスワードハッシュ）
- 登録時100コイン、クリックごとに1コイン
- 商品出品・購入
- 架空株3種類の売買と保有株表示
- 株価は60秒以上経過後の次回アクセスで変動
- マイページ、取引履歴
- 元の濃紺・青緑・オレンジのUI

## Cloudflareに無料枠で配置する手順

1. Cloudflare Dashboard → Workers & Pages → Create → D1 SQL database で `coin-market-db` という名前のD1を作ります。
2. 作成したD1のIDをコピーし、`wrangler.jsonc` の `REPLACE_WITH_D1_DATABASE_ID` に貼り付けます。
3. D1のConsoleで `schema.sql` の内容を実行します。
4. GitHubリポジトリのルートに、このZIP内のファイルをアップロードします。元の `index.html`, `app.js`, `style.css` は `public/` 内に配置してください。古い `server.js`, `railway.json` はCloudflare版では使用しません。
5. Cloudflare Workers & PagesでGitHubリポジトリを接続します。Build commandは `npm install`、Deploy commandは `npx wrangler deploy`、Root directoryは `/` にします。Assetsは `wrangler.jsonc` により `public/` だけが配信されます。
6. Workersの Settings → Variables and Secrets で `SESSION_SECRET` をSecretとして追加し、32文字以上のランダム文字列を設定します。
7. Deploymentsからデプロイし、公開URLの `/api/health` を開いて `{"ok":true,...}` が返ることを確認します。

## 注意
- `wrangler.jsonc` のD1 IDを設定しないとデプロイできません。
- Workerの `SESSION_SECRET` は必ず設定してください。これはログインセッションの署名に使われます。
- 無料枠には利用量上限があります。課金設定を有効にせず、Cloudflareの利用量画面を確認してください。
- このサンプルは学習・ゲーム用です。本格公開前には購入競合時の完全な整合性、CSRF/レート制限、セキュリティレビューを追加してください。
