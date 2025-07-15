document.addEventListener("DOMContentLoaded", async function () {
  const secretKeyInput = document.getElementById("secretKey");
  const saveKeyBtn = document.getElementById("saveKey");
  const currentCodeDiv = document.getElementById("currentCode");
  const copyCodeBtn = document.getElementById("copyCode");
  const fillCodeBtn = document.getElementById("fillCode");
  const toggleAutoBtn = document.getElementById("toggleAuto");
  const codeSection = document.getElementById("codeSection");
  const statusDiv = document.getElementById("status");

  let currentCode = "";
  let updateInterval;

  // Load saved settings
  const result = await chrome.storage.sync.get([
    "totpSecret",
    "autoFillEnabled",
  ]);
  if (result.totpSecret) {
    secretKeyInput.value = result.totpSecret;
    codeSection.style.display = "block";
    startCodeGeneration();
  }

  const autoFillEnabled = result.autoFillEnabled !== false; // Default to true
  updateAutoFillButton(autoFillEnabled);

  function showStatus(message, type = "success") {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    setTimeout(() => {
      statusDiv.textContent = "";
      statusDiv.className = "";
    }, 3000);
  }

  function updateAutoFillButton(enabled) {
    toggleAutoBtn.textContent = `Auto-Fill: ${enabled ? "ON" : "OFF"}`;
    toggleAutoBtn.className = `toggle-auto ${enabled ? "" : "disabled"}`;
  }

  async function generateAndDisplayCode() {
    try {
      const secret = secretKeyInput.value.trim();
      if (!secret) return;

      currentCode = await TOTP.generate(secret);
      currentCodeDiv.textContent = currentCode;

      const timeRemaining = TOTP.getTimeRemaining();
      if (timeRemaining <= 5) {
        currentCodeDiv.style.backgroundColor = "#ffebee";
      } else {
        currentCodeDiv.style.backgroundColor = "#f0f0f0";
      }
    } catch (error) {
      console.error("Error generating TOTP:", error);
      currentCodeDiv.textContent = "Error";
      showStatus("Error generating code", "error");
    }
  }

  function startCodeGeneration() {
    generateAndDisplayCode();
    updateInterval = setInterval(generateAndDisplayCode, 1000);
  }

  function stopCodeGeneration() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  saveKeyBtn.addEventListener("click", async function () {
    const secret = secretKeyInput.value.trim();
    if (!secret) {
      showStatus("Please enter a secret key", "error");
      return;
    }

    try {
      await chrome.storage.sync.set({ totpSecret: secret });
      showStatus("Secret key saved!");
      codeSection.style.display = "block";
      startCodeGeneration();
    } catch (error) {
      showStatus("Error saving secret key", "error");
    }
  });

  copyCodeBtn.addEventListener("click", function () {
    if (currentCode) {
      navigator.clipboard
        .writeText(currentCode)
        .then(() => {
          showStatus("Code copied to clipboard!");
        })
        .catch(() => {
          showStatus("Failed to copy code", "error");
        });
    }
  });

  fillCodeBtn.addEventListener("click", async function () {
    if (!currentCode) {
      showStatus("No code available", "error");
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab.url.includes("login.wsu.edu")) {
        showStatus("This only works on login.wsu.edu", "warning");
        return;
      }

      await chrome.tabs.sendMessage(tab.id, {
        action: "fillCode",
        code: currentCode,
      });
      showStatus("Code filled on page!");
    } catch (error) {
      showStatus("Error filling code", "error");
    }
  });

  toggleAutoBtn.addEventListener("click", async function () {
    const result = await chrome.storage.sync.get(["autoFillEnabled"]);
    const newValue = !(result.autoFillEnabled !== false);

    await chrome.storage.sync.set({ autoFillEnabled: newValue });
    updateAutoFillButton(newValue);
    showStatus(`Auto-fill ${newValue ? "enabled" : "disabled"}!`);
  });

  // Clean up on popup close
  window.addEventListener("beforeunload", stopCodeGeneration);
});
