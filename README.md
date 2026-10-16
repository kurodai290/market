# COIN MARKET（架空コイン売買ゲーム）

HTML/CSS/JavaScript + Node.js/Express + PostgreSQL で作ったゲームです。実際のお金や金融商品は扱いません。

## 機能
- ユーザー登録・ログイン（パスワードはbcryptでハッシュ化）
- 登録時に架空コイン100枚
- クリック1回でサーバー側から1コイン加算
- 商品の出品・購入、購入者から出品者へのコイン移動
- ゲーム内株3種類の売買・保有数表示
- 株価は60秒ごとにランダム変動
- マイページの出品一覧と取引履歴
- 濃紺・青緑・オレンジのダークUI

## GitHub + Railwayへの配置
1. ZIPを展開し、すべてのファイルと `public` フォルダをGitHubリポジトリの直下にアップロードします。
2. RailwayでGitHubリポジトリからアプリをデプロイします。
3. RailwayプロジェクトにPostgreSQLを追加し、アプリサービスの `DATABASE_URL` がそのDBを参照するように設定します。
4. Variablesに `SESSION_SECRET` を長いランダム文字列で設定し、`NODE_ENV=production` を設定します。
5. 再デプロイし、公開URLの `/api/health` が `{"ok":true,"service":"coin-market-game"}` を返すことを確認します。

## ローカル起動
Node.js 20以上とPostgreSQLが必要です。`DATABASE_URL` を設定してから `npm install`、`npm start` を実行してください。

## 注意
PostgreSQLが未設定だとデータを失う誤運用を避けるためサーバーは起動しません。公開運用前にはレート制限、CSRF対策、永続セッションストアなどを追加してください。株価はゲーム内シミュレーションで、実在企業や実際の市場価格とは関係ありません。
