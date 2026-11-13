from types import SimpleNamespace

import pypdf
import pytest

from tw_job_hunter.resume import parser


def _fake_reader(monkeypatch, pages_text: list[str]):
    pages = [SimpleNamespace(extract_text=lambda t=txt: t) for txt in pages_text]
    monkeypatch.setattr(pypdf, "PdfReader", lambda path: SimpleNamespace(pages=pages))


def test_file_not_found_raises_filenotfounderror():
    with pytest.raises(FileNotFoundError):
        parser.extract_resume_pdf("non_existent_file.pdf")


def test_extract_resume_pdf_normalizes_kangxi_and_splits_sections(tmp_path, monkeypatch):
    pdf_file = tmp_path / "sample.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 dummy")
    _fake_reader(
        monkeypatch,
        [
            "個⼈資料 王小明\n工作經歷\n•  後端⼯程師  2022/1~2025/1\n- 使用 Python 與 FastAPI 開發訂單服務",
            "專業技能\n▪ Python, PostgreSQL, Docker\n學歷\n國立示範大學 資訊工程學系 學士",
        ],
    )

    result = parser.extract_resume_pdf(pdf_file)
    assert result["status"] == "ok"
    assert result["page_count"] == 2
    assert len(result["pages"]) == 2
    assert "個人資料" in result["text"]
    assert "後端工程師" in result["text"]
    assert "⼈" not in result["text"] and "⼇" not in result["text"]
    assert "• 後端工程師" in result["text"]
    assert "• 使用 Python 與 FastAPI 開發訂單服務" in result["text"]

    sections = result["sections"]
    assert "experience" in sections
    assert "skills" in sections
    assert "education" in sections


def test_empty_or_scanned_pdf_warning(tmp_path):
    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=100, height=100)
    blank_pdf = tmp_path / "blank.pdf"
    with open(blank_pdf, "wb") as f:
        writer.write(f)

    result = parser.extract_resume_pdf(str(blank_pdf))
    assert result["status"] == "warning"
    assert "掃描檔" in result["message"] or "圖片" in result["message"]
