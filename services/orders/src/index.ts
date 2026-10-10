import { createServer } from "node:http";

const service = "orders";
const port = Number(process.env.PORT ?? 3002);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be an integer between 1 and 65535; received "${process.env.PORT}".`);
}

const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");

  if (request.url === "/health") {
    response.writeHead(200);
    response.end(JSON.stringify({ status: "ok", service }));
    return;
  }

  if (request.url === "/") {
    response.writeHead(200);
    response.end(JSON.stringify({ service, status: "running" }));
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({ error: "Not found" }));
});

server.on("error", (error) => {
  console.error(`${service} service failed to start:`, error);
  process.exitCode = 1;
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${service} service listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        console.error(`${service} service failed to shut down cleanly:`, error);
        process.exitCode = 1;
      }
    });
  });
}
