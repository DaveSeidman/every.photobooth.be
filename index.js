import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { attachRealtimeServer } from "./realtime.js";

const server = createServer(createApp());
attachRealtimeServer(server, { allowedOrigins: config.allowedOrigins });

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Every photobooth backend listening on http://localhost:${config.port}`);
});
