"use client";

const STORAGE_KEY = "awliver_guestbook_visitor";

export function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing && existing.length >= 8) return existing;
  const next = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(STORAGE_KEY, next);
  return next;
}

export async function guestbookFetch(input: RequestInfo | URL, init?: RequestInit) {
  const visitorId = getOrCreateVisitorId();
  const headers = new Headers(init?.headers);
  if (visitorId) headers.set("x-visitor-id", visitorId);
  return fetch(input, { ...init, headers });
}

