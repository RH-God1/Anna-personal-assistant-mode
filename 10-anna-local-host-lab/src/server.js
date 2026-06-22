import { fileURLToPath } from "node:url";
import { createLocalAnnaHost } from "./host.js";

const host = createLocalAnnaHost();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8810);
  const url = await host.listen(port);
  console.log(`Anna Local Host Lab: ${url}`);

  const shutdown = async () => {
    await host.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { host };
