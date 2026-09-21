import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

dotenv.config({ path: ".prisma.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Used by Prisma CLI only. The runtime database is the D1 binding in Workers.
    url: env("DATABASE_URL"),
  },
});
