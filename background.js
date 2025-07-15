// Background script for WSU 2FA Auto-Fill extension

chrome.runtime.onInstalled.addListener(() => {
  console.log("WSU 2FA Auto-Fill extension installed");

  // Set default settings
  chrome.storage.sync.get(["autoFillEnabled"], (result) => {
    if (result.autoFillEnabled === undefined) {
      chrome.storage.sync.set({ autoFillEnabled: true });
    }
  });
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // This will open the popup when the extension icon is clicked
  // The popup is automatically handled by manifest.json
});

// Listen for tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes("login.wsu.edu")
  ) {
    console.log("WSU 2FA Auto-Fill: WSU login page detected");
    // Content script should already be injected via manifest
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "log") {
    console.log("WSU 2FA Auto-Fill:", request.message);
  }

  // Keep the message channel open for async responses
  return true;
});
