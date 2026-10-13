/// <reference lib="webworker" />
// Runs in a Web Worker. Turns a review into a 384-number vector in the browser,
// so there is no embedding server to run. Same model family as the stored vectors:
// BAAI/bge-small-en-v1.5 (CLS pooling, normalized).
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function load() {
  extractor ??= pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8" }) as Promise<FeatureExtractionPipeline>;
  return extractor;
}

self.onmessage = async (e: MessageEvent<{ id: number; type: "load" | "embed"; text?: string }>) => {
  const { id, type, text } = e.data;
  try {
    const ex = await load();
    if (type === "load") return self.postMessage({ id, ok: true });
    const out = await ex(text ?? "", { pooling: "cls", normalize: true });
    self.postMessage({ id, ok: true, vector: Array.from(out.data as Float32Array) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
