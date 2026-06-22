const DEFAULT_SETTINGS = {
  autoNavigation: true,
  quietMode: true
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["travelAgent.settings"], (result) => {
    if (!result["travelAgent.settings"]) {
      chrome.storage.local.set({ "travelAgent.settings": DEFAULT_SETTINGS });
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "TRAVEL_AGENT_DEFAULT_SETTINGS") {
    sendResponse(DEFAULT_SETTINGS);
    return true;
  }

  return false;
});
