import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { startOrderExpiryJob } from "./lib/order-expiry.js";

const app = buildApp();
startOrderExpiryJob(app.log);
await app.listen({ port: env.PORT, host: env.HOST });
