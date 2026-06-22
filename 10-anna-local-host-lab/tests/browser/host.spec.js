import {
  test,
  expect
} from "../../../01-private-travel-booking-agent/node_modules/@playwright/test/index.mjs";

test("Host console runs the active Anna Apps through the local SDK", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Anna Host", { exact: false })).toBeVisible();
  await expect(page.locator("#appFrame")).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
  );

  await page.locator('[data-app="private-travel-agent"]').click();
  let frame = page.frameLocator("#appFrame");
  await expect(frame.locator("#connection")).toHaveText("已连接 Anna");
  await frame.locator("#searchForm button[type=submit]").click();
  await expect(frame.locator("#status")).toHaveText("await_traveler_info");
  await frame.locator("#travelerDone").click();
  await expect(frame.locator("#status")).toHaveText("await_payment");
  await frame.locator("#paymentDone").click();
  await expect(frame.locator("#status")).toHaveText("post_payment");

  await page.locator('[data-app="personal-assistant-mode"]').click();
  frame = page.frameLocator("#appFrame");
  await expect(frame.locator("#connectionStatus")).toHaveText("已连接 Anna");
  await expect(page.locator("#auditList")).toContainText("chat.write_message / ok");
  await expect(page.locator("#auditList")).toContainText("personal-assistant-mode · keys: content, role");
  await expect(frame.locator("#modelSelect option")).not.toHaveCount(0);
  await frame.locator("#healthConsent").check();
  await frame.locator("#healthConnectButton").click();
  await expect(frame.locator("#healthBadge")).toContainText("已连接");
  await frame.locator("#travelPlanButton").click();
  await expect(frame.locator("#travelStatus")).toContainText("等待用户确认");
  await expect(frame.locator("#travelBoundary")).toContainText("等待你确认");
  await frame.locator("#travelConfirmButton").click();
  await expect(frame.locator("#travelStatus")).toContainText("等待订购授权");
  await frame.locator("#travelConfirmButton").click();
  await expect(frame.locator("#travelStatus")).toContainText("等待外站接管");
  await expect(frame.locator("#travelSite")).toContainText("Expedia Flights");
  await expect(frame.locator("#travelLink")).toHaveAttribute("href", /https:\/\/www\.expedia\.com\/Flights-Search/);
  await frame.locator("#messageInput").fill("请帮我区分这个决定里的事实与未知");
  await frame.locator("#sendButton").click();
  await expect(frame.locator("#assistantOutput h3")).toContainText("决策");
  await expect(frame.locator("#assistantOutput p")).toContainText("低代价的小测试");

  await frame.locator("#messageInput").fill("我现在有点焦虑，也担心把猜测当成事实");
  await frame.locator("#sendButton").click();
  await expect(frame.locator("#assistantOutput p")).toContainText("可确认的事实");

  await frame.locator("#messageInput").fill("结合刚才的健康数据，提醒我边界");
  await frame.locator("#sendButton").click();
  await expect(frame.locator("#assistantOutput p")).toContainText("单次读数不能说明健康状态");

  await frame.locator("#attachmentInput").setInputFiles([
    {
      name: "voice-note.m4a",
      mimeType: "audio/mp4",
      buffer: Buffer.from("anna-audio")
    }
  ]);
  await frame.locator("#modelSelect").selectOption("gemma-4-e4b-it");
  await frame.locator("#messageInput").fill("顺便结合这段录音看看");
  await frame.locator("#sendButton").click();
  await expect(frame.locator("#assistantOutput h3")).toContainText("已识别 1 个附件");
  await expect(frame.locator("#modelDecision")).toContainText("Anna 自动选择");
  await frame.locator("#syncButton").click();
  await expect(frame.locator("#syncButton")).toHaveText("已交给 Anna 对话");

  await expect(page.locator("#auditList li")).not.toHaveCount(0);
});
