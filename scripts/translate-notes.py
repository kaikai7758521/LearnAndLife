#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为中文笔记生成英文版本，并刷新 manifest.en.json。

约定
----
- 中文笔记： 前端/JavaScript/01-变量与类型.md
- 英文译文： en/前端/JavaScript/01-变量与类型.md
- 译文 front matter 中的 translatedFrom 记录中文源文件的 SHA-256，
  源文件变化后会重新翻译；内容未变化时直接跳过。

默认使用免费翻译服务，不需要 API Key：
    auto            优先 Google，失败后回退 MyMemory
    google          Google 翻译的免密钥接口（非官方，可能限流）
    mymemory        MyMemory 免费接口（建议配置 MYMEMORY_EMAIL 提升每日额度）
    libretranslate  自建 / 公共 LibreTranslate 服务
    openai          OpenAI 兼容的 Chat Completions 接口（质量最好，但需要密钥）

环境变量：
    TRANSLATE_PROVIDER       auto / mymemory / google / libretranslate / openai
    TRANSLATE_API_KEY        使用 openai 时必填（也可用 OPENAI_API_KEY）
    TRANSLATE_API_URL        openai 接口地址，默认 https://api.openai.com/v1/chat/completions
    TRANSLATE_MODEL          openai 模型，默认 gpt-4o-mini
    MYMEMORY_EMAIL           MyMemory 可选邮箱，匿名 5000 字符/天，填写后 50000 字符/天
    LIBRETRANSLATE_URL       LibreTranslate 地址，默认 https://libretranslate.com
    LIBRETRANSLATE_API_KEY   LibreTranslate 可选密钥

没有配置密钥时：
- 自动使用免费服务翻译；
- 如果所有服务都失败，已有译文保持不动，缺失译文会给出警告，站点回退中文；
- 加 --strict 可让脚本在翻译失败时以非零状态退出（适合 CI 强制校验）。

用法（在仓库根目录执行）：
    python3 scripts/translate-notes.py
    python3 scripts/translate-notes.py --provider mymemory
    python3 scripts/translate-notes.py --check
    python3 scripts/translate-notes.py --force
    python3 scripts/translate-notes.py --strict
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN_DIR = "en"
EN_MANIFEST = "manifest.en.json"
DIR_LABELS_FILE = "dirs.en.json"

# 已知目录的英文名；未知目录会调用翻译服务自动补充到 dirs.en.json。
DEFAULT_DIR_LABELS = {
    "前端": "Frontend",
    "AI时代技术": "AI Technology",
    "基础概念": "Basic Concepts",
    "技术实践": "Hands-on Practice",
    "电子工程": "Electronic Engineering",
    "常见基本电路": "Common Basic Circuits",
    "电路案例": "Circuit Projects",
    "钓鱼": "Fishing",
    "树算法": "Tree Algorithms",
    "动态规划": "Dynamic Programming",
    "排序算法": "Sorting Algorithms",
    "链表和指针": "Linked Lists and Pointers",
    "JavaScript": "JavaScript",
    "日常生活": "Daily Life",
    "运动": "Sports",
    "后端": "Backend",
    "计算机基础": "Computer Science",
    "编译原理": "Compilers",
    "电子电路": "Electronic Circuits",
    "工程思想": "Engineering Thinking",
    "数据结构": "Data Structures",
    "算法": "Algorithms",
    "网络": "Networking",
    "计算机网络": "Computer Networks",
    "操作系统": "Operating Systems",
    "数据库": "Databases",
    "工程化": "Engineering",
    "工具": "Tooling",
}

# 与 assets/js/config.js、scripts/update-readme.py 保持一致
EXCLUDE_DIRS = {"en", "assets", "scripts", "node_modules", ".github", "_site", ".jekyll-cache"}
EXCLUDE_FILES = {"README.md", "README.en.md", "USAGE.md", "AGENTS.md"}

FRONT_MATTER_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.S)
HEADING_RE = re.compile(r"^\s{0,3}#\s+(.+?)\s*#*\s*$", re.M)
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
TOKEN_RE = re.compile(r"ZXQ[A-Z]+\d+QZX")

