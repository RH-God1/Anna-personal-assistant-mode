import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditBundle, pseudoLocalize } from "../src/core.js";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-qa-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

test("detects missing keys and placeholder drift", () => {
  const root = fixture({
    "locales/en.json": JSON.stringify({ hello: "Hello {name}", bye: "Bye" }),
    "locales/zh-CN.json": JSON.stringify({ hello: "你好 {user}" }),
    "index.html": '<p data-i18n="hello"></p>'
  });
  const report = auditBundle(root);
  assert.equal(report.errorCount, 2);
  assert(report.issues.some((item) => item.code === "missing_key"));
  assert(report.issues.some((item) => item.code === "placeholder_mismatch"));
});

test("flags unreachable short-window layouts", () => {
  const root = fixture({
    "locales/en.json": JSON.stringify({ hello: "Hello" }),
    "style.css": "html, body { overflow: hidden; height: 100%; }"
  });
  const report = auditBundle(root);
  assert(report.issues.some((item) => item.code === "min_window_unreachable"));
});

test("pseudo locale preserves placeholders and expands text", () => {
  const value = pseudoLocalize("Hello {name}");
  assert(value.includes("{name}"));
  assert(value.length > "Hello {name}".length);
});

test("audits a complete bundle fixture without errors", () => {
  const root = fixture({
    "locales/en.json": JSON.stringify({
      hello: "Hello {name}",
      cta: "Start"
    }),
    "locales/zh-CN.json": JSON.stringify({
      hello: "你好 {name}",
      cta: "开始"
    }),
    "index.html": '<html lang="zh-CN"><body><p data-i18n="hello"></p><button data-i18n="cta"></button></body></html>',
    "style.css": "html, body { min-height: 100%; }"
  });
  const report = auditBundle(root);
  assert.equal(report.errorCount, 0);
  assert.equal(report.warningCount, 0);
});
