import dns from "node:dns";
import { createApp } from "./src/app.js";
import { env } from "./src/config/env.js";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const app = createApp();

const PORT = Number.parseInt(process.env.PORT ?? "", 10) || env.port || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
