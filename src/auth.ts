import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateOpaqueValue(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashOpenToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function signSessionCookie(sessionId: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(sessionId).digest("base64url");
  return `${sessionId}.${signature}`;
}

export function verifySignedSessionCookie(cookieValue: string, secret: string): string | null {
  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex === -1) {
    return null;
  }

  const sessionId = cookieValue.slice(0, dotIndex);
  const signature = cookieValue.slice(dotIndex + 1);
  const expected = createHmac("sha256", secret).update(sessionId).digest("base64url");

  return safeCompare(signature, expected) ? sessionId : null;
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((cookies, pair) => {
    const [name, ...valueParts] = pair.trim().split("=");
    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(valueParts.join("="));
    return cookies;
  }, {});
}

export function serializeSessionCookie(name: string, value: string, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
