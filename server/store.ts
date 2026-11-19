// Typed access to each user's stored data by storage key (shared/storageKeys.ts).
// The data lives in tables; server/userData.ts maps every key to its rows.
import { STORAGE_KEYS } from '#shared/storageKeys.ts';
import * as userData from './userData.ts';

export const KEYS = STORAGE_KEYS;

export function getValue(userId: number, key: string): string | null {
  return userData.getValue(userId, key);
}

/** Parses a stored JSON value; a corrupt one reads as missing, like the frontend treats it. */
export function getJson<T>(userId: number, key: string): T | null {
  return parseJson<T>(getValue(userId, key));
}

export function parseJson<T>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The ids stored under a key prefix, e.g. every id with an `app-config-<id>` key. */
export function idsWithStoredKey(userId: number, prefix: string): string[] {
  return userData.idsWithStoredKey(userId, prefix);
}

export function setValue(userId: number, key: string, value: string): void {
  userData.setValue(userId, key, value);
}

export function setJson(userId: number, key: string, value: unknown): void {
  setValue(userId, key, JSON.stringify(value));
}

export function removeValue(userId: number, key: string): void {
  userData.setValue(userId, key, null);
}

/** Every key the user has stored, with its value. */
export function allValues(userId: number): Record<string, string> {
  return userData.allValues(userId);
}

/** Every user with a value under `key`, with that value. */
export function valuesOfAllUsers(key: string): { userId: number; value: string }[] {
  return userData.valuesOfAllUsers(key);
}
