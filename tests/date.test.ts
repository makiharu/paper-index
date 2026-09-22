import { mkdtemp, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { classifyOcrJsonFile } from "../src/date/classifyOcrResults.js";

test("classifies OCR text by compact date and preserves explicit sequence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-inbox-date-test-"));
  const input = path.join(root, "scan.json");
  const output = path.join(root, "by-date");
  await mkdir(output);
  await writeFile(input, JSON.stringify({ source: "scan.pdf", sourceHash: "hash", processedAt: "now", text: "前置き\n20260901\n一つ目\n20260901 2\n二つ目\n" }));

  assert.equal(await classifyOcrJsonFile(input, output), 2);
  assert.deepEqual(await readdir(path.join(output, "20260901")), ["scan.pdf-001.json", "scan.pdf-002.json"]);
  assert.match(await readFile(path.join(output, "20260901", "scan.pdf-002.json"), "utf8"), /二つ目/);
});

test("normalizes separated dates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-inbox-date-test-"));
  const input = path.join(root, "scan.json");
  const output = path.join(root, "by-date");
  await writeFile(input, JSON.stringify({ source: "scan.pdf", text: "2026.9.1\n本文" }));
  await classifyOcrJsonFile(input, output);
  assert.ok(await readFile(path.join(output, "20260901", "scan.pdf-001.json"), "utf8"));
});
