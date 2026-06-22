const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const roots = ["src", "server", "scripts", "tests"];
const files = [];

for (const root of roots) {
  collect(root, files);
}

for (const file of files.filter((item) => item.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log(`Syntax OK (${files.filter((item) => item.endsWith(".js")).length} files)`);

function collect(dir, output) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collect(fullPath, output);
    } else {
      output.push(fullPath);
    }
  }
}
