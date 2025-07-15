# SkipCode
*Because your time is worth more than typing six digits*

## Features

- **Secure TOTP Generation**: Uses Web Crypto API for generating 6-digit TOTP codes
- **Encrypted Storage**: Secret keys are encrypted using AES-GCM before being stored
- **Auto-Fill Capability**: Automatically detects and fills 2FA fields on login.wsu.edu
- **Manual Fill Option**: Copy codes or manually fill them when needed
- **Smart Detection**: Only triggers on pages with "Enter code" labels to avoid conflicts with password fields
- **Configurable**: Toggle auto-fill on/off as needed

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your toolbar

## Setup

1. Click the extension icon to open the popup
2. Enter your TOTP secret key (the same key you'd use in an authenticator app)
3. Press Enter or click "Save Secret Key"
4. Your key will be encrypted and stored securely

## Usage

### Automatic Mode (Default)
1. Navigate to login.wsu.edu and enter your username/password
2. When the 2FA page appears with "Enter code", the extension will automatically:
   - Wait 0.25 seconds after detecting the field
   - Generate and fill the current TOTP code
   - Wait 0.2 seconds then submit the form

### Manual Mode
1. Click the extension icon to view the current code
2. Click "Copy Code" or click on the code display to copy to clipboard
3. Click "Fill Code on Page" to manually fill the current page

### Controls
- **Auto-Fill Toggle**: Enable/disable automatic filling
- **Clear Key**: Remove the stored secret key (requires confirmation)

## Security Features

- Secret keys are encrypted using AES-GCM with randomly generated keys and IVs
- Encryption/decryption happens locally using the Web Crypto API
- No data is transmitted to external servers
- Keys are stored in Chrome's secure sync storage

## Timing Configuration

The extension uses carefully tuned delays for reliability:
- **Field Detection**: Checks every 0.25 seconds for the 2FA input field
- **Pre-Fill Delay**: Waits 0.25 seconds after finding the field before filling
- **Pre-Submit Delay**: Waits 0.2 seconds after filling before submitting

## Technical Details

### Files Structure
- `manifest.json` - Extension configuration
- `popup.html` - Extension popup interface
- `popup.js` - Popup logic and UI handling
- `content.js` - Content script for page interaction
- `totp.js` - TOTP algorithm implementation

### TOTP Implementation
- Uses RFC 6238 standard
- 6-digit codes with 30-second time steps
- HMAC-SHA1 algorithm
- Base32 secret key decoding

### Page Detection
The extension only activates when it finds:
- A label containing "Enter code" text
- An associated input field linked via the `for` attribute
- The input field is visible on the page

## Browser Compatibility

- Chrome (Manifest V3)
- Other Chromium-based browsers may work but are not officially supported

## Privacy

This extension:
- Only runs on login.wsu.edu pages
- Does not collect or transmit any personal data
- Stores encrypted secrets locally in your browser
- Uses no external services or APIs

## Troubleshooting

### Extension Not Working
1. Ensure you're on login.wsu.edu
2. Check that auto-fill is enabled (toggle should show "ON")
3. Try refreshing the page and re-entering the 2FA step

### Wrong Codes Generated
1. Verify your secret key is correct
2. Check your system clock is accurate
3. Clear and re-enter the secret key

### Performance Issues
1. Try disabling and re-enabling auto-fill
2. Reload the extension in Chrome's extension management
3. Clear browser cache and restart

## Development

To modify this extension:

1. Make changes to the source files
2. Reload the extension in `chrome://extensions/`
3. Test on login.wsu.edu

### Key Components
- **Mutation Observer**: Watches for DOM changes to detect 2FA fields
- **Message Passing**: Communication between popup and content scripts
- **Storage API**: Secure storage of encrypted credentials
- **Web Crypto API**: Encryption and TOTP generation

## License

This project is for educational and personal use. Please ensure compliance with your institution's policies before use.