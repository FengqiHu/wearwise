import dns from "node:dns";
import { createApp } from "./src/app.js";
import { env } from "./src/config/env.js";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const app = createApp();

app.listen(env.port, () => {
  console.log(`Server running at http://localhost:${env.port}`);
});
