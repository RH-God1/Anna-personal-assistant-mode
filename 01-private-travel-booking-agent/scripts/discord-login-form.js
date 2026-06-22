const http = require("http");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { chromium } = require("@playwright/test");

const HOST = "127.0.0.1";
const PORT = Number(process.env.DC_CREDENTIALS_PORT || 9333);
const DISCORD_LOGIN_URL = "https://discord.com/login";
const PROFILE_DIR = process.env.DC_PROFILE_DIR ||
  path.join(os.homedir(), ".anna", "browser-profiles", "discord-chrome");
const FORM_TOKEN = crypto.randomBytes(32).toString("hex");

let activeContext = null;
let activeBrowser = null;

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      sendHtml(response, loginForm(FORM_TOKEN));
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "discord-playwright-credentials"
      });
      return;
    }

    if (request.method === "POST" && request.url === "/run") {
      assertAuthorizedPost(request);
      const credentials = await readCredentials(request);
      await fillDiscordLogin(credentials);
      credentials.account = "";
      credentials.password = "";

      sendJson(response, 200, {
        ok: true,
        message: "Discord 登录页已打开，账户和密码已自动填入，但尚未提交。"
      });
      return;
    }

    if (request.method === "POST" && request.url === "/passkey") {
      assertAuthorizedPost(request);
      await openDiscordPasskey();
      sendJson(response, 200, {
        ok: true,
        message: "Chrome 已打开 Discord 通行密钥验证，请在系统窗口中使用 Touch ID、设备密码或其他通行密钥。"
      });
      return;
    }

    sendJson(response, 404, {
      error: "Not found"
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "操作失败"
    });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Discord Playwright 凭据输入页：http://${HOST}:${PORT}`);
    console.log("账户和密码仅用于当前非持久浏览器会话，不会写入项目目录。");
  });
}

async function fillDiscordLogin(credentials) {
  const context = await launchDiscordChrome({ persistent: false });

  try {
    const page = await context.newPage();
    await openDiscordLogin(page);

    const accountInput = page.locator(
      'input[name="email"], input[type="email"], input[autocomplete*="username"]'
    ).first();
    const passwordInput = page.locator(
      'input[name="password"], input[type="password"], input[autocomplete="current-password"]'
    ).first();

    await accountInput.waitFor({
      state: "visible",
      timeout: 60_000
    });
    await passwordInput.waitFor({
      state: "visible",
      timeout: 60_000
    });

    await accountInput.fill(credentials.account);
    await passwordInput.fill(credentials.password);
    await page.bringToFront();
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function openDiscordPasskey() {
  const context = await launchDiscordChrome({ persistent: true });

  try {
    const page = await context.newPage();
    await openDiscordLogin(page);

    const support = await page.evaluate(async () => ({
      publicKeyCredential: typeof PublicKeyCredential !== "undefined",
      platformAuthenticator:
        typeof PublicKeyCredential !== "undefined" &&
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
          ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          : false
    }));

    if (!support.publicKeyCredential || !support.platformAuthenticator) {
      throw new Error("当前 Chrome 或 macOS 没有可用的通行密钥验证器");
    }

    const passkeyButton = page.getByText(
      /使用通行密钥登入|使用通行密钥登录|Use a passkey/i
    ).first();
    await passkeyButton.waitFor({
      state: "visible",
      timeout: 60_000
    });
    await page.bringToFront();
    const clickPromise = passkeyButton.click({
      timeout: 0
    }).catch(() => {});

    await Promise.race([
      clickPromise,
      page.waitForTimeout(1_500)
    ]);
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function launchDiscordChrome({ persistent }) {
  if (activeContext) {
    await activeContext.close().catch(() => {});
    activeContext = null;
  }
  if (activeBrowser) {
    await activeBrowser.close().catch(() => {});
    activeBrowser = null;
  }

  let context;
  if (persistent) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(PROFILE_DIR, 0o700);
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome",
      headless: false,
      slowMo: 100,
      viewport: null
    });
  } else {
    activeBrowser = await chromium.launch({
      channel: "chrome",
      headless: false,
      slowMo: 100
    });
    context = await activeBrowser.newContext({ viewport: null });
  }
  activeContext = context;
  context.on("close", () => {
    if (activeContext === context) {
      activeContext = null;
    }
    if (!persistent && activeBrowser) {
      activeBrowser.close().catch(() => {});
      activeBrowser = null;
    }
  });
  return context;
}

function assertAuthorizedPost(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("请求必须使用 application/json");
    error.statusCode = 415;
    throw error;
  }

  const origin = request.headers.origin;
  if (origin) {
    let hostname = "";
    try {
      hostname = new URL(origin).hostname;
    } catch {
      const error = new Error("请求来源无效");
      error.statusCode = 403;
      throw error;
    }
    if (hostname !== HOST && hostname !== "localhost") {
      const error = new Error("拒绝跨站请求");
      error.statusCode = 403;
      throw error;
    }
  }

  const supplied = Buffer.from(String(request.headers["x-anna-form-token"] || ""));
  const expected = Buffer.from(FORM_TOKEN);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    const error = new Error("表单会话已失效，请刷新页面");
    error.statusCode = 403;
    throw error;
  }
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
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await page.waitForTimeout(3_000);
      }
    }
  }

  throw lastError;
}

