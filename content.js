// TOTP implementation for content script
class TOTP {
  static base32Decode(base32) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const cleanInput = base32.replace(/[^A-Z2-7]/g, "");

    let bits = 0;
    let value = 0;
    let output = [];

    for (let i = 0; i < cleanInput.length; i++) {
      value = (value << 5) | alphabet.indexOf(cleanInput[i]);
      bits += 5;

      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }

    return new Uint8Array(output);
  }

  static async hmacSha1(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, message);
    return new Uint8Array(signature);
  }

  static dynamicTruncate(hash) {
    const offset = hash[hash.length - 1] & 0xf;
    const code =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);
    return code % 1000000;
  }

  static async generate(secret, timeStep = 30) {
    const key = this.base32Decode(secret);
    const epoch = Math.floor(Date.now() / 1000);
    const time = Math.floor(epoch / timeStep);

    const timeBuffer = new ArrayBuffer(8);
    const timeView = new DataView(timeBuffer);
    timeView.setUint32(4, time, false); // Big-endian

    const hash = await this.hmacSha1(key, new Uint8Array(timeBuffer));
    const code = this.dynamicTruncate(hash);

    return code.toString().padStart(6, "0");
  }
}

// Decryption function for content script
async function decryptSecret(encryptedData) {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(encryptedData.key),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(encryptedData.iv) },
    key,
    new Uint8Array(encryptedData.data)
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

class WSU2FAAutoFill {
  constructor() {
    this.retryTimeout = null;
    this.hasAttempted = false;
    this.observer = null;
    this.decryptedSecret = null;
    this.init();
  }

