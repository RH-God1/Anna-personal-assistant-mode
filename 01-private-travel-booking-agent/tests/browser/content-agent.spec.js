const { test, expect } = require("@playwright/test");

test("关闭自动导航时，启动和重新扫描都不会点击网页", async ({ page }) => {
  await page.goto("/manual");
  await page.evaluate(() => {
    window.sendAgentMessage({
      type: "TRAVEL_AGENT_START",
      settings: { autoNavigation: false, quietMode: true }
    });
  });

  await expect(page.locator("#stage")).toContainText("阶段：查询航班");
  await page.getByRole("button", { name: "重新扫描" }).click();
  await page.waitForTimeout(1100);
  await expect(page.locator("#stage")).toContainText("阶段：查询航班");
});

test("自动导航只前进到个人信息 gate，并在付款与成功状态暂停", async ({ page }) => {
  await page.goto("/manual");
  await page.getByRole("button", { name: "启动测试 Agent" }).click();

  await expect(page.locator(".ta-panel")).toContainText("等待用户输入");
  await expect(page.locator("input[name='passenger_name']")).toHaveClass(/ta-sensitive-field/);

  await page.getByRole("button", { name: "我已输入" }).click();
  await page.locator("#confirmOrder").click();
  await expect(page.locator(".ta-panel")).toContainText("等待用户付款");

  await page.locator("#paid").click();
  await expect(page.locator(".ta-panel")).toContainText("已捕捉付款完成");
});
