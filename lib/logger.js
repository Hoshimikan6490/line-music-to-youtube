const fs = require('fs');
const util = require('util');
const { LOG_FILE } = require('./paths');

function setupConsoleTeeLog() {
	if (global.__terminalLogTeeEnabled) {
		return;
	}

	const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
	const originals = Object.fromEntries(
		methods.map((method) => [method, console[method].bind(console)]),
	);

	const appendLog = (level, args) => {
		const timestamp = new Date().toISOString();
		const message = util.formatWithOptions(
			{ depth: null, colors: false },
			...args,
		);

		try {
			fs.appendFileSync(
				LOG_FILE,
				`[${timestamp}] [${level}] ${message}\n`,
				'utf-8',
			);
		} catch (error) {
			process.stderr.write(
				`[console-tee-error] terminal.log への書き込みに失敗: ${String(error)}\n`,
			);
		}
	};

	for (const method of methods) {
		console[method] = (...args) => {
			appendLog(method.toUpperCase(), args);
			originals[method](...args);
		};
	}

	global.__terminalLogTeeEnabled = true;
}

module.exports = {
	setupConsoleTeeLog,
};
