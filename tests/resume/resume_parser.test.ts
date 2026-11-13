import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPages: string[] | null = null;

vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  return {
    ...actual,
    extractText: vi.fn(
      async (
        data: Uint8Array,
        options?: { mergePages?: boolean },
      ) => {
        if (mockPages !== null) {
          return {
            totalPages: mockPages.length,
            text: mockPages,
          };
        }
        return actual.extractText(data, options as { mergePages?: false });
      },
    ),
  };
});

import {
  FileNotFoundError,
  extractResumePdf,
} from "../../src/resume/parser.js";

function buildMinimalPdf(pageContents: string[]): Buffer {
  const objects: string[] = [];
  const pageCount = pageContents.length;
  // 1: Catalog, 2: Pages, 3: Font
  const fontObjId = 3;
  const pageObjIds: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageObjIds.push(4 + i * 2);
  }

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (let i = 0; i < pageCount; i++) {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    const stream = pageContents[i];
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    );
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "ascii");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "ascii");
}

describe("resume parser", () => {
  let tmpDir: string;

  beforeEach(async () => {
    mockPages = null;
    tmpDir = await mkdtemp(path.join(tmpdir(), "tw-job-hunter-resume-"));
  });

  afterEach(async () => {
    mockPages = null;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("找不到檔案時拋出 FileNotFoundError", async () => {
    await expect(
      extractResumePdf(path.join(tmpDir, "non_existent_file.pdf")),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("正規化康熙部首、統一項目符號並切分章節", async () => {
    const pdfFile = path.join(tmpDir, "sample.pdf");
    await writeFile(pdfFile, "%PDF-1.4 dummy");
    mockPages = [
      "個⼈資料 王小明\n工作經歷\n•  後端⼯程師  2022/1~2025/1\n- 使用 Python 與 FastAPI 開發訂單服務",
      "專業技能\n▪ Python, PostgreSQL, Docker\n學歷\n國立示範大學 資訊工程學系 學士",
    ];

    const result = await extractResumePdf(pdfFile);
    expect(result.status).toBe("ok");
    expect(result.page_count).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.text).toContain("個人資料");
    expect(result.text).toContain("後端工程師");
    expect(result.text).not.toContain("⼈");
    expect(result.text).not.toContain("⼇");
    expect(result.text).toContain("• 後端工程師");
    expect(result.text).toContain("• 使用 Python 與 FastAPI 開發訂單服務");

    expect(result.sections).toHaveProperty("experience");
    expect(result.sections).toHaveProperty("skills");
    expect(result.sections).toHaveProperty("education");
  });

  it("空白或掃描 PDF 透過真實 unpdf 回傳 warning", async () => {
    const blankPdf = path.join(tmpDir, "blank.pdf");
    await writeFile(blankPdf, buildMinimalPdf([""]));

    const result = await extractResumePdf(blankPdf);
    expect(result.status).toBe("warning");
    expect(result.page_count).toBe(1);
    expect(result.total_characters).toBe(0);
    expect(
      result.message?.includes("掃描檔") || result.message?.includes("圖片"),
    ).toBe(true);
  });

  it("含文字的真實 PDF 透過 unpdf 正確提取並切分章節", async () => {
    const realPdf = path.join(tmpDir, "real_text.pdf");
    const stream =
      "BT /F1 12 Tf 20 160 Td (Work Experience) Tj 0 -20 Td (- Built TypeScript API services and backend systems for 4 years) Tj ET";
    await writeFile(realPdf, buildMinimalPdf([stream]));

    const result = await extractResumePdf(realPdf);
    expect(result.status).toBe("ok");
    expect(result.page_count).toBe(1);
    expect(result.total_characters).toBeGreaterThanOrEqual(50);
    expect(result.text).toContain("• Built TypeScript API services");
    expect(result.sections).toHaveProperty("experience");
  });
});
