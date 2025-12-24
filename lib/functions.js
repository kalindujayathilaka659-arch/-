const axios = require('axios');

/**
 * Download data from a URL and return it as a buffer
 * @param {string} url 
 * @param {object} [options] 
 */
const getBuffer = async (url, options = {}) => {
	try {
		const res = await axios({
			method: 'GET',
			url,
			headers: {
				'DNT': 1,
				'Upgrade-Insecure-Requests': 1
			},
			responseType: 'arraybuffer',
			...options
		});
		return res.data;
	} catch (err) {
		console.error('getBuffer error:', err.message);
		return null;
	}
};

/**
 * Get list of group admin user IDs
 * @param {Array} participants 
 */
const getGroupAdmins = (participants = []) => {
	return participants.filter(p => p.admin !== null).map(p => p.id);
};

/**
 * Generate a random filename with given extension
 * @param {string} ext 
 */
const getRandom = (ext = '') => {
	return `${Math.floor(Math.random() * 10000)}${ext}`;
};

/**
 * Convert large number to human readable format (e.g., 1.2K, 4M)
 * @param {number} num 
 */
const h2k = (num) => {
	const units = ['', 'K', 'M', 'B', 'T', 'P', 'E'];
	const tier = Math.log10(Math.abs(num)) / 3 | 0;
	if (tier === 0) return num.toString();

	const unit = units[tier];
	const scale = Math.pow(10, tier * 3);
	let scaled = num / scale;
	let formatted = scaled.toFixed(1);
	if (/\.0$/.test(formatted)) formatted = formatted.slice(0, -2);
	return formatted + unit;
};

/**
 * Check if string is a valid URL
 * @param {string} url 
 */
const isUrl = (url) => {
	return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url);
};

/**
 * Pretty-print a JS object or array as formatted JSON
 * @param {any} data 
 */
const Json = (data) => {
	return JSON.stringify(data, null, 2);
};

/**
 * Convert seconds into human-readable uptime string
 * @param {number} seconds 
 */
const runtime = (seconds) => {
	const d = Math.floor(seconds / (3600 * 24));
	const h = Math.floor((seconds % (3600 * 24)) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	const dDisplay = d > 0 ? `${d} day${d === 1 ? '' : 's'}, ` : '';
	const hDisplay = h > 0 ? `${h} hour${h === 1 ? '' : 's'}, ` : '';
	const mDisplay = m > 0 ? `${m} minute${m === 1 ? '' : 's'}, ` : '';
	const sDisplay = s > 0 ? `${s} second${s === 1 ? '' : 's'}` : '';

	return (dDisplay + hDisplay + mDisplay + sDisplay).replace(/,\s*$/, '');
};

/**
 * Delay execution for specified milliseconds
 * @param {number} ms 
 */
const sleep = async (ms) => {
	return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Fetch and return JSON from a URL
 * @param {string} url 
 * @param {object} [options] 
 */
const fetchJson = async (url, options = {}) => {
	try {
		const res = await axios({
			method: 'GET',
			url,
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
			},
			...options
		});
		return res.data;
	} catch (err) {
		console.error('fetchJson error:', err.message);
		return null;
	}
};

module.exports = {
	getBuffer,
	getGroupAdmins,
	getRandom,
	h2k,
	isUrl,
	Json,
	runtime,
	sleep,
	fetchJson
};