OPENAI_DEFAULT_URL = "https://api.openai.com/v1/chat/completions"
MYMEMORY_URL = "https://api.mymemory.translated.net/get"
GOOGLE_ENDPOINTS = (
    ("https://translate.googleapis.com/translate_a/single", {"client": "at", "dt": "t"}),
    ("https://translate.googleapis.com/translate_a/single", {"client": "gtx", "dt": "t"}),
    ("https://clients5.google.com/translate_a/t", {"client": "dict-chrome-ex"}),
)
LIBRETRANSLATE_DEFAULT_URL = "https://libretranslate.com"
USER_AGENT = "Mozilla/5.0 (compatible; LearnAndLife-translate/1.0)"

# 每种服务的单次请求上限（MyMemory 的 q 最大 500 字节，这里留出余量）
PROVIDER_LIMITS = {
    "mymemory": 400,
    "google": 4000,
    "libretranslate": 4000,
}
PROVIDERS = ("auto", "mymemory", "google", "libretranslate", "openai")

FRONT_MATTER_TRANSLATE_KEYS = {"title", "description", "summary"}

SETTINGS = {
    "openai_key": "",
    "openai_url": OPENAI_DEFAULT_URL,
    "model": "gpt-4o-mini",
    "mymemory_email": "",
    "libre_url": LIBRETRANSLATE_DEFAULT_URL,
    "libre_key": "",
}

SYSTEM_PROMPT = """You are a professional technical translator.
Translate the Chinese Markdown study note supplied by the user into natural, accurate English.

Rules:
1. Keep the Markdown structure exactly: front matter, headings, lists, tables, blockquotes, callouts, code fences, math, Mermaid diagrams.
2. Translate natural-language prose, heading text, table cells, alt text and diagram labels.
3. Never translate code, identifiers, command names, URLs, file paths or library names.
4. Keep relative links and images unchanged. The English tree mirrors the Chinese paths under `en/`,
   so leave relative `.md` links as they are.
5. Keep the original front matter keys. Translate `title`, `description` and `tags` values;
   do not add `translatedFrom`, `translatedAt` or `lang` (the script adds them).
6. Return only the translated Markdown document, with no explanation and no surrounding code fence.
"""


class ProviderError(RuntimeError):
    """翻译服务不可用或返回异常，调用方可以回退到下一个服务。"""


class TokenStore:
    """把代码、链接等不该翻译的片段换成占位符，翻译完成后再还原。"""

    def __init__(self) -> None:
        self.items: list[tuple[str, str]] = []

    def add(self, value: str, kind: str) -> str:
        token = f"ZXQ{kind}{len(self.items)}QZX"
        self.items.append((token, value))
        return token

    def restore(self, text: str) -> str:
        # 逆序还原，保证“整行/整块”占位符中包含的早期占位符也能展开。
        for token, value in reversed(self.items):
            text = text.replace(token, value)
        return text


def log(message: str) -> None:
    print(message, flush=True)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


def write_text(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def display_name(filename: str) -> str:
    clean = re.sub(r"\.en\.md$|\.md$", "", filename, flags=re.I)
    stripped = re.sub(r"^\d+[\s._\-、]+", "", clean)
    return stripped or clean


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    text = text.lstrip("\ufeff")
    match = FRONT_MATTER_RE.match(text)
    if not match:
        return {}, text

    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        kv = re.match(r"^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$", line)
        if kv:
            value = kv.group(2).strip().strip('"').strip("'")
            meta[kv.group(1).lower()] = value
    return meta, text[match.end():]


def split_front_matter_raw(text: str) -> tuple[str | None, str]:
    text = text.lstrip("\ufeff")
    match = FRONT_MATTER_RE.match(text)
    if not match:
        return None, text
    return match.group(1), text[match.end():]


def first_heading(body: str) -> str:
    match = HEADING_RE.search(body)
    return match.group(1).strip() if match else ""


def parse_tags(value: str) -> list[str]:
    value = value.strip()
    if not value:
        return []
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return [part.strip().strip('"').strip("'") for part in value.split(",") if part.strip()]


def source_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def english_path(path: Path) -> Path:
    return Path(EN_DIR) / path


def is_excluded(rel: str) -> bool:
    parts = rel.split("/")
    if any(part.startswith(".") for part in parts):
        return True
    if rel in EXCLUDE_FILES:
        return True
    return parts[0] in EXCLUDE_DIRS


def collect_sources() -> list[Path]:
    sources: list[Path] = []
    for path in ROOT.rglob("*.md"):
        rel = path.relative_to(ROOT).as_posix()
        if rel.lower().endswith(".en.md") or is_excluded(rel):
            continue
        sources.append(path)
    return sorted(sources, key=lambda p: p.relative_to(ROOT).as_posix())


def has_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text))


