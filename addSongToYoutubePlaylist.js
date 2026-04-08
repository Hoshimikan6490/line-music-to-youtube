const fs = require('fs/promises');
const path = require('path');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
require('dotenv').config({ quiet: true });
const { google } = require('googleapis');
const express = require('express');

const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
const TOKEN_DIR = path.join(__dirname, '.credentials');
const TOKEN_PATH = path.join(TOKEN_DIR, 'youtube-playlist-token.json');
const QUEUE_FILE = path.join(__dirname, 'tracks', 'playlistAddQueue.json');
const FAILED_FILE = path.join(__dirname, 'tracks', 'playlistAddFailed.json');

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';
const DEFAULT_INSERT_DELAY_MS = 120;
const LARGE_PLAYLIST_INSERT_DELAY_MS = 1000;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
	const reasons =
		error?.response?.data?.error?.errors
			?.map((item) => String(item?.reason || '').toLowerCase())
			.filter(Boolean) || [];
	const message = String(error?.message || '').toLowerCase();
	const status = error?.response?.status;

	return (
		status === 429 ||
		(status === 403 &&
			reasons.some((reason) =>
				[
					'ratelimitexceeded',
					'quotaexceeded',
					'dailylimitexceeded',
					'userratelimitexceeded',
				].includes(reason),
			)) ||
		/ratelimit|quota/.test(message)
	);
}

function isAuthGrantError(error) {
	const message = String(error?.message || '').toLowerCase();
	const errorCode = String(error?.response?.data?.error || '').toLowerCase();

	return errorCode === 'invalid_grant' || message.includes('invalid_grant');
}

function is409ConflictError(error) {
	const status = error?.status || error?.code;
	const reasons =
		error?.response?.data?.error?.errors
			?.map((item) => String(item?.reason || '').toLowerCase())
			.filter(Boolean) || [];

	return (
		status === 409 ||
		reasons.some(
			(reason) =>
				reason === 'videoalreadyinplaylist' || reason === 'videounavailable',
		)
	);
}

async function removeStoredToken() {
	try {
		await fs.unlink(TOKEN_PATH);
		console.warn(`失効したトークンを削除しました: ${TOKEN_PATH}`);
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			throw error;
		}
	}
}

async function saveQueueFile(queueItems) {
	if (queueItems.length === 0) {
		try {
			await fs.unlink(QUEUE_FILE);
			console.warn(`待機中の曲情報を削除しました: ${QUEUE_FILE}`);
		} catch (error) {
			if (error?.code !== 'ENOENT') {
				throw error;
			}
		}

		return;
	}

	await fs.writeFile(
		QUEUE_FILE,
		JSON.stringify(queueItems, null, '\t'),
		'utf-8',
	);
	console.warn(`待機中の曲情報を ${QUEUE_FILE} に保存しました。`);
}

async function saveFailedFile(failedItems) {
	if (failedItems.length === 0) {
		try {
			await fs.unlink(FAILED_FILE);
			console.warn(`失敗したアイテムのファイルを削除しました: ${FAILED_FILE}`);
		} catch (error) {
			if (error?.code !== 'ENOENT') {
				throw error;
			}
		}

		return;
	}

	await fs.writeFile(
		FAILED_FILE,
		JSON.stringify(failedItems, null, '\t'),
		'utf-8',
	);
	console.warn(`失敗したアイテムを ${FAILED_FILE} に保存しました。`);
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
		const storedTokens = JSON.parse(tokenRaw);

		// refresh_token が無いトークンは失効時に更新できないため再認証する
		if (storedTokens?.refresh_token) {
			oauth2Client.setCredentials(storedTokens);
			return oauth2Client;
		}

		console.warn(
			'保存済みトークンに refresh_token が無いため、再認証を実行します。',
		);
	} catch {
		// トークン未作成時は下の再認証フローへ
	}

	const authUrl = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		prompt: 'consent',
		scope: [YOUTUBE_SCOPE],
	});
	console.log('Authorize this app by visiting this url:');
	console.log(authUrl);

	const code = (
		await rl.question('Enter the code from that page here: ')
	).trim();
	const tokenResponse = await oauth2Client.getToken(code);
	const tokens = tokenResponse.tokens;

	if (!tokens?.refresh_token) {
		throw new Error(
			'refresh_token を取得できませんでした。Googleアカウントの許可を解除後に再実行してください。',
		);
	}

	oauth2Client.setCredentials(tokens);
	await fs.mkdir(TOKEN_DIR, { recursive: true });
	await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens), 'utf-8');
	console.log(`Token stored to ${TOKEN_PATH}`);

	return oauth2Client;
}

