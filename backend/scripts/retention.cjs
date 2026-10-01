const { PrismaClient } = require("@prisma/client");
const days = Number(process.argv[2] ?? 7);
if (!Number.isInteger(days) || days < 1 || days > 365)
  throw new Error("Retention days must be 1-365.");
const db = new PrismaClient();
(async () => {
  const cutoff = new Date(Date.now() - days * 86400000);
  const where = { timestamp: { lt: cutoff } };
  const count = await db.telemetryEvent.count({ where });
  console.log(
    JSON.stringify({
      olderThan: cutoff.toISOString(),
      matchingEvents: count,
      mode: process.argv.includes("--apply") ? "delete" : "preview",
    }),
  );
  if (process.argv.includes("--apply"))
    console.log(
      JSON.stringify({
        deleted: (await db.telemetryEvent.deleteMany({ where })).count,
      }),
    );
})()
  .catch(() => {
    console.error("Retention failed.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