def protect_fences(text: str, store: TokenStore) -> str:
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    buffer: list[str] = []
    fence_char = ""
    fence_len = 0

    for line in lines:
        match = re.match(r"^[ \t]{0,3}(`{3,}|~{3,})", line)
        if not fence_char:
            if match:
                fence_char = match.group(1)[0]
                fence_len = len(match.group(1))
                buffer = [line]
            else:
                out.append(line)
            continue

        buffer.append(line)
        if match and match.group(1)[0] == fence_char and len(match.group(1)) >= fence_len:
            out.append(store.add("".join(buffer), "C"))
            buffer = []
            fence_char = ""

    if buffer:
        out.append(store.add("".join(buffer), "C"))
    return "".join(out)


INLINE_CODE_RE = re.compile(r"(`+)([^`\n]*?)\1")
MATH_BLOCK_RE = re.compile(r"\$\$(.+?)\$\$", re.S)
MATH_INLINE_RE = re.compile(r"(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)")
IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)\n]*\)")
INLINE_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
REF_LINK_RE = re.compile(r"\[[^\]]+\]\[[^\]]*\]")
AUTOLINK_RE = re.compile(r"<[^>\n]+>")
BARE_URL_RE = re.compile(r"https?://[^\s<>()\[\]]+")


def protect_inline_core(text: str, store: TokenStore) -> str:
    patterns = (
        (INLINE_CODE_RE, "C"),
        (MATH_BLOCK_RE, "X"),
        (MATH_INLINE_RE, "X"),
        (IMAGE_RE, "G"),
        (REF_LINK_RE, "F"),
        (AUTOLINK_RE, "T"),
    )
    for pattern, kind in patterns:
        text = pattern.sub(lambda m, k=kind: store.add(m.group(0), k), text)

    # 只保护链接地址，链接文字仍然参与翻译。
    text = INLINE_LINK_RE.sub(
        lambda m: "[" + m.group(1) + "](" + store.add(m.group(2), "L") + ")",
        text,
    )
    text = BARE_URL_RE.sub(lambda m: store.add(m.group(0), "U"), text)
    return text


def protect_alternating(text: str, marker: str, kind: str, store: TokenStore) -> str:
    """按出现顺序把成对标记换成“开 / 闭”占位符，便于翻译后只清理标记内侧的空格。"""
    parts = text.split(marker)
    if len(parts) < 2:
        return text

    out = [parts[0]]
    for index, part in enumerate(parts[1:]):
        last = index == len(parts) - 2
        if last and len(parts) % 2 == 0:
            token_kind = "N"
        else:
            token_kind = kind + ("O" if index % 2 == 0 else "C")
        out.append(store.add(marker, token_kind))
        out.append(part)
    return "".join(out)


def protect_emphasis(text: str, store: TokenStore) -> str:
    for marker, kind in (("**", "B"), ("__", "B"), ("~~", "B"), ("*", "S"), ("_", "U")):
        text = protect_alternating(text, marker, kind, store)
    return text


