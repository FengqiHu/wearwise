import dns from "node:dns";
import { createApp } from "./src/app.js";
import { env } from "./src/config/env.js";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const app = createApp();

const PORT = process.env.PORT || env.port || 8080;

// 🔥 核心修改：必须加上 "0.0.0.0"，允许外部网关访问
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});