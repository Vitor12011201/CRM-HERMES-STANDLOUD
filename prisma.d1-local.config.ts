import { listLocalDatabases } from "@prisma/adapter-d1";
import { defineConfig } from "prisma/config";

const localDatabase = listLocalDatabases().find((file) => !file.endsWith("metadata.sqlite"));

if (!localDatabase) {
  throw new Error("D1 local não encontrado. Execute npm run db:local:migrate antes de gerar uma migration incremental.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: `file:${localDatabase}`,
  },
});
