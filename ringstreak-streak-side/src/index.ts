import express from "express";
import { env } from "./env.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.send("ALL GOOD"));

const port = Number(env.PORT || 8081);
app.listen(port, () =>
  console.log(`Streak side listening on ${env.APP_BASE_URL} (env: ${env.NODE_ENV})`)
);
