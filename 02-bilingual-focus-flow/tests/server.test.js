import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { server } from "../server.js";

test("preview server blocks static-file symlink escapes", async (t) => {
  const bundle = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bundle");
  const outside = path.join(os.tmpdir(), `focus-preview-${process.pid}.txt`);
  const link = path.join(bundle, `leak-${process.pid}.txt`);
  fs.writeFileSync(outside, "private");
  fs.symlinkSync(outside, link);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { force: true });
  });

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/${path.basename(link)}`
  );
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
