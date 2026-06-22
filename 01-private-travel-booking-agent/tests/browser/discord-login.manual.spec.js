const { test, expect } = require("@playwright/test");

const GOOGLE_URL = "https://www.google.com/?hl=zh-CN";
const DISCORD_LOGIN_URL = "https://discord.com/login";

test("通过 Google 打开 Discord，并停在账号密码登录步骤", async ({ page }) => {
  if (process.env.DC_SKIP_GOOGLE !== "true") {
    await openDiscordFromGoogle(page);
  }

  await openDiscordLogin(page);

  const accountInput = page.locator(
    'input[name="email"], input[type="email"], input[autocomplete*="username"]'
  ).first();
  const passwordInput = page.locator(
    'input[name="password"], input[type="password"], input[autocomplete="current-password"]'
  ).first();

  await expect(accountInput, "没有找到 Discord 邮箱或手机号输入框").toBeVisible({
    timeout: 60_000
  });
  await expect(passwordInput, "没有找到 Discord 密码输入框").toBeVisible({
    timeout: 60_000
  });

  const usernameOrEmail = process.env.DISCORD_USERNAME_OR_EMAIL || "";
  const password = process.env.DISCORD_PASSWORD || "";

  if (usernameOrEmail && password) {
    await accountInput.fill(usernameOrEmail);
    await passwordInput.fill(password);
    console.log("Discord 账号和密码已填写。测试不会自动点击登录按钮。");
  } else {
    console.log("Discord 登录页已打开。请手动输入邮箱或手机号和密码。");
  }

  if (process.env.DC_VERIFY_ONLY === "true") {
    console.log("Discord 登录表单验证成功。");
    return;
  }

  console.log("浏览器会保持打开。完成手动测试后，关闭浏览器窗口即可结束测试。");
  await page.waitForEvent("close");
});

async function openDiscordFromGoogle(page) {
  await page.goto(GOOGLE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });

  await acceptGoogleConsent(page);

  const searchBox = page.locator('textarea[name="q"], input[name="q"]').first();
  await expect(searchBox).toBeVisible({
    timeout: 30_000
  });
  await searchBox.fill("discord.com");
  await searchBox.press("Enter");

  const officialResult = await waitForGoogleDiscordResult(page, 5 * 60_000);
  const href = await officialResult.getAttribute("href");
  console.log(`Google 已找到 Discord 官方结果：${href || "https://discord.com/"}`);
}

async function openDiscordLogin(page) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await page.goto(DISCORD_LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000
      });

      if (!response || !response.ok()) {
        throw new Error(`Discord 返回 HTTP ${response ? response.status() : "未知状态"}`);
      }

      console.log("Discord 官方登录页连接成功。");
      return;
    } catch (error) {
      lastError = error;
      console.log(`Discord 登录页第 ${attempt} 次连接失败：${error.message.split("\n")[0]}`);
      if (attempt < 3) {
        await page.waitForTimeout(3_000);
      }
    }
  }

  throw lastError;
}

async function acceptGoogleConsent(page) {
  const consentButton = page.getByRole("button", {
    name: /接受全部|全部接受|同意|Accept all|I agree/i
  }).first();

  if (await consentButton.isVisible().catch(() => false)) {
    await consentButton.click();
  }
}

async function waitForGoogleDiscordResult(page, timeout) {
  const deadline = Date.now() + timeout;
  let challengeMessageShown = false;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error("浏览器页面已关闭，无法继续 Google 搜索流程。");
    }

    if (page.url().includes("/sorry/") && !challengeMessageShown) {
      console.log("Google 要求人机验证。完成验证后脚本会自动继续。");
      challengeMessageShown = true;
    }

    const result = page.locator('a[href*="discord.com"]:has(h3)').first();
    if (await result.isVisible().catch(() => false)) {
      if (challengeMessageShown) {
        console.log("已检测到 Google 验证完成。");
      }
      return result;
    }

    await page.waitForTimeout(750);
  }

  throw new Error("等待 Google 验证或 Discord 官方搜索结果超时。");
}
