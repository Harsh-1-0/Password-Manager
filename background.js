// background.js — handles messages from content to persist credentials

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (!msg || typeof msg !== 'object') return;

	if (msg.type === 'PASSBUDDY_SAVE' && msg.payload) {
		const newCred = msg.payload;
		chrome.storage.local.get(['credentials'], (res) => {
			const list = Array.isArray(res.credentials) ? res.credentials : [];
			list.push(newCred);
			chrome.storage.local.set({ credentials: list }, () => {
				sendResponse({ ok: true });
			});
		});
		// Keep the message channel open for async sendResponse
		return true;
	}
});

