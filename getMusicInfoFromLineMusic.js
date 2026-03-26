const axios = require('axios');
const fs = require('fs');
require('dotenv').config({ quiet: true });
const LineMusicPlaylistURL = process.env.LineMusicPlaylistURL;
const LineMuiscPlayListID = new URL(LineMusicPlaylistURL).pathname.split(
	'/webapp/playlist/',
)[1];
const requestURL = `https://music.line.me/api2/playlist/${LineMuiscPlayListID}.v2`;

// 外部APIにリクエストを飛ばす
async function main() {
	try {
		const response = await axios.get(requestURL);

		// レスポンス内容で分岐
		if (!response.data?.response?.result?.playlist)
			return console.error(
				'Line MusicのAPIからプレイリスト情報が取得できませんでした。Line MusicのプレイリストURLが正しいか、公開設定が「公開」になっているかを確認してください。',
			);

		const tracks = response.data.response.result.playlist.tracks;
		// トラックデータをJSONファイルに保存
		await fs.writeFileSync('tracks/sourceData.json', JSON.stringify(tracks));

		const tracedData = [];
		// トラックデータから必要な情報を抽出して新しい配列に格納
		tracks.forEach((track) => {
			const tracedTrack = {
				title: track.trackTitle,
				artist: track.artists.map((artist) => artist.artistName).join(', '),
				album: {
					title: track.album.albumTitle,
					artist: track.album.artists
						.map((artist) => artist.artistName)
						.join(', '),
				},
			};
			tracedData.push(tracedTrack);
		});
		await fs.writeFileSync(
			'tracks/tracedData.json',
			JSON.stringify(tracedData),
		);

		console.log('done!');
	} catch (err) {
		console.log(`An Error occurred:`);
		console.error(err);
	}
}

main();
