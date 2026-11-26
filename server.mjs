import { createApp } from "./app.mjs";

const port = Number(process.env.PORT || 3000);
const server = await createApp();

server.listen(port, "127.0.0.1", () => {
  console.log(`Входящие заявки: http://127.0.0.1:${port}`);
});
