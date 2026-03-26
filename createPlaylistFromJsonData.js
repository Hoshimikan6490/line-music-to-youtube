const fs = require('fs/promises');
const path = require('path');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
require('dotenv').config({ quiet: true });
const { Innertube } = require('youtubei.js');
const { google } = require('googleapis');
const express = require('express');

const TRACE_FILE = path.join(__dirname, 'tracks', 'tracedData.json');
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
const TOKEN_DIR = path.join(__dirname, '.credentials');
const TOKEN_PATH = path.join(TOKEN_DIR, 'youtube-playlist-token.json');

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

const CANDIDATE_COUNT = 5;
const SEARCH_DELAY_MS = 250;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// 認証コードを分かりやすく表示する
const app = express();
app.get('/', (req, res) => {
	const code = req.query.code;
	if (code) {
		res.send(
			`<h1>Authentication successful</h1><p>You can close this window now.</p><pre>${code}</pre>`,
		);
	} else {
		res.send(
			'<h1>Authentication failed</h1><p>No code found in the query parameters.</p>',
		);
	}
});
app.listen(3000, () => {});

function toVideoUrl(videoId) {
	return `https://www.youtube.com/watch?v=${videoId}`;
}

function getPlaylistIdFromUrl(playlistUrl) {
	if (!playlistUrl) {
		throw new Error(
			'YouTubePlaylistURL または YOUTUBE_PLAYLIST_URL を .env に設定してください。',
		);
	}

	let parsed;
	try {
		parsed = new URL(playlistUrl);
	} catch {
		throw new Error(`無効なYouTubeプレイリストURLです: ${playlistUrl}`);
	}

	const list = parsed.searchParams.get('list');
	if (!list) {
		throw new Error(`playlistId(list) がURLに含まれていません: ${playlistUrl}`);
	}

	return list.trim();
}

function normalizeSearchResults(searchResult) {
	const source = Array.isArray(searchResult?.results)
		? searchResult.results
		: Array.isArray(searchResult?.items)
			? searchResult.items
			: [];

	const toText = (value, fallback) => {
		if (typeof value === 'string') {
			return value;
		}
		if (value?.text && typeof value.text === 'string') {
			return value.text;
		}
		if (typeof value?.toString === 'function') {
			const converted = value.toString();
			if (typeof converted === 'string' && converted !== '[object Object]') {
				return converted;
			}
		}
		return fallback;
	};

	return source
		.map((item) => {
			const type = String(item?.type || '').toLowerCase();
			const id = item?.id || item?.video_id;
			return { item, type, id };
		})
		.filter(({ item, type, id }) => {
			if (!id) {
				return false;
			}
			if (type === 'video') {
				return true;
			}
			return item?.url?.includes('watch?v=');
		})
		.map(({ item, id }) => {
			const title = toText(item?.title, 'Unknown title');
			const channel =
				typeof item?.author?.name === 'string'
					? item.author.name
					: typeof item?.author === 'string'
						? item.author
						: toText(item?.author?.title, 'Unknown channel');

			return {
				id,
				title,
				channel,
				url: toVideoUrl(id),
			};
		});
}

async function loadTracks() {
	const raw = await fs.readFile(TRACE_FILE, 'utf-8');
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed)) {
		throw new Error('tracks/tracedData.json must be an array');
	}
	return parsed;
}

async function searchAndAskSelections(yt, rl, tracks) {
	const selectedVideoIds = [];

	for (let i = 0; i < tracks.length; i += 1) {
		const track = tracks[i];
		const query = `${track.title} ${track.artist}`;

		console.log(`\n[${i + 1}/${tracks.length}] searching: ${query}`);
		const response = await yt.search(query, { type: 'video' });
		const candidates = normalizeSearchResults(response).slice(
			0,
			CANDIDATE_COUNT,
		);

		console.log('\n--------------------------------------------------');
		console.log(`[${i + 1}/${tracks.length}] ${track.title} / ${track.artist}`);
		console.log(`query: ${query}`);

		if (candidates.length === 0) {
			console.log('候補なし。スキップします。');
			await sleep(SEARCH_DELAY_MS);
			continue;
		}

		candidates.forEach((candidate, idx) => {
			console.log(`  ${idx + 1}. ${candidate.title} - ${candidate.channel}`);
			console.log(`     ${candidate.url}`);
		});

		const answer = await rl.question(
			'追加する番号を入力 (1-5) / s=skip / q=quit: ',
		);
		const normalized = answer.trim().toLowerCase();

		if (normalized === 'q') {
			throw new Error('ユーザーが中断しました。');
		}

		if (normalized === 's' || normalized === '') {
			await sleep(SEARCH_DELAY_MS);
			continue;
		}

		const selectedIndex = Number.parseInt(normalized, 10) - 1;
		if (Number.isNaN(selectedIndex) || !candidates[selectedIndex]) {
			console.log('無効な入力なのでスキップします。');
			await sleep(SEARCH_DELAY_MS);
			continue;
		}

		selectedVideoIds.push(candidates[selectedIndex].id);
		await sleep(SEARCH_DELAY_MS);
	}

	return selectedVideoIds;
}

