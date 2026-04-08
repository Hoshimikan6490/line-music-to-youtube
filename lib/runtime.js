const { setupConsoleTeeLog } = require('./logger');

function initRuntime() {
	require('dotenv').config({ quiet: true });
	setupConsoleTeeLog();
}

module.exports = {
	initRuntime,
};
