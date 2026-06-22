import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTranslator, formatFocusedMinutes, normalizeLocale } from "../bundle/i18n.js";

const zh = JSON.parse(fs.readFileSync(new URL("../bundle/locales/zh-CN.json", import.meta.url)));
const en = JSON.parse(fs.readFileSync(new URL("../bundle/locales/en.json", import.meta.url)));

test("normalizes supported locales", () => {
  assert.equal(normalizeLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
});

test("uses one minute rule for totals and history", () => {
  assert.equal(formatFocusedMinutes(132, "zh-CN"), "2.2");
  assert.equal(formatFocusedMinutes(132, "en"), "2.2");
});

test("renders locale catalogs and English plurals", () => {
  assert.equal(createTranslator(zh, "zh-CN")("sessions", { count: 2 }), "2 次");
  assert.equal(createTranslator(en, "en")("sessions", { count: 1 }), "1 session");
  assert.equal(createTranslator(en, "en")("sessions", { count: 2 }), "2 sessions");
});

test("catalogs expose the same keys", () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});
