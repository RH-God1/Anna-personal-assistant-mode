import crypto from "node:crypto";

export interface EnvelopeEncryptionService {
  encryptSecret(plaintext: string): string;
  decryptSecret(ciphertext: string): string;
}

export class LocalEnvelopeEncryptionService implements EnvelopeEncryptionService {
  private readonly key: Buffer;

  constructor(masterKey = process.env.LOCAL_ENVELOPE_MASTER_KEY ?? "anna-dev-local-envelope-key-change-me") {
    this.key = crypto.createHash("sha256").update(masterKey).digest();
  }

  encryptSecret(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `local-v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
  }

  decryptSecret(ciphertext: string): string {
    const [version, ivBase64, tagBase64, payloadBase64] = ciphertext.split(":");
    if (version !== "local-v1" || !ivBase64 || !tagBase64 || !payloadBase64) {
      throw new Error("Unsupported encrypted secret format");
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivBase64, "base64"));
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payloadBase64, "base64")),
      decipher.final()
    ]).toString("utf8");
  }
}
