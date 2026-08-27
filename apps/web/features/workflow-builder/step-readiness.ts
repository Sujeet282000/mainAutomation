import { needsConnection, opFields, fieldKey, type CatalogApp, type CatalogOp } from "@/lib/catalog";
import type { StepData } from "./store";

export function setupComplete(data: StepData, app?: CatalogApp) {
  if (!data.appSlug || !data.operation) return false;
  if (app && needsConnection(app) && !data.connectionId) return false;
  return true;
}

export function configureComplete(data: StepData, op?: CatalogOp) {
  if (!data.operation || !op) return false;
  return opFields(op)
    .filter((f) => f.required)
    .every((f) => String(data.config[fieldKey(f)] ?? "").trim() !== "");
}

export function appendMapping(current: string, token: string, fieldKeyName: string) {
  const emailLike = /^(to|email|recipient|from)$/i.test(fieldKeyName);
  if (emailLike && current && /@/.test(current)) {
    return token;
  }
  if (!current) return token;
  if (/\s$/.test(current) || current.endsWith("{{")) return `${current}${token}`;
  return `${current} ${token}`;
}
