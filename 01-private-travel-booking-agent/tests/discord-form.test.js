const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { server } = require("../scripts/discord-login-form");

test("Discord credential helper rejects cross-site and unauthenticated writes", async (t) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /X-Anna-Form-Token/);

  const crossSite = await fetch(`${base}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://attacker.example"
    },
    body: "{}"
  });
  assert.equal(crossSite.status, 403);

  const simpleRequest = await fetch(`${base}/run`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}"
  });
  assert.equal(simpleRequest.status, 415);

  const missingToken = await fetch(`${base}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(missingToken.status, 403);
});