async function authorizeYouTube(rl) {
	const raw = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
	const credentials = JSON.parse(raw);
	const clientConfig = credentials.web || credentials.installed;

	if (!clientConfig) {
		throw new Error(
			'credentials.json に web または installed クライアント設定が見つかりません。',
		);
	}

	const clientId = clientConfig.client_id;
	const clientSecret = clientConfig.client_secret;
	const redirectUris = Array.isArray(clientConfig.redirect_uris)
		? clientConfig.redirect_uris.filter((uri) => typeof uri === 'string' && uri)
		: [];

	const configuredRedirect = process.env.YOUTUBE_REDIRECT_URI;
	let redirectUrl = redirectUris[0];

	if (configuredRedirect) {
		if (redirectUris.includes(configuredRedirect)) {
			redirectUrl = configuredRedirect;
		} else {
			console.warn(
				`YOUTUBE_REDIRECT_URI(${configuredRedirect}) は credentials.json の redirect_uris に存在しないため無視します。`,
			);
		}
	}

	if (!redirectUrl) {
		throw new Error(
			'redirect URI が設定されていません。credentials.json の redirect_uris を確認してください。',
		);
	}

	console.log(`OAuth redirect URI: ${redirectUrl}`);

	const oauth2Client = new google.auth.OAuth2(
		clientId,
		clientSecret,
		redirectUrl,
	);

	try {
		const tokenRaw = await fs.readFile(TOKEN_PATH, 'utf-8');
		oauth2Client.setCredentials(JSON.parse(tokenRaw));
		return oauth2Client;
	} catch {
		const authUrl = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			scope: [YOUTUBE_SCOPE],
		});
		console.log('Authorize this app by visiting this url:');
		console.log(authUrl);

		const code = (
			await rl.question('Enter the code from that page here: ')
		).trim();
		const tokenResponse = await oauth2Client.getToken(code);
		const tokens = tokenResponse.tokens;

		oauth2Client.setCredentials(tokens);
		await fs.mkdir(TOKEN_DIR, { recursive: true });
		await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens), 'utf-8');
		console.log(`Token stored to ${TOKEN_PATH}`);

		return oauth2Client;
	}
}

async function addVideosToPlaylist(authClient, playlistId, videoIds) {
	const youtube = google.youtube({ version: 'v3', auth: authClient });

	for (let i = 0; i < videoIds.length; i += 1) {
		const videoId = videoIds[i];
		console.log(`[${i + 1}/${videoIds.length}] add ${videoId}`);
		await youtube.playlistItems.insert({
			part: ['snippet'],
			requestBody: {
				snippet: {
					playlistId,
					resourceId: {
						kind: 'youtube#video',
						videoId,
					},
				},
			},
		});
		await sleep(120);
	}
}

async function main() {
	const rl = readline.createInterface({ input, output });

	try {
		const tracks = await loadTracks();
		const yt = await Innertube.create();

		console.log(`loaded tracks: ${tracks.length}`);
		const selectedVideoIds = await searchAndAskSelections(yt, rl, tracks);
		console.log(`\n選択された動画数: ${selectedVideoIds.length}`);
		if (selectedVideoIds.length === 0) {
			console.log('追加対象がないため終了します。');
			return;
		}

		const playlistUrl =
			process.env.YouTubePlaylistURL || process.env.YOUTUBE_PLAYLIST_URL;
		const playlistId = getPlaylistIdFromUrl(playlistUrl);

		let confirm;
		while (true) {
			confirm = (
				await rl.question(
					`プレイリスト(${playlistId})へ ${selectedVideoIds.length} 件追加します。実行しますか？ (y/N): `,
				)
			)
				.trim()
				.toLowerCase();

			if (confirm === 'y' || confirm === 'n' || confirm === '') {
				break;
			}

			console.log('y か n を入力してください。');
		}

		if (confirm !== 'y') {
			console.log('キャンセルしました。');
			return;
		}

		const authClient = await authorizeYouTube(rl);
		await addVideosToPlaylist(authClient, playlistId, selectedVideoIds);

		console.log('完了しました。');
	} finally {
		rl.close();
	}
}

main().catch((err) => {
	console.error(`Error: ${err.message}`);
	process.exit(1);
});
