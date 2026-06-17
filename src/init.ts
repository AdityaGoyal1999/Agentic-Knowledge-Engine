import "dotenv/config";
import { prisma } from "./lib/db.js";
import { initLanceDB } from "./lib/lancedb.js";

await prisma.$connect();
await initLanceDB();
console.error("AKE foundation ready.");
await prisma.$disconnect();