async function loadQueueFile() {
	try {
		const raw = await fs.readFile(QUEUE_FILE, 'utf-8');
		return JSON.parse(raw);
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error(`待機キューが見つかりません: ${QUEUE_FILE}`);
		}
		throw error;
	}
}

async function addVideosToPlaylist(
	authClient,
	playlistId,
	queueItems,
	failedItems,
) {
	const youtube = google.youtube({ version: 'v3', auth: authClient });
	const insertDelayMs =
		queueItems.length > 100
			? LARGE_PLAYLIST_INSERT_DELAY_MS
			: DEFAULT_INSERT_DELAY_MS;

	if (queueItems.length > 100) {
		console.log(
			`登録件数が ${queueItems.length} 件あるため、各曲の登録後に ${insertDelayMs}ms 待機します。`,
		);
	}

	let processedCount = 0;
	while (queueItems.length > 0) {
		const queueItem = queueItems[0];
		const videoId = new URL(queueItem.url).searchParams.get('v');

		if (!videoId) {
			throw new Error(`動画URLからvideoIdを取得できません: ${queueItem.url}`);
		}

		console.log(
			`[${processedCount + 1}/${processedCount + queueItems.length}] add ${videoId}`,
		);

		try {
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
		} catch (error) {
			if (isAuthGrantError(error)) {
				console.error('OAuthトークンが失効しているため、再認証が必要です。');
				await removeStoredToken();
				const reauthError = new Error('REAUTH_REQUIRED');
				reauthError.code = 'REAUTH_REQUIRED';
				reauthError.nextIndex = processedCount;
				throw reauthError;
			}

			if (isRateLimitError(error)) {
				console.error('レートリミットを検知したため、処理を停止します。');
				await saveQueueFile(queueItems);
				throw error;
			}

			if (is409ConflictError(error)) {
				console.warn(
					`⚠️  ${videoId} は追加できません（既に登録済み、削除済み、または利用不可）。スキップします。`,
				);
				const failedItem = queueItems.shift();
				failedItems.push(failedItem);
				await saveQueueFile(queueItems);
				await saveFailedFile(failedItems);
				processedCount += 1;
				continue;
			}

			throw error;
		}

		queueItems.shift();
		processedCount += 1;
		await saveQueueFile(queueItems);
		await sleep(insertDelayMs);
	}
}

async function main() {
	const rl = readline.createInterface({ input, output });
	try {
		const playlistUrl =
			process.env.YouTubePlaylistURL || process.env.YOUTUBE_PLAYLIST_URL;
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

		const playlistId = parsed.searchParams.get('list');
		if (!playlistId) {
			throw new Error(
				`playlistId(list) がURLに含まれていません: ${playlistUrl}`,
			);
		}

		const queueItems = await loadQueueFile();
		console.log(`待機中の曲数: ${queueItems.length}`);

		const failedItems = [];

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

		let authClient = await authorizeYouTube(rl);
		while (queueItems.length > 0) {
			try {
				await addVideosToPlaylist(
					authClient,
					playlistId,
					queueItems,
					failedItems,
				);
				break;
			} catch (error) {
				if (error?.code === 'REAUTH_REQUIRED') {
					authClient = await authorizeYouTube(rl);
					continue;
				}

				throw error;
			}
		}

		await saveFailedFile(failedItems);
		console.log('完了しました。');
	} finally {
		rl.close();
	}
}

main()
	.then(() => {
		process.exit(0);
	})
	.catch((err) => {
		console.error('Error:');
		console.error(err);
		process.exit(1);
	});