async function readCredentials(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) {
      const error = new Error("请求内容过大");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求格式无效");
    error.statusCode = 400;
    throw error;
  }

  const account = typeof body.account === "string" ? body.account.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!account || !password) {
    const error = new Error("请填写账户和密码");
    error.statusCode = 400;
    throw error;
  }

  if (account.length > 320 || password.length > 1024) {
    const error = new Error("账户或密码长度超出限制");
    error.statusCode = 400;
    throw error;
  }

  return {
    account,
    password
  };
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(html);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function loginForm(formToken) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Discord Playwright 登录助手</title>
    <style>
      :root {
        color-scheme: dark;
        --accent: #5865f2;
        --paper: #1e1f22;
        --field: #111214;
        --text: #f2f3f5;
        --muted: #b5bac1;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #313338;
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      }
      main {
        width: min(460px, calc(100vw - 32px));
        padding: 32px;
        border-radius: 12px;
        background: var(--paper);
        box-shadow: 0 18px 55px rgba(0, 0, 0, 0.34);
      }
      h1 { margin: 0 0 8px; font-size: 25px; }
      .intro, #status {
        color: var(--muted);
        line-height: 1.6;
      }
      form { display: grid; gap: 18px; margin-top: 24px; }
      label {
        display: grid;
        gap: 8px;
        color: var(--muted);
        font-size: 13px;
        font-weight: 700;
      }
      input {
        width: 100%;
        min-height: 46px;
        padding: 10px 12px;
        border: 1px solid transparent;
        border-radius: 5px;
        outline: none;
        background: var(--field);
        color: var(--text);
        font: inherit;
      }
      input:focus { border-color: var(--accent); }
      button {
        min-height: 46px;
        border: 0;
        border-radius: 5px;
        background: var(--accent);
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
      }
      button.secondary {
        border: 1px solid #4e5058;
        background: transparent;
        color: var(--text);
      }
      button:disabled { cursor: wait; opacity: 0.65; }
      #status { min-height: 26px; margin: 18px 0 0; }
      .privacy { margin-top: 18px; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Discord 登录自动填写</h1>
      <p class="intro">填写下面两项后，Playwright 将打开 Discord 官方登录页并自动输入。不会自动点击登录。</p>
      <form id="credentials">
        <label>
          账户、邮箱或手机号
          <input id="account" name="account" type="text" autocomplete="username" required>
        </label>
        <label>
          密码
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </label>
        <button id="run" type="submit">打开 Discord 并自动填写</button>
        <button class="secondary" id="passkey" type="button">使用通行密钥登录</button>
      </form>
      <p id="status" role="status"></p>
      <p class="intro privacy">本页面仅在本机 127.0.0.1 运行。凭据只在内存中使用，填写成功后表单会立即清空。</p>
    </main>
    <script>
      const form = document.getElementById("credentials");
      const account = document.getElementById("account");
      const password = document.getElementById("password");
      const button = document.getElementById("run");
      const passkeyButton = document.getElementById("passkey");
      const status = document.getElementById("status");
      const formToken = ${JSON.stringify(formToken)};

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        button.disabled = true;
        passkeyButton.disabled = true;
        status.textContent = "正在打开 Discord 登录页...";

        try {
          const body = await postJson("/run", {
            account: account.value,
            password: password.value
          });

          form.reset();
          status.textContent = body.message;
        } catch (error) {
          status.textContent = error.message;
        } finally {
          button.disabled = false;
          passkeyButton.disabled = false;
        }
      });

      passkeyButton.addEventListener("click", async () => {
        button.disabled = true;
        passkeyButton.disabled = true;
        status.textContent = "正在打开系统 Chrome 通行密钥验证...";

        try {
          const body = await postJson("/passkey", {});
          status.textContent = body.message;
        } catch (error) {
          status.textContent = error.message;
        } finally {
          button.disabled = false;
          passkeyButton.disabled = false;
        }
      });

      async function postJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Anna-Form-Token": formToken
          },
          body: JSON.stringify(body)
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "操作失败");
        }
        return payload;
      }
    </script>
  </body>
</html>`;
}

module.exports = {
  server,
  loginForm
};
