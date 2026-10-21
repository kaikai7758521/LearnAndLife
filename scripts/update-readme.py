#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
扫描仓库中的 Markdown 笔记，重新生成 README.md 里的笔记目录。

用法（在仓库根目录执行）：
    python3 scripts/update-readme.py
    python3 scripts/update-readme.py --check
    python3 scripts/update-readme.py --base-url https://example.github.io/repo/

README.md 中被下面两行注释包住的内容会被整体替换：
    <!-- NOTES:START -->
    <!-- NOTES:END -->

目录中的标题、锚点规则与 assets/js/app.js 保持一致：
    - 标题依次取 front matter 的 title → 第一个 # 标题 → 文件名；
    - 小标题取 H2–H4，锚点使用页面同款 slugify 规则。
生成结果是一份目录：笔记标题链接到页面，H2–H4 作为嵌套链接指向对应章节。
"""

from __future__ import annotations

import argparse
import html
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
CONFIG_JS = ROOT / "assets" / "js" / "config.js"

START_MARK = "<!-- NOTES:START -->"
END_MARK = "<!-- NOTES:END -->"

# 与 assets/js/config.js 中的 excludeDirs / excludeFiles 保持一致
EXCLUDE_DIRS = {"assets", "scripts", "node_modules", ".github", "_site", ".jekyll-cache"}
EXCLUDE_FILES = {"README.md", "USAGE.md"}

HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
FRONT_MATTER_RE = re.compile(r"^\ufeff?---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.S)
PUNCT_RE = re.compile(r"[!-,\.\/:-@\[-`{-~！-～、。，；：“”‘’（）【】《》〈〉〔〕…—·]")


def plain_inline(text: str) -> str:
    """去掉行内 Markdown 标记，近似浏览器里的 textContent。"""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[`*_~]", "", text)
    return html.unescape(text).strip()


def slugify(text: str) -> str:
    """与 assets/js/app.js 的 slugify 完全一致。"""
    text = text.strip().lower()
    text = re.sub(r"[\s\u00a0]+", "-", text)
    text = PUNCT_RE.sub("", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def link_text(text: str) -> str:
    """转义会破坏 Markdown 链接语法的方括号。"""
    return text.replace("[", "\\[").replace("]", "\\]")


def display_name(filename: str) -> str:
    """去掉 .md 与 01- 之类的排序前缀，仅用于展示。"""
    clean = re.sub(r"\.md$", "", filename, flags=re.I)
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


def strip_leading_h1(body: str, title: str) -> str:
    """与 app.js 的 stripLeadingH1 一致：首行 H1 与标题匹配时移除。"""
    match = re.match(r"^\s*#\s+([^\n]+)\n?", body)
    if not match:
        return body

    heading = re.sub(r"[*_`~]", "", match.group(1))
    heading = re.sub(r"\s+#+\s*$", "", heading).strip()
    a = re.sub(r"\s+", "", heading).lower()
    b = re.sub(r"\s+", "", title or "").lower()
    if a and b and (a == b or b in a or a in b):
        return body[match.end():].lstrip("\n")
    return body


def extract_headings(body: str) -> list[tuple[int, str]]:
    """提取 ATX 标题，跳过代码围栏中的内容。"""
    result: list[tuple[int, str]] = []
    fence: str | None = None

    for line in body.splitlines():
        fence_match = FENCE_RE.match(line)
        if fence:
            if fence_match and fence_match.group(1)[0] == fence[0] \
                    and len(fence_match.group(1)) >= len(fence):
                fence = None
            continue
        if fence_match:
            fence = fence_match.group(1)
            continue

        heading = HEADING_RE.match(line)
        if heading:
            result.append((len(heading.group(1)), plain_inline(heading.group(2))))
    return result


def natural_key(value: str) -> list[tuple[int, object]]:
    return [(0, part) if not part.isdigit() else (1, int(part))
            for part in re.split(r"(\d+)", value)]


def encode_component(value: str) -> str:
    """保留中文等 Unicode 字符，只转义会破坏 URL / Markdown 的字符。"""
    for char, code in (("%", "%25"), (" ", "%20"), ("<", "%3C"),
                       (">", "%3E"), ("#", "%23"), ("?", "%3F"), ("@", "%40")):
        value = value.replace(char, code)
    return value


def note_url(base_url: str, path: str) -> str:
    return base_url + "#/" + "/".join(encode_component(part) for part in path.split("/"))


def anchor_url(base_url: str, path: str, anchor: str) -> str:
    return note_url(base_url, path) + "@" + encode_component(anchor)


def read_js_string(source: str, key: str) -> str:
    match = re.search(rf"\b{key}\s*:\s*'([^']*)'", source)
    if not match:
        match = re.search(rf'\b{key}\s*:\s*"([^"]*)"', source)
    return match.group(1).strip() if match else ""


def github_from_remote() -> tuple[str, str]:
    try:
        output = subprocess.run(
            ["git", "-C", str(ROOT), "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return "", ""
    if output.returncode != 0:
        return "", ""
    match = re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$", output.stdout.strip())
    return (match.group(1), match.group(2)) if match else ("", "")


def detect_base_url(override: str) -> str:
    if override:
        return override if override.endswith("/") else override + "/"

    owner = repo = ""
    if CONFIG_JS.is_file():
        source = CONFIG_JS.read_text(encoding="utf-8")
        owner = read_js_string(source, "owner")
        repo = read_js_string(source, "repo")
    if not owner or not repo:
        owner, repo = github_from_remote()
    if not owner or not repo:
        raise SystemExit("无法确定 GitHub Pages 地址，请用 --base-url 指定。")

    if repo == f"{owner}.github.io":
        return f"https://{repo}/"
    return f"https://{owner}.github.io/{repo}/"


def collect_notes(base_url: str) -> list[dict[str, object]]:
    notes: list[dict[str, object]] = []

    for file_path in ROOT.rglob("*.md"):
        rel = file_path.relative_to(ROOT).as_posix()
        parts = rel.split("/")
        if any(part.startswith(".") for part in parts):
            continue
        if rel in EXCLUDE_FILES or parts[0] in EXCLUDE_DIRS:
            continue

        text = file_path.read_text(encoding="utf-8-sig")
        meta, body = split_front_matter(text)

        raw_headings = extract_headings(body)
        title = meta.get("title", "").strip()
        if not title:
            title = next((text_value for level, text_value in raw_headings if level == 1), "")
        if not title:
            title = display_name(file_path.name)

        body = strip_leading_h1(body, title)
        headings = extract_headings(body)

        used: dict[str, bool] = {}
        outline: list[tuple[int, str, str]] = []
        for level, text_value in headings:
            base = slugify(text_value) or "section"
            slug = base
            index = 2
            while used.get(slug):
                slug = f"{base}-{index}"
                index += 1
            used[slug] = True
            if 2 <= level <= 4:
                outline.append((level, text_value, slug))

        notes.append({
            "path": rel,
            "dir": "/".join(parts[:-1]),
            "title": title,
            "outline": outline,
            "url": note_url(base_url, rel),
        })

    notes.sort(key=lambda item: natural_key(str(item["path"])))
    return notes


def render_block(base_url: str, notes: list[dict[str, object]]) -> str:
    lines = [START_MARK, "<!-- 本区域由 scripts/update-readme.py 自动生成，请勿手动修改 -->", ""]

    groups: dict[str, list[dict[str, object]]] = {}
    for note in notes:
        groups.setdefault(str(note["dir"]), []).append(note)

    for dir_path in sorted(groups, key=natural_key):
        heading = dir_path.replace("/", " / ") if dir_path else "根目录"
        lines.extend([f"## {heading}", ""])
        for note in groups[dir_path]:
            lines.append(f"- [{link_text(str(note['title']))}]({note['url']})")
            for level, text_value, slug in note["outline"]:
                indent = "  " * (level - 1)
                link = anchor_url(base_url, str(note["path"]), slug)
                lines.append(f"{indent}- [{link_text(text_value)}]({link})")
        lines.append("")

    lines.append(END_MARK)
    return "\n".join(lines).rstrip() + "\n"


def apply_block(readme: str, block: str) -> str:
    if START_MARK in readme and END_MARK in readme:
        start = readme.index(START_MARK)
        end = readme.index(END_MARK, start)
        head = readme[:start]
        tail = readme[end + len(END_MARK):].lstrip("\r\n")
        result = head + block.rstrip("\n")
        if tail:
            result += "\n\n" + tail
        else:
            result += "\n"
        return result

    if readme and not readme.endswith("\n"):
        readme += "\n"
    return readme + "\n" + block


def main() -> int:
    parser = argparse.ArgumentParser(description="根据笔记内容重新生成 README.md 的笔记目录。")
    parser.add_argument("--base-url", default="", help="GitHub Pages 站点地址，例如 https://owner.github.io/repo/")
    parser.add_argument("--check", action="store_true", help="只检查 README.md 是否需要更新，不写入文件")
    args = parser.parse_args()

    if not README.is_file():
        print("找不到 README.md。", file=sys.stderr)
        return 1

    base_url = detect_base_url(args.base_url)
    notes = collect_notes(base_url)
    block = render_block(base_url, notes)

    original = README.read_text(encoding="utf-8")
    updated = apply_block(original, block)
    changed = updated != original

    if args.check:
        print("README.md 需要更新。" if changed else "README.md 已是最新。")
        return 1 if changed else 0

    if changed:
        README.write_text(updated, encoding="utf-8")
        print(f"已更新 README.md：{len(notes)} 篇笔记。")
    else:
        print(f"README.md 已是最新：{len(notes)} 篇笔记。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
