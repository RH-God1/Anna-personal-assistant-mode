import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test
} from "../../../01-private-travel-booking-agent/node_modules/@playwright/test/index.mjs";

const require = createRequire(import.meta.url);
const electronExecutablePath = require("electron");
const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, "../..");

async function fetchStatus(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/status", {
      headers: { "X-Anna-Admin-Token": window.__ANNA_ADMIN_TOKEN__ }
    });
    if (!response.ok) throw new Error(`status returned HTTP ${response.status}`);
    return response.json();
  });
}

test("desktop shell matches the web host catalog and runs active Anna Apps", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-desktop-test-"));
  const electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectDir],
    cwd: projectDir,
    env: {
      ...process.env,
      ANNA_DESKTOP_PORT: "0",
      ANNA_DESKTOP_USER_DATA_DIR: userDataDir
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1440, height: 1000 });

    await expect(page).toHaveTitle("Anna Local Host Lab");
    await expect(page.getByText("Anna Host", { exact: false })).toBeVisible();
    await expect(page.locator("#windowTitle")).toHaveText("尚未启动应用");
    await expect(page.locator("#emptyState")).toBeVisible();
    await expect(page.locator("#appFrame")).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
    );

    const status = await fetchStatus(page);
    const cards = await page.locator("[data-app]").evaluateAll((nodes) =>
      nodes.map((node) => ({
        slug: node.dataset.app,
        text: node.textContent.replace(/\s+/g, " ").trim()
      }))
    );

    expect(cards.map((card) => card.slug)).toEqual(status.apps.map((app) => app.slug));
    for (const app of status.apps) {
      const card = cards.find((item) => item.slug === app.slug);
      expect(card?.text).toContain(app.name);
      expect(card?.text).toContain(app.version);
      expect(card?.text).toContain(app.summary);
    }

    await page.locator('[data-app="private-travel-agent"]').click();
    let frame = page.frameLocator("#appFrame");
    await expect(frame.locator("#connection")).toHaveText("已连接 Anna");
    const submitButton = frame.locator("#searchForm button[type=submit]");
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
    await submitButton.focus();
    await submitButton.press("Enter");
    await expect(frame.locator("#status")).toHaveText("await_traveler_info");
    await frame.locator("#travelerDone").click();
    await expect(frame.locator("#status")).toHaveText("await_payment");
    await frame.locator("#paymentDone").click();
    await expect(frame.locator("#status")).toHaveText("post_payment");

    await page.locator('[data-app="personal-assistant-mode"]').click();
    frame = page.frameLocator("#appFrame");
    await expect(frame.locator("#connectionStatus")).toHaveText("已连接 Anna");
    await expect(frame.locator("#modelSelect option")).not.toHaveCount(0);
    await frame.locator('[data-target="healthPanel"]').click();
    await frame.locator("#healthConsent").focus();
    await frame.locator("#healthConsent").press("Space");
    await expect(frame.locator("#healthConsent")).toBeChecked();
    await frame.locator("#healthConnectButton").focus();
    await frame.locator("#healthConnectButton").press("Enter");
    await expect(frame.locator("#healthBadge")).toContainText("已连接");
    await frame.locator("#messageInput").fill("请帮我区分这个决定里的事实与未知");
    await frame.locator("#sendButton").focus();
    await frame.locator("#sendButton").press("Enter");
    await expect(frame.locator("#assistantOutput h3")).toContainText("决策");
    await expect(frame.locator("#assistantOutput p")).toContainText("低代价的小测试");

    await frame.locator("#messageInput").fill("我现在有点焦虑，也担心把猜测当成事实");
    await frame.locator("#sendButton").focus();
    await frame.locator("#sendButton").press("Enter");
    await expect(frame.locator("#assistantOutput p")).toContainText("可确认的事实");

    await frame.locator("#messageInput").fill("结合刚才的健康数据，提醒我边界");
    await frame.locator("#sendButton").focus();
    await frame.locator("#sendButton").press("Enter");
    await expect(frame.locator("#assistantOutput p")).toContainText("单次读数不能说明健康状态");

    await frame.locator("#syncButton").focus();
    await frame.locator("#syncButton").press("Enter");
    await expect(frame.locator("#syncButton")).toHaveText("已交给 Anna 对话");

    await expect(page.locator("#auditList li")).not.toHaveCount(0);
    const finalStatus = await fetchStatus(page);
    expect(finalStatus.window_count).toBe(1);
    expect(finalStatus.executas).not.toHaveLength(0);
    for (const executa of finalStatus.executas) {
      expect(executa.node_path).not.toContain("Electron.app");
    }
  } finally {
    await electronApp.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
