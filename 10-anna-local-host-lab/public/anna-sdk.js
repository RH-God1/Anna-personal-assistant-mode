export class HostApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "HostApiError";
    this.code = code;
    this.status = status;
  }
}

async function rpc(namespace, method, args = {}) {
  const context = window.__ANNA_HOST_CONTEXT__;
  if (!context?.token) throw new HostApiError("not_connected", "Anna host context missing.", 401);
  const response = await fetch("/api/runtime/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anna-App-Token": context.token
    },
    body: JSON.stringify({ namespace, method, args })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new HostApiError(
      payload.error?.code || "host_error",
      payload.error?.message || `Host RPC failed with ${response.status}`,
      response.status
    );
  }
  return payload.result;
}

function namespace(name, methods) {
  return Object.fromEntries(methods.map((method) => [
    method,
    (args = {}) => rpc(name, method, args)
  ]));
}

function windowNamespace() {
  return {
    async set_title(args = {}) {
      const result = await rpc("window", "set_title", args);
      window.parent.postMessage(
        { type: "anna:title", title: result.title || args.title || "" },
        location.origin
      );
      return result;
    },
    close: (args = {}) => rpc("window", "close", args),
    focus: (args = {}) => rpc("window", "focus", args),
    resize: (args = {}) => rpc("window", "resize", args)
  };
}

export class AnnaAppRuntime {
  static async connect() {
    const context = window.__ANNA_HOST_CONTEXT__;
    if (!context?.token) throw new HostApiError("not_connected", "Anna host context missing.", 401);
    return {
      context: Object.freeze({
        appSlug: context.appSlug,
        windowId: context.windowId,
        privacyMode: context.privacyMode
      }),
      tools: namespace("tools", ["invoke"]),
      chat: namespace("chat", ["write_message", "read_history", "append_artifact"]),
      storage: namespace("storage", ["get", "set", "delete", "list"]),
      window: windowNamespace(),
      llm: namespace("llm", ["complete"]),
      agent: { session: namespace("agent.session", ["create", "run", "cancel", "history", "delete"]) }
    };
  }
}
