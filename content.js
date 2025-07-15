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

class WSU2FAAutoFill {
  constructor() {
    this.retryTimeout = null;
    this.hasAttempted = false;
    this.init();
  }

  async init() {
    console.log("WSU 2FA Auto-Fill: Content script loaded");

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "fillCode") {
        this.fillAndSubmitCode(request.code);
        sendResponse({ success: true });
      }
    });

    // Check if auto-fill is enabled and attempt to fill
    const result = await chrome.storage.sync.get([
      "autoFillEnabled",
      "totpSecret",
    ]);
    if (result.autoFillEnabled !== false && result.totpSecret) {
      this.attemptAutoFill(result.totpSecret);
    }
  }

  async attemptAutoFill(secret) {
    if (this.hasAttempted) return;

    console.log("WSU 2FA Auto-Fill: Attempting auto-fill");
    this.hasAttempted = true;

    try {
      const code = await TOTP.generate(secret);

      // Wait a bit for the page to fully load
      setTimeout(() => {
        const success = this.fillAndSubmitCode(code);

        if (!success) {
          console.log(
            "WSU 2FA Auto-Fill: Initial attempt failed, will retry in 30 seconds",
          );
          this.scheduleRetry(secret);
        }
      }, 1000);
    } catch (error) {
      console.error("WSU 2FA Auto-Fill: Error generating code:", error);
      this.scheduleRetry(secret);
    }
  }

  scheduleRetry(secret) {
    if (this.retryTimeout) return; // Already scheduled

    this.retryTimeout = setTimeout(async () => {
      console.log("WSU 2FA Auto-Fill: Retrying auto-fill");
      try {
        const code = await TOTP.generate(secret);
        this.fillAndSubmitCode(code, false); // Don't auto-submit on retry
      } catch (error) {
        console.error("WSU 2FA Auto-Fill: Error on retry:", error);
      }
      this.retryTimeout = null;
    }, 30000);
  }

  findPasscodeInput() {
    // Try multiple selectors to find the passcode input
    const selectors = [
      'input[id="credentials.passcode"]',
      'input[name="credentials.passcode"]',
      'input[data-se="credentials.passcode"]',
      'input[type="text"][inputmode="numeric"]',
      'input[autocomplete="off"][type="text"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        console.log(
          `WSU 2FA Auto-Fill: Found passcode input using selector: ${selector}`,
        );
        return element;
      }
    }

    // Look for input that might be the TOTP field based on context
    const allInputs = document.querySelectorAll('input[type="text"]');
    for (const input of allInputs) {
      const labelText = this.getInputLabel(input);
      if (
        labelText &&
        (labelText.toLowerCase().includes("code") ||
          labelText.toLowerCase().includes("authenticator") ||
          labelText.toLowerCase().includes("verify"))
      ) {
        console.log("WSU 2FA Auto-Fill: Found passcode input by label context");
        return input;
      }
    }

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

    // Trigger input events to ensure the page recognizes the change
    const events = ["input", "change", "keyup"];
    events.forEach((eventType) => {
      const event = new Event(eventType, { bubbles: true });
      passcodeInput.dispatchEvent(event);
    });

    console.log(`WSU 2FA Auto-Fill: Filled code: ${code}`);

    if (autoSubmit) {
      // Small delay before submitting to ensure the form processes the input
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
      }, 500);
    }

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