  async init() {
    console.log("WSU 2FA Auto-Fill: Content script loaded");

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "fillCode") {
        const success = this.fillAndSubmitCode(request.code, true); // Auto-submit from manual trigger
        sendResponse({ success });
      } else if (request.action === "startMonitoring") {
        // Start monitoring when autofill is enabled
        console.log("WSU 2FA Auto-Fill: Starting monitoring from popup request");
        this.decryptedSecret = request.secret;
        this.hasAttempted = false;
        
        // Try to find the 2FA field immediately, then start watching
        const input = this.findPasscodeInput();
        if (input) {
          console.log("WSU 2FA Auto-Fill: 2FA field found, starting immediate attempt");
          setTimeout(() => this.attemptAutoFill(), 250);
        } else {
          console.log("WSU 2FA Auto-Fill: 2FA field not found, starting to watch for it");
          this.startWatching();
        }
        sendResponse({ success: true });
      }
    });

    // Check if auto-fill is enabled and load encrypted secret
    const result = await chrome.storage.sync.get([
      "autoFillEnabled",
      "totpSecretEncrypted",
    ]);
    if (result.autoFillEnabled !== false && result.totpSecretEncrypted) {
      try {
        this.decryptedSecret = await this.decryptSecret(result.totpSecretEncrypted);
        this.startWatching();
      } catch (error) {
        console.error("WSU 2FA Auto-Fill: Error decrypting secret:", error);
      }
    }
  }

  async decryptSecret(encryptedData) {
    return await decryptSecret(encryptedData);
  }

  startWatching() {
    console.log("WSU 2FA Auto-Fill: Starting to watch for 2FA field");
    
    // Try immediate fill in case 2FA field is already present
    setTimeout(() => this.attemptAutoFill(), 250); // 0.25 second delay for immediate check
    
    // Set up mutation observer to watch for 2FA field appearing
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0 && !this.hasAttempted) {
          console.log("WSU 2FA Auto-Fill: DOM mutation detected", mutation.addedNodes.length, "nodes added");
          
          // Check if the 2FA input field is now available
          const input = this.findPasscodeInput();
          if (input) {
            console.log("WSU 2FA Auto-Fill: Detected 2FA field, waiting before attempting fill");
            setTimeout(() => this.attemptAutoFill(), 250); // 0.25 second delay after finding field
          }
        }
      });
    });
    
    // Start observing with more comprehensive options
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'] // Watch for visibility changes
    });
    
    // Also set up a periodic check as backup
    this.periodicCheck = setInterval(() => {
      if (!this.hasAttempted) {
        const input = this.findPasscodeInput();
        if (input) {
          console.log("WSU 2FA Auto-Fill: Periodic check found 2FA field");
          this.attemptAutoFill();
        }
      } else {
        clearInterval(this.periodicCheck);
      }
    }, 250);
    
    console.log("WSU 2FA Auto-Fill: Started watching for 2FA field with enhanced detection");
  }

  async attemptAutoFill() {
    if (this.hasAttempted || !this.decryptedSecret) {
      console.log("WSU 2FA Auto-Fill: Skipping auto-fill attempt", {
        hasAttempted: this.hasAttempted,
        hasSecret: !!this.decryptedSecret
      });
      return;
    }

    console.log("WSU 2FA Auto-Fill: Attempting auto-fill");
    
    // First check if the field is available
    const input = this.findPasscodeInput();
    if (!input) {
      console.log("WSU 2FA Auto-Fill: No input field found, will retry");
      this.scheduleRetry();
      return;
    }

    console.log("WSU 2FA Auto-Fill: Found input field, waiting before filling");
    
    // Wait 0.25 seconds after finding the box before entering the code
    setTimeout(async () => {
      try {
        const code = await TOTP.generate(this.decryptedSecret);
        console.log("WSU 2FA Auto-Fill: Generated TOTP code:", code);
        
        const success = this.fillAndSubmitCode(code);

        if (success) {
          console.log("WSU 2FA Auto-Fill: Auto-fill successful!");
          this.hasAttempted = true;
          
          // Stop observing once we successfully fill
          if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
          }
          if (this.periodicCheck) {
            clearInterval(this.periodicCheck);
          }
        } else {
          console.log("WSU 2FA Auto-Fill: Auto-fill failed, will retry");
          // Reset hasAttempted so it can try again
          this.hasAttempted = false;
          this.scheduleRetry();
        }
      } catch (error) {
        console.error("WSU 2FA Auto-Fill: Error generating code:", error);
        this.scheduleRetry();
      }
    }, 250);
  }

  scheduleRetry() {
    if (this.retryTimeout) return; // Already scheduled

    this.retryTimeout = setTimeout(async () => {
      console.log("WSU 2FA Auto-Fill: Retrying auto-fill");
      try {
        const code = await TOTP.generate(this.decryptedSecret);
        this.fillAndSubmitCode(code, true); // Auto-submit on retry
      } catch (error) {
        console.error("WSU 2FA Auto-Fill: Error on retry:", error);
      }
      this.retryTimeout = null;
    }, 250); // 0.25 second retry delay
  }

  findPasscodeInput() {
    console.log("WSU 2FA Auto-Fill: Searching for passcode input field");
    
    // Find the "Enter code" label and get its associated input
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.textContent.toLowerCase().includes('enter code')) {
        // Found the "Enter code" label, now find its input
        const forAttribute = label.getAttribute('for');
        if (forAttribute) {
          const input = document.getElementById(forAttribute);
          if (input && input.offsetParent !== null) {
            console.log("WSU 2FA Auto-Fill: Found 2FA input via Enter code label", input);
            return input;
          }
        }
      }
    }
    
    console.log("WSU 2FA Auto-Fill: Could not find input associated with 'Enter code' label");
    return null;
  }

  findSubmitButton() {
    // Try multiple selectors to find the submit button
    const selectors = [
      'button[data-se="save"]',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Verify")',
      'button:contains("Submit")',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        console.log(
          `WSU 2FA Auto-Fill: Found submit button using selector: ${selector}`,
        );
        return element;
      }
    }

    // Look for button with verify-related text
    const buttons = document.querySelectorAll("button");
    for (const button of buttons) {
      const text = button.textContent.toLowerCase().trim();
      if (
        text.includes("verify") ||
        text.includes("submit") ||
        text.includes("continue")
      ) {
        console.log("WSU 2FA Auto-Fill: Found submit button by text content");
        return button;
      }
    }

    return null;
  }

  getInputLabel(input) {
    // Try to find associated label
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.textContent;
    }

    // Check for aria-label
    if (input.getAttribute("aria-label")) {
      return input.getAttribute("aria-label");
    }

    // Check placeholder
    if (input.placeholder) {
      return input.placeholder;
    }

    // Look for nearby text
    const parent = input.closest("div");
    if (parent) {
      const label = parent.querySelector("label");
      if (label) return label.textContent;
    }

    return null;
  }

  fillAndSubmitCode(code, autoSubmit = true) {
    const passcodeInput = this.findPasscodeInput();

    if (!passcodeInput) {
      console.log("WSU 2FA Auto-Fill: Could not find passcode input field");
      return false;
    }

    // Clear any existing value
    passcodeInput.value = "";

    // Focus the input
    passcodeInput.focus();

    // Fill the code
    passcodeInput.value = code;

    // Add 0.25 second delay before triggering events
    setTimeout(() => {
      // Trigger input events to ensure the page recognizes the change
      const events = ["input", "change", "keyup"];
      events.forEach((eventType) => {
        const event = new Event(eventType, { bubbles: true });
        passcodeInput.dispatchEvent(event);
      });

      console.log(`WSU 2FA Auto-Fill: Filled code: ${code}`);

      if (autoSubmit) {
        // Additional delay before submitting to ensure the form processes the input
        setTimeout(() => {
          const submitButton = this.findSubmitButton();

          if (submitButton && !submitButton.disabled) {
            console.log("WSU 2FA Auto-Fill: Clicking submit button");
            submitButton.click();
          } else {
            console.log("WSU 2FA Auto-Fill: Submit button not found or disabled");

            // Try to submit the form directly
            const form = passcodeInput.closest("form");
            if (form) {
              console.log("WSU 2FA Auto-Fill: Submitting form directly");
              form.submit();
            }
          }
        }, 200);
      }
    }, 250); // 0.25 second delay

    return true;
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new WSU2FAAutoFill();
  });
} else {
  new WSU2FAAutoFill();
}
