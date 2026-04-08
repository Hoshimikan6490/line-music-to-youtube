# LINE MUSIC to YouTube Playlist

LINE MUSICのプレイリストURLから曲情報を取得し、候補動画の先頭を自動選択してYouTubeプレイリストに追加するCLIツールです。

## できること

- LINE MUSICプレイリストの曲情報を取得
- 曲名とアーティスト名でYouTube動画候補を検索し、先頭の動画URLを待機キューに追加
- 待機キューを先頭から消しながらYouTubeプレイリストへ追加

## ファイル構成

```
getMusicInfoFromLineMusic.js  // LINE MUSIC曲情報取得
searchYoutubeURL.js           // YouTubei検索処理
addSongToYoutubePlaylist.js   // プレイリスト操作処理
```

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
- `tracks/searchResult.json`: タイトル・アーティストを抽出したデータ

### 2. YouTube候補をキュー化してプレイリストへ追加

```bash
npm run create-playlist
```

実行フロー:

- 各曲について候補動画を検索し、先頭の1件を `tracks/playlistAddQueue.json` に追加
- キューを先頭から消しながらYouTubeプレイリストへ追加
- 追加対象が100曲を超える場合は、各曲の登録後に待機を入れてYouTube APIへの負荷を下げる
- 追加に失敗した曲（既登録、削除済み、利用不可など）は `tracks/playlistAddFailed.json` に記録
- レートリミットを検知した場合は、その時点で処理を停止し、未処理のキューを `tracks/playlistAddQueue.json` に残す
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
  - `invalid_grant` が出た場合は保存済みトークンが失効しているので、再実行時に再認証フローが走る

## ファイル一覧

処理中に生成される主要ファイル：

- `tracks/searchResult.json`: YouTube検索済みのトラック情報（タイトル、アーティスト、URL候補）
- `tracks/playlistAddQueue.json`: YouTubeプレイリスト追加待機中のアイテム（曲名とURL）
- `tracks/playlistAddFailed.json`: 追加に失敗したアイテム（既登録、削除済み、利用不可など）
- `terminal.log`: 実行ログが時間とログレベルとともに記録

- プレイリストIDエラー
  - `.env` の `YouTubePlaylistURL` に `?list=...` が含まれているか確認

- レートリミットで止まった
  - プロジェクトルートの `playlistCreationQueue.json` に未処理のキューが残るので、内容を確認して再実行する

## 補足

- このツールは自動選択前提のため、同一曲でも別バージョンが候補に出ることがあります。

## 参考サイト
- Google OAuth2の認証ガイド的なもの：　https://zenn.dev/daddy_yukio/articles/9d5662d294eb33
- YouTube Data APIのNode.jsクイックガイド：　https://developers.google.com/youtube/v3/quickstart/nodejs