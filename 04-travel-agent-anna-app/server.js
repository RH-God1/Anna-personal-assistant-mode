import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle");
const port = Number(process.env.PORT || 8804);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const file = safeStaticFile(pathname);
  if (!file) {
    response.writeHead(404, securityHeaders("text/plain; charset=utf-8")).end("Not found");
    return;
  }
  response.writeHead(200, securityHeaders(
    types[path.extname(file)] || "application/octet-stream"
  ));
  fs.createReadStream(file).pipe(response);
});

function safeStaticFile(pathname) {
  let relative;
  try {
    relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()) {
    return null;
  }
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  return realFile.startsWith(`${realRoot}${path.sep}`) ? realFile : null;
}

function securityHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; object-src 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Private Travel Agent Anna App: http://127.0.0.1:${port}`);
  });
}

export { server };
