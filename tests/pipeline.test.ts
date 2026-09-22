import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { findImages } from "../src/scanner/findImages.js";
import { CacheStore } from "../src/cache/CacheStore.js";
import { ArchiveStore } from "../src/archive/ArchiveStore.js";
import { processImages } from "../src/pipeline/processImages.js";
import type { OcrProvider } from "../src/ocr/OcrProvider.js";
import type { ImagePreprocessor } from "../src/ocr/ImagePreprocessor.js";

async function fixture(): Promise<{ root: string; inbox: string; cache: string; archive: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-inbox-test-"));
  const inbox = path.join(root, "inbox");
  const cache = path.join(root, "cache");
  const archive = path.join(root, "archive");
  await mkdir(inbox);
  return { root, inbox, cache, archive };
}

test("findImages includes supported images and excludes non-images", async () => {
  const { inbox } = await fixture();
  await Promise.all([
    writeFile(path.join(inbox, "a.jpg"), "a"),
    writeFile(path.join(inbox, "b.JPEG"), "b"),
    writeFile(path.join(inbox, "c.png"), "c"),
    writeFile(path.join(inbox, "d.HEIC"), "d"),
    writeFile(path.join(inbox, "e.pdf"), "e"),
    writeFile(path.join(inbox, "notes.txt"), "no"),
  ]);
  assert.deepEqual((await findImages(inbox)).map((image) => path.basename(image)), ["a.jpg", "b.JPEG", "c.png", "d.HEIC", "e.pdf"]);
});

test("preprocesses HEIC for OCR but archives the original", async () => {
  const { inbox, cache, archive } = await fixture();
  const heic = path.join(inbox, "scan.HEIC");
  await writeFile(heic, "original-heic");
  let recognizedPath = "";
  let cleaned = false;
  const preprocessor: ImagePreprocessor = {
    async prepare() {
      return { path: "/tmp/converted.jpg", cleanup: async () => { cleaned = true; } };
    },
  };
  const provider: OcrProvider = { async recognize(imagePath) { recognizedPath = imagePath; return { text: "ok" }; } };
  const summary = await processImages([heic], provider, new CacheStore(cache), new ArchiveStore(archive), {
    concurrency: 1, force: false, preprocessor,
  });
  assert.equal(recognizedPath, "/tmp/converted.jpg");
  assert.equal(cleaned, true);
  assert.deepEqual(summary, { total: 1, processed: 1, cached: 0, failed: 0, archived: 1 });
});

test("successful OCR is cached and archived, while failures remain in inbox", async () => {
  const { inbox, cache, archive } = await fixture();
  await Promise.all([
    writeFile(path.join(inbox, "ok.jpg"), "ok"),
    writeFile(path.join(inbox, "bad.jpg"), "bad"),
  ]);
  let calls = 0;
  const provider: OcrProvider = {
    async recognize(imagePath) {
      calls += 1;
      if (imagePath.endsWith("bad.jpg")) throw new Error("mock failure");
      return { text: "読み取り結果", sourceDate: "2026-09-22T00:00:00.000Z" };
    },
  };
  const first = await processImages(await findImages(inbox), provider, new CacheStore(cache), new ArchiveStore(archive), {
    concurrency: 2, force: false,
  });
  assert.equal(calls, 2);
  assert.deepEqual(first, { total: 2, processed: 1, cached: 0, failed: 1, archived: 1 });
  assert.deepEqual(await readdir(inbox), ["bad.jpg"]);
  const cached = JSON.parse(await readFile(path.join(cache, "ok.jpg.json"), "utf8"));
  assert.equal(cached.text, "読み取り結果");

  const second = await processImages(await findImages(inbox), provider, new CacheStore(cache), new ArchiveStore(archive), {
    concurrency: 1, force: false,
  });
  assert.equal(calls, 3, "only the remaining failed image is retried");
  assert.equal(second.cached, 0);
  assert.equal(second.failed, 1);
});

test("a valid cache skips OCR and archives the source", async () => {
  const { inbox, cache, archive } = await fixture();
  await writeFile(path.join(inbox, "cached.png"), "cached");
  const provider: OcrProvider = { async recognize() { throw new Error("should not run"); } };
  const store = new CacheStore(cache);
  await store.put(path.join(inbox, "cached.png"), { text: "cached text" });
  const summary = await processImages(await findImages(inbox), provider, store, new ArchiveStore(archive), {
    concurrency: 1, force: false,
  });
  assert.deepEqual(summary, { total: 1, processed: 0, cached: 1, failed: 0, archived: 1 });
});
