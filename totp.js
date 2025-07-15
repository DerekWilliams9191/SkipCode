// TOTP implementation
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

  static getTimeRemaining(timeStep = 30) {
    const epoch = Math.floor(Date.now() / 1000);
    return timeStep - (epoch % timeStep);
  }
}
