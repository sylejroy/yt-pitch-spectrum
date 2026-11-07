'use strict';

function send(tabId, msg) {
  return browser.tabs.sendMessage(tabId, msg).catch(() => {
    // Not a YouTube tab (or page still loading) – nothing to control.
  });
}

browser.browserAction.onClicked.addListener((tab) => send(tab.id, { type: 'toggle-panel' }));

browser.commands.onCommand.addListener(async (name) => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) send(tab.id, { type: 'command', name });
});
