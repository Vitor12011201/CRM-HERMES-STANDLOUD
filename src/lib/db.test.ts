import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adapterConstructors: vi.fn(),
  clientConstructors: vi.fn(),
  env: { DB: { name: "test-d1-binding" } },
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

vi.mock("@prisma/adapter-d1", () => ({
  PrismaD1: class {
    constructor(binding: unknown) {
      mocks.adapterConstructors(binding);
    }
  },
}));

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      mocks.clientConstructors(options);
    }
  },
}));

import * as dbModule from "./db";

describe("request-scoped Prisma/D1 factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a factory instead of a module-scoped database client", () => {
    expect(dbModule.getDb).toEqual(expect.any(Function));
    expect("db" in dbModule).toBe(false);
  });

  it("creates distinct adapter and client instances for independent invocations", () => {
    const first = dbModule.getDb();
    const second = dbModule.getDb();

    expect(first).not.toBe(second);
    expect(mocks.adapterConstructors).toHaveBeenCalledTimes(2);
    expect(mocks.adapterConstructors).toHaveBeenNthCalledWith(1, mocks.env.DB);
    expect(mocks.adapterConstructors).toHaveBeenNthCalledWith(2, mocks.env.DB);
    expect(mocks.clientConstructors).toHaveBeenCalledTimes(2);

    const firstOptions = mocks.clientConstructors.mock.calls[0]?.[0] as { adapter: unknown };
    const secondOptions = mocks.clientConstructors.mock.calls[1]?.[0] as { adapter: unknown };
    expect(firstOptions.adapter).not.toBe(secondOptions.adapter);
  });
});
