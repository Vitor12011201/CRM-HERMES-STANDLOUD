import { describe, expect, it } from "vitest";

import { researchSourceSnapshotSchema } from "./contracts";
import {
  WebsiteAcquisitionError,
  acquireWebsiteSnapshot,
  maxWebsiteRedirects,
  maxWebsiteResponseBytes,
} from "./website-acquisition";

const publicWebsiteUrl = "https://public.example/company";

function htmlResponse(html: string, options?: ResponseInit) {
  return new Response(html, {
    ...options,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(options?.headers ?? {}),
    },
  });
}

async function expectAcquisitionError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("Expected website acquisition to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(WebsiteAcquisitionError);
    expect((error as WebsiteAcquisitionError).code).toBe(code);
  }
}

describe("Website source acquisition", () => {
  it("extracts a schema-valid snapshot with title and visible normalized HTML text", async () => {
    const snapshot = await acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => htmlResponse(`
        <html><head>
          <title>  Standloud &amp; Company  </title>
          <style>.hidden { display: none; }</style>
          <script>ignoreThisInstruction()</script>
        </head><body><!-- invisible comment --><template>not rendered</template>
          Visible <strong>website</strong> text.
          <noscript>not visible</noscript>
        </body></html>
      `),
    });

    expect(snapshot).toEqual({
      sourceType: "WEBSITE",
      sourceUrl: publicWebsiteUrl,
      title: "Standloud & Company",
      content: "Visible website text.",
    });
    expect(researchSourceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.content).not.toContain("ignoreThisInstruction");
    expect(snapshot.content).not.toContain(".hidden");
    expect(snapshot.content).not.toContain("not visible");
    expect(snapshot.content).not.toContain("invisible comment");
    expect(snapshot.content).not.toContain("not rendered");
    expect(snapshot.content).not.toMatch(/\s{2,}/);
  });

  it("accepts http and https public URLs", async () => {
    const protocols: string[] = [];
    const fetchImplementation = async (input: RequestInfo | URL) => {
      protocols.push(new URL(String(input)).protocol);
      return htmlResponse("<p>Public text</p>");
    };

    await acquireWebsiteSnapshot({ url: "http://public.example", fetchImplementation });
    await acquireWebsiteSnapshot({ url: "https://public.example", fetchImplementation });

    expect(protocols).toEqual(["http:", "https:"]);
  });

  it("accepts plain-text websites without interpreting their content", async () => {
    const snapshot = await acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => new Response(" Plain   source\ntext ", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    });

    expect(snapshot).toEqual({
      sourceType: "WEBSITE",
      sourceUrl: publicWebsiteUrl,
      content: "Plain source text",
    });
  });

  it("truncates extracted content deterministically to the snapshot limit", async () => {
    const snapshot = await acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => htmlResponse(`<p>${"a".repeat(8_500)}</p>`),
    });

    expect(snapshot.content).toHaveLength(8_000);
    expect(snapshot.content).toBe("a".repeat(8_000));
  });

  it("rejects invalid, credentialed, local, private, link-local, and metadata URLs before fetch", async () => {
    const rejectedUrls = [
      "ftp://public.example/file",
      "https://user:password@public.example",
      "https://localhost/",
      "http://0.0.0.0/",
      "http://127.0.0.1/",
      "http://127.0.0.2/",
      "http://2130706433/",
      "http://10.0.0.1/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://metadata.google.internal/",
    ];
    let calls = 0;

    for (const url of rejectedUrls) {
      await expectAcquisitionError(acquireWebsiteSnapshot({
        url,
        fetchImplementation: async () => {
          calls += 1;
          return htmlResponse("<p>Must not fetch</p>");
        },
      }), url.startsWith("ftp") || url.includes("user:") ? "INVALID_URL" : "UNSAFE_URL");
    }

    expect(calls).toBe(0);
  });

  it("follows a public redirect manually and preserves the effective URL", async () => {
    const calls: string[] = [];
    const snapshot = await acquireWebsiteSnapshot({
      url: "https://public.example/start",
      fetchImplementation: async (input, init) => {
        calls.push(String(input));
        expect(init?.redirect).toBe("manual");
        if (calls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "/final" },
          });
        }
        return htmlResponse("<p>Redirected page</p>");
      },
    });

    expect(calls).toEqual(["https://public.example/start", "https://public.example/final"]);
    expect(snapshot.sourceUrl).toBe("https://public.example/final");
    expect(snapshot.content).toBe("Redirected page");
  });

  it("rejects redirects to private destinations and redirect loops beyond the explicit limit", async () => {
    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/" },
      }),
    }), "UNSAFE_URL");

    let calls = 0;
    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location: "/loop" } });
      },
    }), "TOO_MANY_REDIRECTS");
    expect(calls).toBe(maxWebsiteRedirects + 1);
  });

  it("times out controlledly and sanitizes network and HTTP failures", async () => {
    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      timeoutMs: 1,
      fetchImplementation: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    }), "TIMEOUT");

    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => {
        throw new Error("network details must not escape");
      },
    }), "NETWORK_ERROR");

    for (const status of [404, 500]) {
      await expectAcquisitionError(acquireWebsiteSnapshot({
        url: publicWebsiteUrl,
        fetchImplementation: async () => htmlResponse("<p>Error page</p>", { status }),
      }), "HTTP_ERROR");
    }
  });

  it("rejects unsupported, oversized, and empty responses", async () => {
    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => new Response("binary", {
        headers: { "content-type": "application/octet-stream" },
      }),
    }), "UNSUPPORTED_CONTENT_TYPE");

    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => htmlResponse("small", {
        headers: {
          "content-length": String(maxWebsiteResponseBytes + 1),
        },
      }),
    }), "RESPONSE_TOO_LARGE");

    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a".repeat(maxWebsiteResponseBytes + 1)));
        controller.close();
      },
    });
    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => new Response(oversizedStream, {
        headers: { "content-type": "text/html" },
      }),
    }), "RESPONSE_TOO_LARGE");

    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => htmlResponse("<html><head><title>Only title</title></head><body><script>ignored</script></body></html>"),
    }), "EMPTY_CONTENT");

    await expectAcquisitionError(acquireWebsiteSnapshot({
      url: publicWebsiteUrl,
      fetchImplementation: async () => htmlResponse(""),
    }), "EMPTY_CONTENT");
  });
});
