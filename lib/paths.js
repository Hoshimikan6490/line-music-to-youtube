const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const TRACKS_DIR = path.join(ROOT_DIR, 'tracks');

module.exports = {
	ROOT_DIR,
	TRACKS_DIR,
	SOURCE_FILE: path.join(TRACKS_DIR, 'sourceData.json'),
	SEARCH_RESULT_FILE: path.join(TRACKS_DIR, 'searchResult.json'),
	QUEUE_FILE: path.join(TRACKS_DIR, 'playlistAddQueue.json'),
	FAILED_FILE: path.join(TRACKS_DIR, 'playlistAddFailed.json'),
	LOG_FILE: path.join(ROOT_DIR, 'terminal.log'),
	CREDENTIALS_FILE: path.join(ROOT_DIR, 'credentials.json'),
	TOKEN_DIR: path.join(ROOT_DIR, '.credentials'),
	TOKEN_PATH: path.join(ROOT_DIR, '.credentials', 'youtube-playlist-token.json'),
};
