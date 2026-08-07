import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";

dotenv.config();

// Vite only serves the frontend. Wire up /api/* locally so sort works
// without needing `npx vercel dev`.
function apiDevPlugin() {
  return {
    name: "api-dev",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/sort")) return next();

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const { default: handler } = await import("./api/sort.js");
            const vercelReq = {
              method: req.method,
              headers: req.headers,
              body: JSON.parse(body || "{}"),
            };
            const vercelRes = {
              statusCode: 200,
              status(code) {
                this.statusCode = code;
                return this;
              },
              json(data) {
                res.statusCode = this.statusCode;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(data));
              },
            };
            await handler(vercelReq, vercelRes);
            if (res.writableEnded === false) {
              console.error("[api/sort] handler did not send a response");
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Internal server error" }));
            }
          } catch (err) {
            console.error("[api/sort]", err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDevPlugin()],
});
