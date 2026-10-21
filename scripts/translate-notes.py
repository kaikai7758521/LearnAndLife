#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为中文笔记生成英文版本，并刷新 manifest.en.json。

约定
----
- 中文笔记： 前端/JavaScript/01-变量与类型.md
- 英文译文： 前端/JavaScript/01-变量与类型.en.md
- 译文 front matter 中的 translatedFrom 记录中文源文件的 SHA-256，
  源文件变化后会重新翻译；内容未变化时直接跳过。

自动翻译使用 OpenAI 兼容的 Chat Completions 接口，通过环境变量配置：
    TRANSLATE_API_KEY   （必填，也可用 OPENAI_API_KEY）
    TRANSLATE_API_URL   默认 https://api.openai.com/v1/chat/completions
    TRANSLATE_MODEL     默认 gpt-4o-mini

没有配置密钥时：
- 已有且未过期的译文保持不动；
- 缺失或过期的译文会给出警告，站点自动回退中文；
- 加 --strict 可让脚本以非零状态退出（适合 CI 强制校验）。

用法（在仓库根目录执行）：
    python3 scripts/translate-notes.py
    python3 scripts/translate-notes.py --check
    python3 scripts/translate-notes.py --force
    python3 scripts/translate-notes.py --strict
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN_SUFFIX = ".en.md"
EN_MANIFEST = "manifest.en.json"

# 与 assets/js/config.js、scripts/update-readme.py 保持一致
EXCLUDE_DIRS = {"assets", "scripts", "node_modules", ".github", "_site", ".jekyll-cache"}
EXCLUDE_FILES = {"README.md", "README.en.md", "USAGE.md"}

FRONT_MATTER_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.S)
LINK_RE = re.compile(r"(!?\[[^\]]*\]\()([^)\s]+)(\))")
HEADING_RE = re.compile(r"^\s{0,3}#\s+(.+?)\s*#*\s*$", re.M)

SYSTEM_PROMPT = """You are a professional technical translator.
Translate the Chinese Markdown study note supplied by the user into natural, accurate English.

Rules:
1. Keep the Markdown structure exactly: front matter, headings, lists, tables, blockquotes, callouts, code fences, math, Mermaid diagrams.
2. Translate natural-language prose, heading text, table cells, alt text and diagram labels.
3. Never translate code, identifiers, command names, URLs, file paths or library names.
4. Keep relative links and images working. If a link points to another note in this repository,
   keep the same path and only change the `.md` extension to `.en.md` when a translation exists.
5. Keep the original front matter keys. Translate `title`, `description` and `tags` values;
   do not add `translatedFrom`, `translatedAt` or `lang` (the script adds them).
6. Return only the translated Markdown document, with no explanation and no surrounding code fence.
"""


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
            meta[kv.group(1).lower()] = kv.group(2).strip().strip('"').strip("'")
    return meta, text[match.end():]


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
    value = path.as_posix()
    if not value.lower().endswith(".md"):
        return Path(value + EN_SUFFIX)
    return Path(value[:-3] + EN_SUFFIX)


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
        if rel.lower().endswith(EN_SUFFIX) or is_excluded(rel):
            continue
        sources.append(path)
    return sorted(sources, key=lambda p: p.relative_to(ROOT).as_posix())


def rewrite_links(text: str, source: Path) -> str:
    """把指向已有译文的相对 .md 链接改成 .en.md。"""
    source_dir = source.parent

    def replace(match: re.Match[str]) -> str:
        prefix, target, suffix = match.groups()
        if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith(("#", "/")):
            return match.group(0)

        file_part, sep, anchor = target.partition("#")
        if not file_part.lower().endswith(".md") or file_part.lower().endswith(EN_SUFFIX):
            return match.group(0)

        candidate = (source_dir / file_part).resolve()
        try:
            rel = candidate.relative_to(ROOT)
        except ValueError:
            return match.group(0)
        if not (ROOT / english_path(rel)).is_file():
            return match.group(0)

        return prefix + file_part[:-3] + EN_SUFFIX + sep + anchor + suffix

    return LINK_RE.sub(replace, text)


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


