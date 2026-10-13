"use client";
import { useCallback, useEffect, useRef } from "react";

type Reply = { id: number; ok: boolean; vector?: number[] };

/**
 * Starts the in-browser embedding model in the background. `embed` returns the
 * vector only if the model is already loaded, otherwise null right away.
 * Drafting never waits for the model download.
 */
export function useEmbedder() {
  const worker = useRef<Worker | null>(null);
  const ready = useRef(false);
  const seq = useRef(0);
  const waiting = useRef(new Map<number, (v: number[] | null) => void>());

  useEffect(() => {
    let w: Worker;
    try {
      w = new Worker(new URL("./embed-worker.ts", import.meta.url), { type: "module" });
    } catch {
      return;
    }
    worker.current = w;
    const pending = waiting.current;
    w.onmessage = (e: MessageEvent<Reply>) => {
      const { id, ok, vector } = e.data;
      if (id === 0) ready.current = ok;
      pending.get(id)?.(ok && vector ? vector : null);
      pending.delete(id);
    };
    w.onerror = () => { ready.current = false; };
    w.postMessage({ id: 0, type: "load" });
    return () => { w.terminate(); worker.current = null; ready.current = false; pending.forEach((r) => r(null)); pending.clear(); };
  }, []);

  return useCallback((text: string): Promise<number[] | null> => {
    if (!ready.current || !worker.current) return Promise.resolve(null);
    const id = ++seq.current;
    return new Promise((resolve) => {
      const t = setTimeout(() => { waiting.current.delete(id); resolve(null); }, 3000);
      waiting.current.set(id, (v) => { clearTimeout(t); resolve(v); });
      worker.current!.postMessage({ id, type: "embed", text });
    });
  }, []);
}
