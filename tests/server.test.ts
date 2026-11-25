import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceError } from "../src/company/http.js";
import {
  _deps,
  companyResearch,
  createServer,
  job104JobDetail,
  job104Search,
  parseResumePdf,
  youratorJobDetail,
  youratorSearch,
} from "../src/server.js";
import { installFakeBrowser, installOfflineCodes, loadFixture, resetJob104State } from "./job104/helpers.js";
import { FakeHTTP, FakeResponse as YouratorFakeResponse, loadYouratorFixture, loadYouratorJson, resetYouratorState } from "./yourator/helpers.js";

describe("mcp server", () => {
  const originalTavilyKey = process.env.TAVILY_API_KEY;

  beforeEach(() => {
    resetJob104State();
    resetYouratorState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalTavilyKey === undefined) {
      delete process.env.TAVILY_API_KEY;
    } else {
      process.env.TAVILY_API_KEY = originalTavilyKey;
    }
  });

  async function listRegisteredTools() {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.listTools();
      return result.tools;
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  }

  it("test_tools_registered", async () => {
    const tools = await listRegisteredTools();
    expect(tools).toHaveLength(6);
    expect(new Set(tools.map((t) => t.name))).toEqual(
      new Set([
        "job104_search",
        "job104_job_detail",
        "yourator_search",
        "yourator_job_detail",
        "company_research",
        "parse_resume_pdf",
      ]),
    );
    expect(tools.map((t) => t.name)).not.toContain("analyze_job_fit");
  });

  it("test_yourator_tools_descriptions_and_schemas", async () => {
    const tools = await listRegisteredTools();
    const ys = tools.find((t) => t.name === "yourator_search");
    const yd = tools.find((t) => t.name === "yourator_job_detail");
    expect(ys).toBeDefined();
    expect(yd).toBeDefined();

    const ysDesc = ys?.description ?? "";
    expect(ysDesc).toContain("站方");
    expect(ysDesc).toContain("區間重疊");
    expect(ysDesc).toContain("面議");

    const ydDesc = yd?.description ?? "";
    expect(ydDesc).toContain("company_legal_name");
    expect(ydDesc).toContain("company_research");

    const props = (ys?.inputSchema as { properties?: Record<string, Record<string, unknown>> })
      ?.properties ?? {};
    const extractEnums = (p: Record<string, unknown> | undefined): unknown[] | undefined => {
      if (!p) return undefined;
      if (Array.isArray(p.enum)) return p.enum;
      if (Array.isArray(p.anyOf)) {
        for (const sub of p.anyOf as Array<Record<string, unknown>>) {
          if (Array.isArray(sub.enum)) return sub.enum;
        }
      }
      return undefined;
    };
    expect(extractEnums(props.remote)).toEqual(["full", "partial", "any"]);
    expect(extractEnums(props.job_type)).toEqual([
      "full_time",
      "part_time",
      "contract",
      "temporary",
      "intern",
    ]);
    expect(extractEnums(props.order)).toEqual(["relevance", "newest"]);
    expect(extractEnums(props.salary_type)).toEqual(["monthly", "yearly"]);
  });

  it("test_job104_search_description_mentions_split_remote_search", async () => {
    const tools = await listRegisteredTools();
    const tool = tools.find((t) => t.name === "job104_search");
    expect(tool).toBeDefined();
    const d = tool?.description ?? "";
    expect(d).toContain("areas");
    expect(d).toContain("remote");
    expect(d).toContain("分開搜尋");
    expect(d).toContain("不帶 areas");
    expect(d).toContain("job_code");
  });

  it("test_company_research_description_mentions_limits", async () => {
    const tools = await listRegisteredTools();
    const tool = tools.find((t) => t.name === "company_research");
    expect(tool).toBeDefined();
    const d = tool?.description ?? "";
    expect(d).toContain("第三方");
    expect(d).toContain("review_limit");
    expect(d).toContain("include_reviews");
    expect(d).toContain("統編");
  });

  it("test_company_research_invalid_input_is_structured_error", async () => {
    const out1 = await companyResearch({ company: "   " });
    expect((out1 as { error: { type: string } }).error.type).toBe("invalid_input");

    const out2 = await companyResearch({ company: "22099131", review_limit: 0 });
    expect((out2 as { error: { type: string } }).error.type).toBe("invalid_input");
  });

  it("test_company_research_passes_options_and_env_key", async () => {
    const spy = vi.spyOn(_deps, "researchRun").mockResolvedValue({ ok: true } as never);
    process.env.TAVILY_API_KEY = "tvly-env";

    const out = await companyResearch({
      company: "台積電",
      include_reviews: false,
      review_limit: 5,
    });
    expect(out).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith("台積電", {
      includeReviews: false,
      reviewLimit: 5,
      tavilyKey: "tvly-env",
    });
  });

  it.each(["", "   ", "${user_config.tavily_api_key}", "${TAVILY_API_KEY}"])(
    "test_unusable_env_key_becomes_none: %j",
    async (raw) => {
      const spy = vi.spyOn(_deps, "researchRun").mockResolvedValue({} as never);
      process.env.TAVILY_API_KEY = raw;
      await companyResearch({ company: "22099131" });
      expect(spy).toHaveBeenCalledWith("22099131", {
        includeReviews: true,
        reviewLimit: 20,
        tavilyKey: null,
      });
    },
  );

  it("test_env_key_is_stripped", async () => {
    const spy = vi.spyOn(_deps, "researchRun").mockResolvedValue({} as never);
    process.env.TAVILY_API_KEY = "  tvly-x  ";
    await companyResearch({ company: "22099131" });
    expect(spy).toHaveBeenCalledWith("22099131", {
      includeReviews: true,
      reviewLimit: 20,
      tavilyKey: "tvly-x",
    });
  });

  it("test_company_research_without_env_key", async () => {
    const spy = vi.spyOn(_deps, "researchRun").mockResolvedValue({} as never);
    delete process.env.TAVILY_API_KEY;
    await companyResearch({ company: "22099131" });
    expect(spy).toHaveBeenCalledWith("22099131", {
      includeReviews: true,
      reviewLimit: 20,
      tavilyKey: null,
    });
  });

  it("test_blocked_returns_structured_error", async () => {
    installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: "https://www.104.com.tw/job/ajax/content/8u9za",
          status: 403,
          body: "<html>",
        });
      },
    });
    const out = (await job104JobDetail({ job: "8u9za" })) as {
      error: { type: string; message: string };
    };
    expect(out.error.type).toBe("blocked");
    expect(out.error.message).toContain("403");
  });

  it("test_invalid_input_returns_structured_error", async () => {
    const out = (await job104Search({
      keyword: "x",
      remote: "hybrid" as unknown as "full",
    })) as { error: { type: string; message: string } };
    expect(out.error.type).toBe("invalid_input");
    expect(out.error.message).toContain("full, partial, any");
  });

  it("test_search_ok", async () => {
    installOfflineCodes();
    installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: "https://www.104.com.tw/jobs/search/api/jobs?keyword=python",
          jsonData: loadFixture("search.json"),
        });
      },
    });
    const out = (await job104Search({ keyword: "python" })) as Record<string, unknown>;
    expect(out.total).toBe(1001);
    expect("error" in out).toBe(false);
  });

  it("test_source_error_returns_structured_error", async () => {
    vi.spyOn(_deps, "researchRun").mockRejectedValue(new SourceError("network", "連線失敗"));
    const out = (await companyResearch({ company: "22099131" })) as {
      error: { type: string; message: string };
    };
    expect(out.error).toEqual({ type: "network", message: "連線失敗" });
  });

  it("test_missing_resume_pdf_returns_not_found_error", async () => {
    const missing = path.resolve("non_existent_resume_for_test.pdf");
    const out = (await parseResumePdf({ pdf_path: missing })) as {
      error: { type: string; message: string };
    };
    expect(out.error.type).toBe("not_found");
    expect(out.error.message).toContain("找不到履歷檔案");
  });

  it("test_mcp_call_tool_returns_structured_content_and_validates_enum", async () => {
    installOfflineCodes();
    installFakeBrowser({
      onGoto: async (_url, page) => {
        page.emitResponse({
          url: "https://www.104.com.tw/jobs/search/api/jobs?keyword=python",
          jsonData: loadFixture("search.json"),
        });
      },
    });
    const server = createServer();
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const okRes = await client.callTool({
        name: "job104_search",
        arguments: { keyword: "python" },
      });
      expect(okRes.isError).not.toBe(true);
      expect(okRes.structuredContent).toBeDefined();
      expect((okRes.structuredContent as { total: number }).total).toBe(1001);
      const okContent = okRes.content as Array<{ type: string; text?: string }>;
      const textBlock = okContent.find((c) => c.type === "text") as { type: "text"; text: string };
      expect(JSON.parse(textBlock.text).total).toBe(1001);

      const badRes = await client.callTool({
        name: "job104_search",
        arguments: { keyword: "x", remote: "hybrid" },
      });
      expect(badRes.isError).toBe(true);
      const badContent = badRes.content as Array<{ type: string; text?: string }>;
      const errText = (badContent.find((c) => c.type === "text") as { text: string }).text;
      expect(errText).toContain("full");
      expect(errText).toContain("partial");
      expect(errText).toContain("any");

      const badYouratorRes = await client.callTool({
        name: "yourator_search",
        arguments: { keyword: "x", remote: "hybrid" },
      });
      expect(badYouratorRes.isError).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("test_yourator_search_and_detail_handlers", async () => {
    const fh = new FakeHTTP();
    fh.add("/api/v4/jobs", new YouratorFakeResponse({ jsonData: loadYouratorJson("list_keyword.json") }));
    fh.add(
      "/companies/ridefair/jobs/47902",
      new YouratorFakeResponse({ body: loadYouratorFixture("detail_ordinary.html") }),
    );
    fh.install();

    const searchOut = (await youratorSearch({ keyword: "python" })) as {
      page: number;
      has_more: boolean;
      jobs: Array<{ job_code: string }>;
    };
    expect(searchOut.page).toBe(1);
    expect(searchOut.has_more).toBe(true);
    expect(searchOut.jobs.length).toBe(20);

    const detailOut = (await youratorJobDetail({
      job: "https://www.yourator.co/companies/ridefair/jobs/47902",
    })) as { status: string; company_legal_name: string };
    expect(detailOut.status).toBe("ok");
    expect(detailOut.company_legal_name).toBe("睿德菲爾有限公司");

    const badOut = (await youratorJobDetail({ job: "https://evil.com/jobs/1" })) as {
      error: { type: string };
    };
    expect(badOut.error.type).toBe("invalid_input");
  });
});
