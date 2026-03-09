import crypto from "node:crypto";
import type { Request } from "express";
import type { SessionPayload } from "../types/domain.js";

export class SessionService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number
  ) {}

  createSessionToken(userId: string): string {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const payload: SessionPayload = {
      userId,
      iat: nowSeconds,
      exp: nowSeconds + this.ttlSeconds
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = crypto.createHmac("sha256", this.secret).update(encodedPayload).digest("base64url");

    return `${encodedPayload}.${signature}`;
  }

  verifySessionToken(token: string): SessionPayload | null {
    const [encodedPayload, signature] = token.split(".");

    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = crypto.createHmac("sha256", this.secret).update(encodedPayload).digest("base64url");
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionPayload>;

      if (typeof payload.userId !== "string" || typeof payload.exp !== "number" || typeof payload.iat !== "number") {
        return null;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp <= nowSeconds) {
        return null;
      }

      return payload as SessionPayload;
    } catch {
      return null;
    }
  }

  readBearerToken(req: Request): string | null {
    const authorization = req.header("authorization");

    if (!authorization) {
      return null;
    }

    const [scheme, token] = authorization.split(" ");

    if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
      return null;
    }

    return token;
  }
}
