document.addEventListener("DOMContentLoaded", async function () {
  const secretKeyInput = document.getElementById("secretKey");
  const saveKeyBtn = document.getElementById("saveKey");
  const currentCodeDiv = document.getElementById("currentCode");
  const codeText = document.getElementById("codeText");
  const copyCodeBtn = document.getElementById("copyCode");
  const fillCodeBtn = document.getElementById("fillCode");
  const toggleAutoBtn = document.getElementById("toggleAuto");
  const clearKeyBtn = document.getElementById("clearKey");
  const codeSection = document.getElementById("codeSection");
  const keyInputSection = document.getElementById("keyInputSection");
  const statusDiv = document.getElementById("status");
  const confirmDialog = document.getElementById("confirmDialog");
  const confirmYesBtn = document.getElementById("confirmYes");
  const confirmNoBtn = document.getElementById("confirmNo");

  let currentCode = "";
  let updateInterval;
  let decryptedSecret = "";

  // Simple encryption/decryption functions
  async function encryptSecret(secret) {
    const encoder = new TextEncoder();
    const data = encoder.encode(secret);
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );

    const keyData = await crypto.subtle.exportKey("raw", key);
    return {
      key: Array.from(new Uint8Array(keyData)),
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted)),
    };
  }

  async function decryptSecret(encryptedData) {
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(encryptedData.key),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(encryptedData.iv) },
      key,
      new Uint8Array(encryptedData.data),
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  // Validate TOTP secret key format
  async function validateSecretKey(secret) {
    // Remove spaces and convert to uppercase
    const cleanSecret = secret.replace(/\s/g, '').toUpperCase();
    
    // Check if it's valid base32 (A-Z, 2-7)
    const base32Regex = /^[A-Z2-7]+=*$/;
    if (!base32Regex.test(cleanSecret)) {
      return { valid: false, error: "Invalid format. Key must be base32 (A-Z, 2-7)" };
    }
    
    // Check minimum length (usually 16+ characters for security)
    if (cleanSecret.length < 16) {
      return { valid: false, error: "Key too short. Must be at least 16 characters" };
    }
    
    // Test if we can generate a TOTP code with this key
    try {
      // This will throw if the key is invalid
      const testCode = await TOTP.generate(cleanSecret);
      return { valid: true, cleanSecret };
    } catch (error) {
      return { valid: false, error: "Invalid secret key format" };
    }
  }

  // Load saved settings
  const result = await chrome.storage.sync.get([
    "totpSecretEncrypted",
    "autoFillEnabled",
  ]);
  if (result.totpSecretEncrypted) {
    try {
      decryptedSecret = await decryptSecret(result.totpSecretEncrypted);
      keyInputSection.style.display = "none";
      codeSection.style.display = "block";
      startCodeGeneration();
    } catch (error) {
      console.error("Error decrypting secret:", error);
      showStatus("Error loading saved key", "error");
    }
  }

  const autoFillEnabled = result.autoFillEnabled !== false; // Default to true
  updateAutoFillButton(autoFillEnabled);

  function showStatus(message, type = "success") {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type} show`;
    setTimeout(() => {
      statusDiv.className = `status ${type}`;
      setTimeout(() => {
        statusDiv.textContent = "";
        statusDiv.className = "status";
      }, 300);
    }, 3000);
  }

  function showConfirmDialog() {
    confirmDialog.style.display = "flex";
  }

  function hideConfirmDialog() {
    confirmDialog.style.display = "none";
  }

  function updateAutoFillButton(enabled) {
    toggleAutoBtn.textContent = `Auto-Fill: ${enabled ? "ON" : "OFF"}`;
    toggleAutoBtn.className = `toggle-auto ${enabled ? "" : "disabled"}`;
  }

  async function generateAndDisplayCode() {
    try {
      const secret = decryptedSecret || secretKeyInput.value.trim();
      if (!secret) return;

      currentCode = await TOTP.generate(secret);
      codeText.textContent = currentCode;

      const timeRemaining = TOTP.getTimeRemaining();
      if (timeRemaining <= 5) {
        currentCodeDiv.style.backgroundColor = "#ffebee";
      } else {
        currentCodeDiv.style.backgroundColor = "#f0f0f0";
      }
    } catch (error) {
      console.error("Error generating TOTP:", error);
      codeText.textContent = "Error";
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

    // Validate the secret key
    const validation = await validateSecretKey(secret);
    if (!validation.valid) {
      showStatus(validation.error, "error");
      return;
    }

    try {
      const encryptedSecret = await encryptSecret(validation.cleanSecret);
      await chrome.storage.sync.set({ totpSecretEncrypted: encryptedSecret });
      decryptedSecret = validation.cleanSecret;
      secretKeyInput.value = "";
      keyInputSection.style.display = "none";
      showStatus("Secret key saved securely!");
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
    
    // If enabling autofill and we have a secret, start monitoring current tab
    if (newValue && decryptedSecret) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.url.includes("login.wsu.edu")) {
          await chrome.tabs.sendMessage(tab.id, {
            action: "startMonitoring",
            secret: decryptedSecret
          });
          console.log("Started monitoring current WSU tab");
        }
      } catch (error) {
        console.log("Could not start monitoring current tab:", error);
      }
    }
  });

  // Clear key functionality
  clearKeyBtn.addEventListener("click", function () {
    showConfirmDialog();
  });

  confirmYesBtn.addEventListener("click", async function () {
    hideConfirmDialog();
    try {
      await chrome.storage.sync.remove(["totpSecretEncrypted"]);
      decryptedSecret = "";
      stopCodeGeneration();
      codeSection.style.display = "none";
      keyInputSection.style.display = "block";
      secretKeyInput.value = "";
      secretKeyInput.focus();
      showStatus("Secret key cleared", "warning");
    } catch (error) {
      showStatus("Error clearing secret key", "error");
    }
  });

  confirmNoBtn.addEventListener("click", function () {
    hideConfirmDialog();
  });

  // Close dialog when clicking outside
  confirmDialog.addEventListener("click", function (e) {
    if (e.target === confirmDialog) {
      hideConfirmDialog();
    }
  });

  // Make code clickable to copy
  currentCodeDiv.addEventListener("click", function () {
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

  // Clean up on popup close
  window.addEventListener("beforeunload", stopCodeGeneration);
});
