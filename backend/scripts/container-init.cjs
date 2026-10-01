const { spawnSync } = require("node:child_process");
for (const args of [
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["dist-prisma/seed.js"],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
