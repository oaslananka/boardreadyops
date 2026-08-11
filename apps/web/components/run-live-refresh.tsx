"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  type RunLiveRefreshEnvironment,
  type RunLiveRefreshEvent,
  startRunLiveRefresh,
} from "../lib/run-live-refresh.js";

const refreshIntervalMilliseconds = 5_000;

type BrowserEventTarget = {
  addEventListener(event: string, callback: () => void): void;
  removeEventListener(event: string, callback: () => void): void;
};

type BrowserWindow = BrowserEventTarget & {
  setInterval(callback: () => void, intervalMilliseconds: number): number;
  clearInterval(handle: number): void;
};

type BrowserDocument = BrowserEventTarget & { visibilityState: string };
type BrowserNavigator = { onLine: boolean };

type BrowserGlobals = typeof globalThis & {
  window: BrowserWindow;
  document: BrowserDocument;
  navigator: BrowserNavigator;
};

function browserEnvironment(): RunLiveRefreshEnvironment {
  const browser = globalThis as BrowserGlobals;
  return {
    scheduleRepeating(callback, intervalMilliseconds) {
      return browser.window.setInterval(callback, intervalMilliseconds);
    },
    cancelRepeating(handle) {
      browser.window.clearInterval(handle as number);
    },
    subscribe(event: RunLiveRefreshEvent, callback) {
      const target = event === "online" ? browser.window : browser.document;
      target.addEventListener(event, callback);
      return () => target.removeEventListener(event, callback);
    },
    isOnline: () => browser.navigator.onLine,
    isVisible: () => browser.document.visibilityState === "visible",
  };
}

export function RunLiveRefresh({ enabled }: Readonly<{ enabled: boolean }>) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    return startRunLiveRefresh({
      refresh: () => router.refresh(),
      intervalMilliseconds: refreshIntervalMilliseconds,
      environment: browserEnvironment(),
    });
  }, [enabled, router]);

  if (!enabled) return null;
  return (
    <output className="live-refresh-status">
      <span className="live-refresh-indicator" aria-hidden="true" />
      <span>
        <strong>Live status updates</strong> refresh every five seconds and resume automatically after reconnect.
      </span>
    </output>
  );
}