def protect_structure(text: str, store: TokenStore) -> str:
    out: list[str] = []
    for line in text.splitlines(keepends=True):
        newline = "\n" if line.endswith("\n") else ""
        content = line[:-1] if newline else line

        ref_def = re.match(r"^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S?", content)
        if ref_def:
            out.append(store.add(content, "R") + newline)
            continue

        if re.match(r"^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$", content):
            out.append(store.add(content, "S") + newline)
            continue

        table_sep = re.match(
            r"^[ \t]{0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$",
            content,
        )
        if table_sep:
            out.append(store.add(content, "S") + newline)
            continue

        task = re.match(r"^([ \t]*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\])([ \t]+)(.*)$", content)
        if task:
            prefix = "".join(task.group(i) for i in range(1, 6))
            out.append(store.add(prefix, "I") + " " + task.group(6) + newline)
            continue

        item = re.match(r"^([ \t]*)([-+*]|\d+[.)])([ \t]+)(.*)$", content)
        if item:
            prefix = item.group(1) + item.group(2) + item.group(3)
            out.append(store.add(prefix, "I") + " " + item.group(4) + newline)
            continue

        heading = re.match(r"^([ \t]{0,3})(#{1,6})([ \t]+)(.*)$", content)
        if heading:
            prefix = heading.group(1) + heading.group(2) + heading.group(3)
            rest = heading.group(4)
            suffix = ""
            trailing = re.match(r"^(.*?)([ \t]+#+[ \t]*)$", rest)
            if trailing:
                rest, suffix = trailing.group(1), trailing.group(2)
            out.append(
                store.add(prefix, "D") + " " + rest
                + (store.add(suffix, "D") if suffix else "") + newline
            )
            continue

        quote = re.match(r"^([ \t]*(?:>[ \t]?)+)(.*)$", content)
        if quote:
            prefix = quote.group(1)
            inner = quote.group(2)
            callout = re.match(
                r"^(\[!(?:NOTE|TIP|WARNING|IMPORTANT|CAUTION)\])[ \t]*(.*)$",
                inner,
                re.I,
            )
            if callout:
                inner = store.add(callout.group(1), "O") + " " + callout.group(2)
            out.append(store.add(prefix, "Q") + " " + inner + newline)
            continue

        out.append(content + newline)

    return "".join(out)


def protect_body(body: str, store: TokenStore) -> str:
    text = protect_fences(body, store)
    text = protect_inline_core(text, store)
    text = protect_structure(text, store)
    text = protect_emphasis(text, store)
    text = text.replace("|", store.add("|", "P"))
    return text


