import { createApp } from "./app.js";

const port = Number(process.env.CONTROLLED_API_PORT ?? process.env.PORT ?? 4318);
const app = createApp();

app.listen(port, () => {
  console.log(`Anna controlled API listening on http://127.0.0.1:${port}`);
});
