# LINE MUSIC to YouTube Playlist

LINE MUSICのプレイリストURLから曲情報を取得し、候補動画を確認しながらYouTubeプレイリストに追加するCLIツールです。

## できること

- LINE MUSICプレイリストの曲情報を取得
- 曲名とアーティスト名でYouTube動画候補を検索
- 1曲ごとに追加する動画を手動で選択
- 選択した動画を指定のYouTubeプレイリストへ追加

## 前提条件

- Node.js 18以上
- Google Cloudで作成したOAuthクライアント情報（`credentials.json`）
- 追加先のYouTubeプレイリストURL
- 公開されているLINE MUSICプレイリストURL

## セットアップ

1. 依存関係をインストール

```bash
npm install
```

2. 環境変数ファイルを作成

```bash
cp .env.example .env
```

Windows PowerShellの場合:

```powershell
Copy-Item .env.example .env
```

3. `.env` を編集

```env
# YouTube OAuth2 redirect URI
# credentials.json の redirect_uris に含まれている必要があります
YOUTUBE_REDIRECT_URI=http://localhost:3000

# LINE MUSIC プレイリストURL
LineMusicPlaylistURL=https://music.line.me/webapp/playlist/xxxxxxx

# YouTube プレイリストURL
YouTubePlaylistURL=https://www.youtube.com/playlist?list=xxxxxxx
```

4. `credentials.json` をプロジェクト直下に配置

- Google Cloud ConsoleでOAuth 2.0クライアントを作成
- APIとサービスでYouTube Data API v3を有効化
- ダウンロードしたJSONを `credentials.json` としてプロジェクトのrootディレクトリに配置

## 使い方

### 1. LINE MUSICから曲情報を取得

```bash
npm run get-playlist
```

実行後、以下のファイルが更新されます。

- `tracks/sourceData.json`: LINE MUSIC APIの生データのうち、そのプレイリストに含まれるトラックの全データ
- `tracks/tracedData.json`: タイトル・アーティストを抽出したデータ

### 2. YouTube候補を選択してプレイリストへ追加

```bash
npm run create-playlist
```

実行フロー:

- 各曲について候補動画が最大5件表示
- 入力:
  - `1`〜`5`: 該当候補を追加
  - `s` または空入力: スキップ
  - `q`: 中断
- 最後に追加件数を確認し、`y`で実行
- 初回のみOAuth認証が走り、トークンが `.credentials/youtube-playlist-token.json` に保存

## npm scripts

- `npm run get-playlist`: LINE MUSICの曲情報を取得
- `npm run create-playlist`: 候補選択してYouTubeプレイリストに追加

## トラブルシュート

- LINE MUSIC取得に失敗する
  - `.env` の `LineMusicPlaylistURL` が正しいか確認
  - プレイリスト公開設定が「公開」か確認

- OAuth認証で失敗する
  - `YOUTUBE_REDIRECT_URI` が `credentials.json` の `redirect_uris` に含まれているか確認
  - `.credentials/youtube-playlist-token.json` を削除して再認証

- プレイリストIDエラー
  - `.env` の `YouTubePlaylistURL` に `?list=...` が含まれているか確認

## 補足

- このツールは手動選択前提のため、同一曲でも別バージョンが候補に出ることがあります。

## 参考サイト
- Google OAuth2の認証ガイド的なもの：　https://zenn.dev/daddy_yukio/articles/9d5662d294eb33
- YouTube Data APIのNode.jsクイックガイド：　https://developers.google.com/youtube/v3/quickstart/nodejs