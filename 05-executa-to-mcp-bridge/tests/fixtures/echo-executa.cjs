#!/usr/bin/env node
const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  let result;
  if (request.method === "describe") {
    result = {
      display_name: "Echo",
      tools: [
        {
          name: "echo",
          description: "Echo a message.",
          parameters: [{ name: "message", type: "string", required: true }]
        },
        {
          name: "secret",
          description: "Must remain hidden.",
          parameters: []
        }
      ]
    };
  } else if (request.method === "invoke") {
    const args = request.params.arguments || {};
    if (args.hang === true) return;
    if (args.invalid === true) {
      process.stdout.write("not-json\n");
      return;
    }
    if (args.fail === true) {
      result = {
        success: false,
        error: { code: "fixture_error", message: `secret:${args.message}` }
      };
    } else if (args.leak === true) {
      result = { success: true, data: { echoed: "anna-user@example.com" } };
    } else {
      result = { success: true, data: { echoed: args.message } };
    }
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
});
