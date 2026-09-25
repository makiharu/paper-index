import { mkdtemp, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { classifyOcrJsonFile } from "../src/date/classifyOcrResults.js";

test("classifies legacy OCR text by compact date and preserves explicit sequence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-inbox-date-test-"));
  const input = path.join(root, "scan.json");
  const output = path.join(root, "by-date");
  await mkdir(output);
  await writeFile(input, JSON.stringify({ source: "scan.pdf", sourceHash: "hash", processedAt: "now", text: "前置き\n20260901\n一つ目\n20260901 2\n二つ目\n" }));

  assert.equal(await classifyOcrJsonFile(input, output), 2);
  assert.deepEqual(await readdir(path.join(output, "20260901")), ["2026.09.01.1.json", "2026.09.01.2.json", "2026.09.01.md"]);
  assert.match(await readFile(path.join(output, "20260901", "2026.09.01.2.json"), "utf8"), /二つ目/);
  assert.match(await readFile(path.join(output, "20260901", "2026.09.01.md"), "utf8"), /## 2026\.09\.01\.2/);
});

test("normalizes separated dates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-inbox-date-test-"));
  const input = path.join(root, "scan.json");
  const output = path.join(root, "by-date");
  await writeFile(input, JSON.stringify({ source: "scan.pdf", text: "2026.9.1\n本文" }));
  await classifyOcrJsonFile(input, output);
  assert.ok(await readFile(path.join(output, "20260901", "2026.09.01.1.json"), "utf8"));
});

test("classifies each OCR page using dotted date, weekday, and sequence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-inbox-date-test-"));
  const input = path.join(root, "scan.pdf.json");
  const output = path.join(root, "by-date");
  await mkdir(output);
  await writeFile(input, JSON.stringify({
    source: "scan.pdf",
    pages: [
      { pageNumber: 1, text: "2026.09.24.金.1\n一ページ目" },
      { pageNumber: 2, text: "2026.09.24.金.2\n二ページ目" },
    ],
  }));

  assert.equal(await classifyOcrJsonFile(input, output), 2);
  assert.deepEqual(await readdir(path.join(output, "20260924")), [
    "2026.09.24.1.json",
    "2026.09.24.2.json",
    "2026.09.24.md",
  ]);
  const markdown = await readFile(path.join(output, "20260924", "2026.09.24.md"), "utf8");
  assert.match(markdown, /## 2026\.09\.24\.1/);
  assert.match(markdown, /## 2026\.09\.24\.2/);
  assert.match(markdown, /二ページ目/);
});

test("puts a page without a date marker under _undated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-inbox-date-test-"));
  const input = path.join(root, "scan.json");
  const output = path.join(root, "by-date");
  await mkdir(output);
  await writeFile(input, JSON.stringify({ source: "scan.pdf", pages: [{ pageNumber: 3, text: "本文だけ" }] }));

  assert.equal(await classifyOcrJsonFile(input, output), 1);
  assert.match(await readFile(path.join(output, "_undated", "_undated.3.json"), "utf8"), /本文だけ/);
});