def clean_response(text: str) -> str:
    text = text.strip()
    fence = re.match(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$", text, re.I)
    if fence:
        text = fence.group(1).strip()
    return text + "\n"


def call_api(text: str, api_key: str, api_url: str, model: str) -> str:
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
    }
    request = urllib.request.Request(
        api_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
        },
        method="POST",
    )

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
            choices = data.get("choices") or []
            if choices:
                content = (choices[0].get("message") or {}).get("content")
                if not content:
                    content = choices[0].get("text")
                if content:
                    return clean_response(str(content))
            if data.get("output_text"):
                return clean_response(str(data["output_text"]))
            raise RuntimeError("接口返回中没有找到译文内容")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"翻译接口调用失败：{last_error}")


def translate_file(source: Path, target: Path, digest: str, api_key: str,
                   api_url: str, model: str) -> None:
    text = read_text(source)
    translated = call_api(text, api_key, api_url, model)
    if not translated.strip():
        raise RuntimeError("译文为空")
    translated = inject_metadata(translated, digest)
    translated = rewrite_links(translated, source)
    target.parent.mkdir(parents=True, exist_ok=True)
    write_text(target, translated)
    log(f"  已生成 {target.relative_to(ROOT).as_posix()}")


def refresh_all_links() -> None:
    """所有译文生成后统一刷新链接，避免交叉引用因翻译顺序漏改。"""
    for source in collect_sources():
        target = ROOT / english_path(source.relative_to(ROOT))
        if not target.is_file():
            continue
        text = read_text(target)
        updated = rewrite_links(text, source)
        if updated != text:
            write_text(target, updated)
            log(f"  已更新链接 {target.relative_to(ROOT).as_posix()}")


def build_en_manifest() -> int:
    entries: list[dict[str, object]] = []

    for target in ROOT.rglob("*" + EN_SUFFIX):
        rel = target.relative_to(ROOT).as_posix()
        if is_excluded(rel):
            continue

        zh_rel = rel[:-len(EN_SUFFIX)] + ".md"
        if not (ROOT / zh_rel).is_file():
            continue

        meta, body = split_front_matter(read_text(target))
        title = meta.get("title", "").strip() or first_heading(body) or display_name(Path(zh_rel).name)
        entries.append({
            "path": zh_rel,
            "pathEn": rel,
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


def main() -> int:
    global ROOT

    parser = argparse.ArgumentParser(description="为中文笔记生成英文译文，并刷新 manifest.en.json。")
    parser.add_argument("--root", default=str(ROOT), help="仓库根目录（默认脚本所在仓库）")
    parser.add_argument("--force", action="store_true", help="忽略 translatedFrom，重新翻译全部笔记")
    parser.add_argument("--check", action="store_true", help="只检查译文是否缺失或过期，不写入文件")
    parser.add_argument("--strict", action="store_true", help="没有密钥或译文过期时以非零状态退出")
    args = parser.parse_args()

    ROOT = Path(args.root).resolve()
    if not (ROOT / "README.md").is_file():
        print(f"找不到仓库：{ROOT}", file=sys.stderr)
        return 1

    api_key = (os.environ.get("TRANSLATE_API_KEY") or os.environ.get("OPENAI_API_KEY") or "").strip()
    api_url = (os.environ.get("TRANSLATE_API_URL") or "https://api.openai.com/v1/chat/completions").strip()
    model = (os.environ.get("TRANSLATE_MODEL") or "gpt-4o-mini").strip()

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

    if pending and not api_key:
        print(f"有 {len(pending)} 篇笔记需要翻译，但未配置 TRANSLATE_API_KEY（或 OPENAI_API_KEY）。")
        print("站点会回退显示中文；配置密钥后重新运行即可自动生成英文版本。")
        for source, target, _ in pending:
            state = "缺失" if not target.is_file() else "过期"
            print(f"  - {state}：{target.relative_to(ROOT).as_posix()}")
        if args.strict:
            return 1
    elif pending:
        print(f"开始翻译 {len(pending)} 篇笔记（模型：{model}）…")
        failed = 0
        for source, target, digest in pending:
            print("翻译 " + source.relative_to(ROOT).as_posix())
            try:
                translate_file(source, target, digest, api_key, api_url, model)
            except Exception as exc:  # 单篇失败不影响其他笔记
                failed += 1
                print(f"  失败：{exc}", file=sys.stderr)
        if failed:
            print(f"有 {failed} 篇翻译失败，已保留原有译文。", file=sys.stderr)
            if args.strict:
                return 1
    else:
        print("英文译文已是最新，无需翻译。")

    count = build_en_manifest()
    refresh_all_links()
    print(f"已刷新 {EN_MANIFEST}：{count} 篇英文笔记。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


