"""PaperLens API: layout-preserving PDF translation and reading history."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pymupdf as fitz
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
DATA = Path(os.getenv("PAPERLENS_DATA_DIR", ROOT / "data")).resolve()
DATA.mkdir(parents=True, exist_ok=True)
DB = DATA / "library.sqlite3"
FONT_FILE = Path(os.getenv("PAPERLENS_FONT", "/usr/share/fonts/sarasa-gothic/Sarasa-Regular.ttc"))
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
MAX_PDF_BYTES = 80 * 1024 * 1024
executor = ThreadPoolExecutor(max_workers=2)
db_lock = threading.Lock()


def connect():
    connection = sqlite3.connect(DB, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


with connect() as db:
    db.execute("""CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, filename TEXT NOT NULL, created_at INTEGER NOT NULL,
        status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
        page_count INTEGER NOT NULL DEFAULT 0, target_language TEXT NOT NULL,
        error TEXT, metadata TEXT NOT NULL DEFAULT '[]'
    )""")


def update(document_id: str, **values):
    with db_lock, connect() as db:
        columns = ", ".join(f"{name} = ?" for name in values)
        db.execute(f"UPDATE documents SET {columns} WHERE id = ?", (*values.values(), document_id))


def record(document_id: str):
    with connect() as db:
        row = db.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    if not row:
        raise HTTPException(404, "文档不存在")
    result = dict(row)
    result["metadata"] = json.loads(result["metadata"])
    return result


def rect_list(rect):
    return [round(float(v), 2) for v in rect]


def union_rects(rectangles):
    if not rectangles:
        return None
    r = fitz.Rect(rectangles[0])
    for candidate in rectangles[1:]:
        r |= fitz.Rect(candidate)
    return rect_list(r)


def extract_page(page, page_number):
    blocks = []
    for block_index, block in enumerate(page.get_text("rawdict")["blocks"]):
        if block.get("type") != 0:
            continue
        stream = []
        sizes = []
        for line_index, line in enumerate(block.get("lines", [])):
            if stream and stream[-1]["char"] not in " -\u00ad":
                stream.append({"char": " ", "rect": None, "line": line_index})
            for span in line.get("spans", []):
                sizes.append(span.get("size", 10))
                for char in span.get("chars", []):
                    stream.append({"char": char["c"], "rect": char["bbox"], "line": line_index})
        raw_text = "".join(part["char"] for part in stream)
        if not raw_text.strip():
            continue
        sentences = []
        # Keep the offsets of individual characters, so highlights follow the PDF's real glyphs.
        starts = [0]
        for match in re.finditer(r"(?<=[.!?。！？])\s+(?=\S)", raw_text):
            starts.append(match.end())
        starts.append(len(raw_text))
        for sentence_index, (start, end) in enumerate(zip(starts, starts[1:])):
            part = raw_text[start:end].strip()
            if not part:
                continue
            per_line = {}
            for item in stream[start:end]:
                if item["rect"] is not None:
                    per_line.setdefault(item["line"], []).append(item["rect"])
            source_rects = [union_rects(boxes) for boxes in per_line.values()]
            sentences.append({
                "id": f"p{page_number}b{block_index}s{sentence_index}",
                "source": part, "translation": "", "source_rects": source_rects,
                "translation_rects": [],
            })
        if not sentences:
            continue
        blocks.append({
            "id": f"p{page_number}b{block_index}", "page": page_number,
            "rect": rect_list(block["bbox"]), "source": raw_text.strip(),
            "translation": "", "font_size": round(sum(sizes) / len(sizes), 2) if sizes else 10,
            "sentences": sentences,
        })
    return blocks


def batches(items, maximum=2200):
    batch, length = [], 0
    for item in items:
        size = len(item["source"])
        if batch and length + size > maximum:
            yield batch
            batch, length = [], 0
        batch.append(item)
        length += size
    if batch:
        yield batch


def _translate_batch_once(batch, language, api_key):
    payload = [{"id": item["id"], "sentences": [s["source"] for s in item["sentences"]]} for item in batch]
    instruction = (
        f"Translate academic writing into {language}. Preserve mathematics, citations, units, "
        "technical terminology, and the original meaning. Input is JSON with paragraphs, "
        "each containing sentence strings. Return ONLY a JSON object with a paragraphs array "
        "of objects with id and sentences. Keep the same IDs, order, and number of sentences; each output sentence "
        "must align with its input sentence. Do not summarize or omit any text."
    )
    response = httpx.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"model": MODEL, "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": json.dumps({"paragraphs": payload}, ensure_ascii=False)},
        ], "temperature": 0, "max_tokens": 12000, "response_format": {"type": "json_object"}},
        timeout=180,
    )
    response.raise_for_status()
    if response.json()["choices"][0]["finish_reason"] == "length":
        raise ValueError("翻译 API 的输出被截断")
    content = response.json()["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    if isinstance(parsed, dict):
        parsed = parsed.get("paragraphs", parsed.get("results", parsed.get("items", [])))
    if not isinstance(parsed, list):
        raise ValueError("翻译 API 返回的 JSON 结构不正确")
    by_id = {item["id"]: item["sentences"] for item in parsed if isinstance(item, dict) and "id" in item}
    unresolved = []
    for block in batch:
        translated = by_id.get(block["id"])
        if not isinstance(translated, list) or len(translated) != len(block["sentences"]) or not all(isinstance(target, str) and target.strip() for target in translated):
            unresolved.append(block)
            continue
        for sentence, target in zip(block["sentences"], translated):
            sentence["translation"] = target.strip()
        block["translation"] = " ".join(s["translation"] for s in block["sentences"])
    return unresolved


def translate_single(sentence, language, api_key):
    instruction = (
        f"Translate this one academic sentence into {language}. Preserve all details, "
        "citations, numbers, and formulas. Return only JSON like "
        '{"translation":"translated sentence"}. Do not summarize.'
    )
    for attempt in range(3):
        try:
            response = httpx.post(
                "https://api.deepseek.com/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": MODEL, "messages": [
                    {"role": "system", "content": instruction},
                    {"role": "user", "content": sentence["source"]},
                ], "temperature": 0, "response_format": {"type": "json_object"}},
                timeout=180,
            )
            response.raise_for_status()
            target = json.loads(response.json()["choices"][0]["message"]["content"])["translation"]
            if not isinstance(target, str) or not target.strip():
                raise ValueError("空译文")
            sentence["translation"] = target.strip()
            return
        except (httpx.HTTPError, ValueError, KeyError, IndexError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def translate_batch(batch, language, api_key):
    remaining = batch
    for attempt in range(2):
        try:
            remaining = _translate_batch_once(remaining, language, api_key)
            if not remaining:
                return
        except (httpx.HTTPError, ValueError, KeyError, IndexError, json.JSONDecodeError):
            pass
        if attempt == 0:
            time.sleep(2 ** attempt)
    for block in remaining:
        unresolved = [block]
        for attempt in range(2):
            try:
                unresolved = _translate_batch_once(unresolved, language, api_key)
                if not unresolved:
                    break
            except (httpx.HTTPError, ValueError, KeyError, IndexError, json.JSONDecodeError):
                pass
            if attempt == 0:
                time.sleep(1)
        if unresolved:
            for sentence in block["sentences"]:
                translate_single(sentence, language, api_key)
            block["translation"] = " ".join(sentence["translation"] for sentence in block["sentences"])


def tokenise(text):
    return re.findall(r"[\u3400-\u9fff]|\s+|[^\u3400-\u9fff\s]+", text)


def font_safe_text(text, font):
    result = []
    for character in text:
        if font.has_glyph(ord(character)):
            result.append(character)
            continue
        candidate = "*" if character == "∗" else unicodedata.normalize("NFKC", character)
        if candidate == character:
            candidate = "".join(char for char in unicodedata.normalize("NFKD", character) if not unicodedata.combining(char))
        result.append(candidate if candidate and all(font.has_glyph(ord(char)) for char in candidate) else "?")
    return "".join(result)


def layout_sentences(block, font, size):
    box = fitz.Rect(block["rect"])
    width = max(1, box.width - 1.5)
    line_height = size * 1.22
    x = box.x0 + 0.75
    baseline = box.y0 + size * 1.03
    lines = []
    for index, sentence in enumerate(block["sentences"]):
        content = font_safe_text(sentence["translation"], font) + (" " if index < len(block["sentences"]) - 1 else "")
        for token in tokenise(content):
            if token.isspace() and x <= box.x0 + 0.76:
                continue
            token_width = font.text_length(token, fontsize=size)
            if x + token_width > box.x0 + width and x > box.x0 + 0.76:
                x = box.x0 + 0.75
                baseline += line_height
                if token.isspace():
                    continue
            if token_width > width:
                for char in token:
                    char_width = font.text_length(char, fontsize=size)
                    if x + char_width > box.x0 + width and x > box.x0 + 0.76:
                        x = box.x0 + 0.75
                        baseline += line_height
                    lines.append((index, char, x, baseline, char_width))
                    x += char_width
            else:
                lines.append((index, token, x, baseline, token_width))
                x += token_width
    return lines, baseline + size * 0.28 <= box.y1 + 0.5


def write_translations(doc, pages):
    font = fitz.Font(fontfile=str(FONT_FILE))
    warnings = []
    for page_number, page in enumerate(doc):
        blocks = pages[page_number]["blocks"]
        editable = []
        for block in blocks:
            if re.sub(r"\s+", "", block["translation"]) == re.sub(r"\s+", "", block["source"]):
                for sentence in block["sentences"]:
                    sentence["translation_rects"] = sentence["source_rects"]
                continue
            editable.append(block)
        for block in editable:
            rect = fitz.Rect(block["rect"]) & page.rect
            if not rect.is_empty:
                page.add_redact_annot(rect, fill=None)
        if editable:
            page.apply_redactions(images=0, graphics=0, text=0)
            page.insert_font(fontname="PaperLensCJK", fontfile=str(FONT_FILE))
        for block in editable:
            original_size = max(6, min(16, block["font_size"]))
            lines, fits = [], False
            size = original_size
            while size >= 4.4:
                lines, fits = layout_sentences(block, font, size)
                if fits:
                    break
                size -= 0.3
            if not fits:
                warnings.append(f"第 {page_number + 1} 页的文本框 {block['id']} 译文过长")
            per_sentence = [[] for _ in block["sentences"]]
            runs = []
            for index, token, x, baseline, width in lines:
                if baseline + size * 0.28 > block["rect"][3] + 0.5:
                    continue
                if runs and runs[-1]["index"] == index and abs(runs[-1]["baseline"] - baseline) < 0.01 and abs(runs[-1]["x"] + runs[-1]["width"] - x) < 0.6:
                    runs[-1]["text"] += token
                    runs[-1]["width"] += width
                else:
                    runs.append({"index": index, "text": token, "x": x, "baseline": baseline, "width": width})
            for run in runs:
                page.insert_text((run["x"], run["baseline"]), run["text"], fontname="PaperLensCJK", fontsize=size, color=(0.12, 0.16, 0.18))
                if run["text"].strip():
                    per_sentence[run["index"]].append([run["x"], run["baseline"] - size, run["x"] + run["width"], run["baseline"] + size * 0.28])
            for sentence, fragments in zip(block["sentences"], per_sentence):
                grouped = {}
                for fragment in fragments:
                    key = round(fragment[1], 1)
                    grouped.setdefault(key, []).append(fragment)
                sentence["translation_rects"] = [union_rects(part) for part in grouped.values()]
    return warnings


def run_translation(document_id, language):
    folder = DATA / document_id
    try:
        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        if not api_key:
            raise ValueError("服务端未设置 DEEPSEEK_API_KEY")
        if not FONT_FILE.is_file():
            raise ValueError(f"缺少中文字体：{FONT_FILE}，请设置 PAPERLENS_FONT")
        source = fitz.open(folder / "original.pdf")
        if source.is_encrypted:
            raise ValueError("暂不支持加密 PDF")
        pages = [{"number": i, "width": page.rect.width, "height": page.rect.height,
                  "blocks": extract_page(page, i)} for i, page in enumerate(source)]
        all_blocks = [block for page in pages for block in page["blocks"]]
        if not all_blocks:
            raise ValueError("PDF 没有可提取文本；扫描版需要先进行 OCR")
        checkpoint = folder / "checkpoint.json"
        if checkpoint.exists():
            saved = json.loads(checkpoint.read_text(encoding="utf-8"))
            for block in all_blocks:
                for sentence in block["sentences"]:
                    target = saved.get(sentence["id"])
                    if isinstance(target, str) and target.strip():
                        sentence["translation"] = target
                if all(sentence["translation"] for sentence in block["sentences"]):
                    block["translation"] = " ".join(sentence["translation"] for sentence in block["sentences"])
        remaining_blocks = [block for block in all_blocks if not block["translation"]]
        completed = len(all_blocks) - len(remaining_blocks)
        update(document_id, page_count=len(pages), progress=5 + int(80 * completed / len(all_blocks)), status="translating", error=None)
        groups = list(batches(remaining_blocks))
        for index, group in enumerate(groups):
            translate_batch(group, language, api_key)
            completed += len(group)
            saved = {sentence["id"]: sentence["translation"] for block in all_blocks for sentence in block["sentences"] if sentence["translation"]}
            temporary = folder / "checkpoint.tmp"
            temporary.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
            temporary.replace(checkpoint)
            update(document_id, progress=5 + int(80 * completed / len(all_blocks)))
        update(document_id, status="typesetting", progress=90)
        warnings = write_translations(source, pages)
        source.save(folder / "translated.pdf", garbage=4, deflate=True)
        source.close()
        metadata = {"pages": pages, "warnings": warnings}
        (folder / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        update(document_id, status="done", progress=100, metadata=json.dumps({"warnings": warnings}, ensure_ascii=False))
    except Exception as exc:
        update(document_id, status="error", error=str(exc)[:500])


app = FastAPI(title="PaperLens API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://localhost", "capacitor://localhost", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "configured": bool(os.getenv("DEEPSEEK_API_KEY")), "model": MODEL}


@app.get("/api/documents")
def list_documents():
    with connect() as db:
        rows = db.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
    return [{**dict(row), "metadata": json.loads(row["metadata"])} for row in rows]


@app.post("/api/documents")
async def upload_document(file: UploadFile = File(...), target_language: str = Form("简体中文")):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "请选择 PDF 文件")
    if not target_language.strip() or len(target_language) > 40:
        raise HTTPException(400, "目标语言无效")
    document_id = uuid.uuid4().hex
    folder = DATA / document_id
    folder.mkdir()
    destination = folder / "original.pdf"
    total = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_PDF_BYTES:
                    raise HTTPException(413, "PDF 超过 80 MB")
                output.write(chunk)
        try:
            with fitz.open(destination) as document:
                if not document.is_pdf or not document.page_count:
                    raise HTTPException(400, "PDF 文件无效")
                page_count = document.page_count
        except fitz.FileDataError as exc:
            raise HTTPException(400, "PDF 文件无效") from exc
    except Exception:
        destination.unlink(missing_ok=True)
        folder.rmdir()
        raise
    with connect() as db:
        db.execute("INSERT INTO documents (id, filename, created_at, status, progress, page_count, target_language) VALUES (?, ?, ?, ?, ?, ?, ?)",
                   (document_id, Path(file.filename).name, int(time.time()), "queued", 0, page_count, target_language.strip()))
    executor.submit(run_translation, document_id, target_language.strip())
    return record(document_id)


@app.get("/api/documents/{document_id}")
def get_document(document_id: str):
    return record(document_id)


@app.post("/api/documents/{document_id}/retry")
def retry_document(document_id: str):
    item = record(document_id)
    if item["status"] != "error":
        raise HTTPException(409, "只有失败的任务可以重试")
    update(document_id, status="queued", error=None)
    executor.submit(run_translation, document_id, item["target_language"])
    return record(document_id)


@app.get("/api/documents/{document_id}/metadata")
def get_metadata(document_id: str):
    item = record(document_id)
    if item["status"] != "done":
        raise HTTPException(409, "翻译尚未完成")
    return json.loads((DATA / document_id / "metadata.json").read_text(encoding="utf-8"))


@app.get("/api/documents/{document_id}/{version}.pdf")
def get_pdf(document_id: str, version: str):
    item = record(document_id)
    if version not in ("original", "translated"):
        raise HTTPException(404)
    if version == "translated" and item["status"] != "done":
        raise HTTPException(409, "翻译尚未完成")
    suffix = "原文" if version == "original" else "译文"
    return FileResponse(DATA / document_id / f"{version}.pdf", media_type="application/pdf",
                        filename=f"{Path(item['filename']).stem}-{suffix}.pdf")


@app.get("/api/documents/{document_id}/pages/{page_number}/{version}.png")
def get_page_image(document_id: str, page_number: int, version: str, scale: float = 1.5):
    item = record(document_id)
    if version not in ("original", "translated") or page_number < 0 or page_number >= item["page_count"]:
        raise HTTPException(404)
    if version == "translated" and item["status"] != "done":
        raise HTTPException(409, "翻译尚未完成")
    scale = min(max(scale, 0.75), 2.5)
    with fitz.open(DATA / document_id / f"{version}.pdf") as document:
        png = document[page_number].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes("png")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


static = ROOT / "dist"
if static.is_dir():
    @app.get("/{full_path:path}")
    def frontend(full_path: str):
        path = (static / full_path).resolve()
        if path.is_file() and path.is_relative_to(static.resolve()):
            return FileResponse(path)
        return FileResponse(static / "index.html")
