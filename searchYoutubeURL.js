const fs = require('fs/promises');
const { Innertube } = require('youtubei.js');
const { initRuntime } = require('./lib/runtime');
const { SEARCH_RESULT_FILE, QUEUE_FILE } = require('./lib/paths');

initRuntime();

const CANDIDATE_COUNT = 5;
const SEARCH_DELAY_MS = 250;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function toVideoUrl(videoId) {
	return `https://www.youtube.com/watch?v=${videoId}`;
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
	const raw = await fs.readFile(SEARCH_RESULT_FILE, 'utf-8');
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed)) {
		throw new Error('tracks/searchResult.json must be an array');
	}
	return parsed;
}

async function searchAndAskSelections(yt, tracks) {
	const queueItems = [];

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

		const selectedCandidate = candidates[0];
		console.log(
			`自動選択: 1. ${selectedCandidate.title} - ${selectedCandidate.channel}`,
		);
		console.log(`     ${selectedCandidate.url}`);

		queueItems.push({
			title: track.title,
			url: selectedCandidate.url,
		});
		await sleep(SEARCH_DELAY_MS);
	}

	return queueItems;
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

async function main() {
	try {
		const tracks = await loadTracks();
		const yt = await Innertube.create();

		console.log(`loaded tracks: ${tracks.length}`);
		const queueItems = await searchAndAskSelections(yt, tracks);
		console.log(`\n待機キュー数: ${queueItems.length}`);
		if (queueItems.length === 0) {
			console.log('追加対象がないため終了します。');
			return;
		}

		await saveQueueFile(queueItems);
		console.log('完了しました。');
	} catch (err) {
		console.error('Error:');
		console.error(err);
		process.exit(1);
	}
}

main().then(() => {
	process.exit(0);
});
