require("./env");
const { initDb, seedIfEmpty } = require("./db");

(async () => {
  await initDb();
  seedIfEmpty();
  console.log("Seed completed");
})();
