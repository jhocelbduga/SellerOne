import { InventoryStore } from "./store.js";
import { createInventoryServer } from "./server.js";

const service = "inventory";
const port = Number(process.env.PORT ?? 3001);
const databasePath = process.env.INVENTORY_DB_PATH ?? ".data/inventory.sqlite";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be an integer between 1 and 65535; received "${process.env.PORT}".`);
}

const store = new InventoryStore(databasePath);
const server = createInventoryServer(store);

server.on("error", (error) => {
  console.error(`${service} service failed to start:`, error);
  process.exitCode = 1;
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${service} service listening on port ${port}`);
});

function shutdown(): void {
  server.close((error) => {
    if (error) {
      console.error(`${service} service failed to shut down cleanly:`, error);
      process.exitCode = 1;
    }
    store.close();
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown);
}