def finish_translation(text: str, store: TokenStore) -> str:
    # 开标记：去掉标记“内侧”（后面）的空格；闭标记：去掉内侧（前面）的空格。
    text = re.sub(r"(ZXQ(?:B|S|U)O\d+QZX)[ \t]+", r"\1", text)
    text = re.sub(r"[ \t]+(ZXQ(?:B|S|U)C\d+QZX)", r"\1", text)
    text = re.sub(r"(\[[^\]\n]*\])\s+\(", r"\1(", text)
    text = re.sub(r"\(\s*(ZXQL\d+QZX)\s*\)", r"(\1)", text)
    text = re.sub(r"(ZXQ(?:D|I|Q)\d+QZX)[ \t]+", r"\1", text)
    text = re.sub(r"(ZXQO\d+QZX)[ \t]+", r"\1 ", text)
    text = re.sub(r"(ZXQD\d+QZX)([a-z])", lambda m: m.group(1) + m.group(2).upper(), text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return store.restore(text)


def safe_cut(text: str, max_bytes: int) -> int:
    cut = 0
    size = 0
    for index, char in enumerate(text):
        size += len(char.encode("utf-8"))
        if size > max_bytes:
            break
        cut = index + 1
    if cut <= 0:
        cut = 1

    for match in TOKEN_RE.finditer(text):
        if match.start() < cut < match.end():
            cut = match.start()
            break
    if cut <= 0:
        match = TOKEN_RE.match(text)
        cut = len(match.group(0)) if match else 1

    boundary = max(
        text.rfind("\n", 0, cut),
        text.rfind(" ", 0, cut),
        text.rfind("。", 0, cut),
        text.rfind("！", 0, cut),
        text.rfind("？", 0, cut),
        text.rfind("；", 0, cut),
    )
    if boundary >= max(1, cut // 2):
        cut = boundary + 1
    return max(1, cut)


def chunk_text(text: str, max_bytes: int) -> list[str]:
    chunks: list[str] = []
    rest = text
    while rest:
        if len(rest.encode("utf-8")) <= max_bytes:
            chunks.append(rest)
            break
        cut = safe_cut(rest, max_bytes)
        chunks.append(rest[:cut])
        rest = rest[cut:]
    return chunks


def http_json(url: str, data: bytes | None = None,
              headers: dict[str, str] | None = None, timeout: int = 60) -> object:
    merged = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        merged.update(headers)

    last_error: Exception | None = None
    for attempt in range(3):
        request = urllib.request.Request(
            url,
            data=data,
            headers=merged,
            method="POST" if data is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            detail = exc.read().decode("utf-8", "replace")[:200]
            if exc.code in (400, 401, 403, 404, 429):
                raise ProviderError(f"HTTP {exc.code}：{detail or exc.reason}") from exc
            if attempt < 2:
                time.sleep(2 ** attempt)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise ProviderError(f"网络请求失败：{last_error}")


def call_openai(text: str) -> str:
    api_key = SETTINGS["openai_key"]
    if not api_key:
        raise ProviderError("缺少 TRANSLATE_API_KEY（或 OPENAI_API_KEY）")

    payload = {
        "model": SETTINGS["model"],
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
    }
    data = http_json(
        SETTINGS["openai_url"],
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
        },
        timeout=180,
    )

    if not isinstance(data, dict):
        raise ProviderError("接口返回格式无法识别")
    choices = data.get("choices") or []
    if choices:
        content = (choices[0].get("message") or {}).get("content")
        if not content:
            content = choices[0].get("text")
        if content:
            return clean_response(str(content))
    if data.get("output_text"):
        return clean_response(str(data["output_text"]))
    raise ProviderError("接口返回中没有找到译文内容")


def call_mymemory(text: str) -> str:
    params = {"q": text, "langpair": "zh-CN|en"}
    if SETTINGS["mymemory_email"]:
        params["de"] = SETTINGS["mymemory_email"]

    data = http_json(MYMEMORY_URL + "?" + urllib.parse.urlencode(params))
    if not isinstance(data, dict):
        raise ProviderError("MyMemory 返回格式无法识别")

    status = data.get("responseStatus")
    try:
        status_code = int(status) if status is not None else 200
    except (TypeError, ValueError):
        status_code = 0
    if status_code and status_code != 200:
        raise ProviderError(f"MyMemory 返回状态 {status}")

    translated = (data.get("responseData") or {}).get("translatedText") or ""
    if not translated:
        raise ProviderError("MyMemory 返回空译文")
    upper = translated.upper()
    if "MYMEMORY WARNING" in upper or "ALL AVAILABLE FREE TRANSLATIONS" in upper \
            or "PLEASE SELECT" in upper:
        raise ProviderError("MyMemory 免费额度已用完")
    return html.unescape(translated)


def parse_google_response(data: object) -> str:
    if not isinstance(data, list) or not data:
        return ""
    if isinstance(data[0], str):
        return "".join(item for item in data if isinstance(item, str))
    if isinstance(data[0], list):
        return "".join(
            segment[0] for segment in data[0]
            if isinstance(segment, list) and segment and isinstance(segment[0], str)
        )
    return ""


def call_google(text: str) -> str:
    last_error: Exception | None = None
    for base, extra in GOOGLE_ENDPOINTS:
        params = {"sl": "zh-CN", "tl": "en", "q": text, **extra}
        try:
            data = http_json(base + "?" + urllib.parse.urlencode(params))
        except ProviderError as exc:
            last_error = exc
            continue
        translated = parse_google_response(data)
        if translated.strip():
            return translated
        last_error = ProviderError("Google 返回空译文")
    raise ProviderError(f"Google 翻译不可用：{last_error}")


def call_libretranslate(text: str) -> str:
    url = SETTINGS["libre_url"].strip() or LIBRETRANSLATE_DEFAULT_URL
    if not url.rstrip("/").endswith("/translate"):
        url = url.rstrip("/") + "/translate"

    payload = {"q": text, "source": "zh", "target": "en", "format": "text"}
    if SETTINGS["libre_key"]:
        payload["api_key"] = SETTINGS["libre_key"]

    data = http_json(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        timeout=120,
    )
    if not isinstance(data, dict):
        raise ProviderError("LibreTranslate 返回格式无法识别")
    translated = data.get("translatedText") or ""
    if not translated:
        raise ProviderError("LibreTranslate 返回空译文")
    return html.unescape(str(translated))


def call_provider(text: str, provider: str) -> str:
    if provider == "openai":
        return call_openai(text)
    if provider == "mymemory":
        return call_mymemory(text)
    if provider == "google":
        return call_google(text)
    if provider == "libretranslate":
        return call_libretranslate(text)
    raise ProviderError(f"未知翻译服务：{provider}")


def translate_chunks(text: str, provider: str) -> str:
    if not has_cjk(text):
        return text

    limit = PROVIDER_LIMITS.get(provider, 4000)
    chunks = chunk_text(text, limit)
    pieces: list[str] = []
    for index, chunk in enumerate(chunks):
        trailing = re.search(r"\s+$", chunk)
        suffix = trailing.group(0) if trailing else ""
        content = chunk[:trailing.start()] if trailing else chunk
        if not content or not has_cjk(content):
            pieces.append(chunk)
            continue

        leading = re.match(r"^\s*", content)
        prefix = leading.group(0) if leading else ""
        core = content[len(prefix):]
        translated = call_provider(core, provider).strip()
        if not suffix and index < len(chunks) - 1:
            suffix = " "
        pieces.append(prefix + translated + suffix)
    return "".join(pieces)


def uppercase_first(text: str) -> str:
    match = re.match(r"^(\s*)([a-z])", text)
    if match:
        return match.group(1) + match.group(2).upper() + text[match.end():]
    return text


def translate_front_matter(raw: str, provider: str) -> str:
    lines: list[str] = []
    for line in raw.splitlines():
        match = re.match(r"^(\s*)([A-Za-z0-9_-]+)(\s*:\s*)(.*)$", line)
        if not match:
            lines.append(line)
            continue

        indent, key, separator, value = match.groups()
        lower = key.lower()
        value = value.strip()
        if not value:
            lines.append(line)
            continue

        if lower == "tags":
            tags = parse_tags(value)
            translated_tags = []
            for tag in tags:
                translated_tag = translate_inline_value(tag, provider)
                if re.search(r"[,:\"'\[\]{}]", translated_tag):
                    translated_tag = json.dumps(translated_tag, ensure_ascii=False)
                translated_tags.append(translated_tag)
            lines.append(f"{indent}{key}{separator}[{', '.join(translated_tags)}]")
            continue

        if lower in FRONT_MATTER_TRANSLATE_KEYS:
            translated = uppercase_first(translate_inline_value(value, provider))
            lines.append(f"{indent}{key}{separator}{json.dumps(translated, ensure_ascii=False)}")
            continue

        lines.append(line)
    return "\n".join(lines)


def translate_inline_value(value: str, provider: str) -> str:
    store = TokenStore()
    protected = protect_inline_core(value, store)
    protected = protect_emphasis(protected, store)
    translated = translate_chunks(protected, provider)
    return finish_translation(translated, store).strip()


def translate_markdown_free(text: str, provider: str) -> str:
    raw, body = split_front_matter_raw(text)
    store = TokenStore()
    protected = protect_body(body, store)
    translated_body = translate_chunks(protected, provider)
    translated_body = finish_translation(translated_body, store)

    if raw is None:
        return translated_body.lstrip("\n")

    translated_meta = translate_front_matter(raw, provider)
    return "---\n" + translated_meta.strip("\n") + "\n---\n\n" + translated_body.lstrip("\n")


def translate_markdown(text: str, provider: str) -> str:
    if provider == "openai":
        return call_openai(text)
    return translate_markdown_free(text, provider)


def clean_response(text: str) -> str:
    text = text.strip()
    fence = re.match(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$", text, re.I)
    if fence:
        text = fence.group(1).strip()
    return text + "\n"


def inject_metadata(text: str, digest: str) -> str:
    text = text.replace("\r\n", "\n").lstrip("\ufeff").strip() + "\n"
    match = FRONT_MATTER_RE.match(text)
    raw, body = (match.group(1), text[match.end():]) if match else ("", text)

    kept: list[str] = []
    for line in raw.splitlines():
        if re.match(r"^\s*(lang|translatedFrom|translatedAt)\s*:", line):
            continue
        kept.append(line.rstrip())

    if not any(re.match(r"^\s*title\s*:", line) for line in kept):
        title = first_heading(body) or "Untitled"
        kept.insert(0, "title: " + json.dumps(title, ensure_ascii=False))

    kept.append("lang: en")
    kept.append(f"translatedFrom: {digest}")
    kept.append("translatedAt: " + datetime.now().astimezone().strftime("%Y-%m-%d"))

    header = "\n".join(kept).strip("\n")
    return f"---\n{header}\n---\n\n" + body.lstrip("\n")


def translate_file(source: Path, target: Path, digest: str, provider: str) -> None:
    text = read_text(source)
    translated = translate_markdown(text, provider)
    if not translated.strip():
        raise ProviderError("译文为空")
    translated = inject_metadata(translated, digest)
    target.parent.mkdir(parents=True, exist_ok=True)
    write_text(target, translated)
    log(f"  已生成 {target.relative_to(ROOT).as_posix()}（{provider}）")


def build_en_manifest() -> int:
    entries: list[dict[str, object]] = []

    for target in (ROOT / EN_DIR).rglob("*.md"):
        rel_en = target.relative_to(ROOT).as_posix()
        rel = rel_en[len(EN_DIR) + 1:]
        parts = rel.split("/")
        if any(part.startswith(".") for part in parts) or rel in EXCLUDE_FILES:
            continue
        if parts[0] in EXCLUDE_DIRS:
            continue
        if not (ROOT / rel).is_file():
            continue

        meta, body = split_front_matter(read_text(target))
        title = meta.get("title", "").strip() or first_heading(body) or display_name(Path(rel).name)
        entries.append({
            "path": rel,
            "pathEn": rel_en,
            "title": title,
            "description": (meta.get("description") or meta.get("summary") or "").strip(),
            "tags": parse_tags(meta.get("tags", "")),
        })

    entries.sort(key=lambda item: str(item["path"]))
    manifest = {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "count": len(entries),
        "files": entries,
    }
    write_text(ROOT / EN_MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return len(entries)


def read_dir_labels() -> dict[str, str]:
    path = ROOT / DIR_LABELS_FILE
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    labels = data.get("labels", data) if isinstance(data, dict) else {}
    if not isinstance(labels, dict):
        return {}
    return {str(key): str(value).strip() for key, value in labels.items()
            if str(key).strip() and str(value).strip()}


def collect_directories() -> list[str]:
    dirs: set[str] = set()
    for source in collect_sources():
        for part in source.relative_to(ROOT).parts[:-1]:
            if part not in EXCLUDE_DIRS and not part.startswith("."):
                dirs.add(part)
    return sorted(dirs)


def build_dir_labels(chain: list[str]) -> int:
    """为目录名生成英文标签，新增目录会自动翻译并写入 dirs.en.json。"""
    existing = read_dir_labels()
    labels: dict[str, str] = dict(DEFAULT_DIR_LABELS)
    labels.update(existing)

    directories = collect_directories()
    pending = [name for name in directories if name not in labels and has_cjk(name)]
    for name in pending:
        for provider in chain:
            try:
                value = uppercase_first(translate_inline_value(name, provider)).strip().strip(".。")
                if value and value != name:
                    labels[name] = value
                    log(f"  目录标签 {name} → {value}（{provider}）")
                    break
            except Exception as exc:
                if provider == chain[-1]:
                    log(f"  目录标签 {name} 翻译失败：{exc}")

    for name in directories:
        labels.setdefault(name, name)

    if labels == existing:
        return len(labels)

    payload = {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "labels": labels,
    }
    write_text(ROOT / DIR_LABELS_FILE, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return len(labels)


def provider_chain(requested: str) -> list[str]:
    if requested != "auto":
        return [requested]

    chain: list[str] = []
    if SETTINGS["openai_key"]:
        chain.append("openai")
    chain.extend(["google", "mymemory"])
    return chain


def main() -> int:
    global ROOT

    parser = argparse.ArgumentParser(description="为中文笔记生成英文译文，并刷新 manifest.en.json。")
    parser.add_argument("--root", default=str(ROOT), help="仓库根目录（默认脚本所在仓库）")
    parser.add_argument("--force", action="store_true", help="忽略 translatedFrom，重新翻译全部笔记")
    parser.add_argument("--check", action="store_true", help="只检查译文是否缺失或过期，不写入文件")
    parser.add_argument("--strict", action="store_true", help="翻译失败时以非零状态退出")
    parser.add_argument(
        "--provider",
        choices=PROVIDERS,
        default=None,
        help="翻译服务（默认读取 TRANSLATE_PROVIDER，未设置时为 auto：Google → MyMemory）",
    )
    args = parser.parse_args()

    ROOT = Path(args.root).resolve()
    if not (ROOT / "README.md").is_file():
        print(f"找不到仓库：{ROOT}", file=sys.stderr)
        return 1

    SETTINGS["openai_key"] = (
        os.environ.get("TRANSLATE_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    ).strip()
    SETTINGS["openai_url"] = (
        os.environ.get("TRANSLATE_API_URL") or OPENAI_DEFAULT_URL
    ).strip()
    SETTINGS["model"] = (os.environ.get("TRANSLATE_MODEL") or "gpt-4o-mini").strip()
    SETTINGS["mymemory_email"] = (os.environ.get("MYMEMORY_EMAIL") or "").strip()
    SETTINGS["libre_url"] = (
        os.environ.get("LIBRETRANSLATE_URL") or LIBRETRANSLATE_DEFAULT_URL
    ).strip()
    SETTINGS["libre_key"] = (os.environ.get("LIBRETRANSLATE_API_KEY") or "").strip()

    requested = (args.provider or os.environ.get("TRANSLATE_PROVIDER") or "auto").strip().lower()
    if requested not in PROVIDERS:
        print(f"未知翻译服务：{requested}（可选：{', '.join(PROVIDERS)}）", file=sys.stderr)
        return 1

    pending: list[tuple[Path, Path, str]] = []
    for source in collect_sources():
        target = ROOT / english_path(source.relative_to(ROOT))
        digest = source_hash(read_text(source))
        meta, _ = split_front_matter(read_text(target)) if target.is_file() else ({}, "")
        if args.force or meta.get("translatedfrom", "").strip() != digest:
            pending.append((source, target, digest))

    if args.check:
        if pending:
            print(f"有 {len(pending)} 篇笔记的英文译文缺失或过期：")
            for source, target, _ in pending:
                print("  - " + source.relative_to(ROOT).as_posix() + " -> " + target.relative_to(ROOT).as_posix())
            return 1
        print("英文译文已是最新。")
        return 0

    if not pending:
        print("英文译文已是最新，无需翻译。")
        count = build_en_manifest()
        dir_count = build_dir_labels(provider_chain(requested))
        print(f"已刷新 {EN_MANIFEST}：{count} 篇英文笔记，{dir_count} 个目录标签。")
        return 0

    chain = provider_chain(requested)
    print(f"开始翻译 {len(pending)} 篇笔记（服务：{' → '.join(chain)}）…")
    failed = 0
    for source, target, digest in pending:
        print("翻译 " + source.relative_to(ROOT).as_posix())
        errors: list[str] = []
        translated_ok = False
        for index, provider in enumerate(chain):
            try:
                translate_file(source, target, digest, provider)
                translated_ok = True
                break
            except Exception as exc:  # 单个服务失败不影响后续服务 / 笔记
                message = str(exc) if isinstance(exc, ProviderError) else f"{type(exc).__name__}: {exc}"
                errors.append(f"{provider}: {message}")
                if index < len(chain) - 1:
                    print(f"  {provider} 失败：{message}；尝试下一个服务…")
        if not translated_ok:
            failed += 1
            print("  失败：" + "；".join(errors), file=sys.stderr)

    if failed:
        print(f"有 {failed} 篇翻译失败，已保留原有译文。", file=sys.stderr)
        if args.strict:
            return 1

    count = build_en_manifest()
    dir_count = build_dir_labels(chain)
    print(f"已刷新 {EN_MANIFEST}：{count} 篇英文笔记，{dir_count} 个目录标签。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
