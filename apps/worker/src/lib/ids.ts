import crypto from "node:crypto";

export function randomId(prefix?: string) {
  const raw = crypto.randomUUID();
  return prefix ? `${prefix}_${raw}` : raw;
}

export function nowIso() {
  return new Date().toISOString();
}

