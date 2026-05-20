import { Injectable } from "@nestjs/common";
import { Server } from "socket.io";

const SENSITIVE_KEYS = new Set(["apiKey", "webhookSecret"]);

@Injectable()
export class RealtimeService {
  private server?: Server;

  attach(server: Server) {
    this.server = server;
  }

  emitToCompany(companyId: string, event: string, payload: unknown) {
    this.server
      ?.to(`company:${companyId}`)
      .emit(event, this.redactSensitiveKeys(payload));
  }

  private redactSensitiveKeys(
    value: unknown,
    seen = new WeakSet<object>(),
  ): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }

    if (value instanceof Date) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactSensitiveKeys(item, seen));
    }

    if (seen.has(value)) {
      return null;
    }

    seen.add(value);

    const sanitized = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEYS.has(key))
        .map(([key, item]) => [key, this.redactSensitiveKeys(item, seen)]),
    );

    seen.delete(value);

    return sanitized;
  }
}
