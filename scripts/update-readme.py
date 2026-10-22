#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
扫描仓库中的 Markdown 笔记，重新生成 manifest.json、README.md 与 en/README.md。

用法（在仓库根目录执行）：
    python3 scripts/update-readme.py
    python3 scripts/update-readme.py --check
    python3 scripts/update-readme.py --no-manifest
    python3 scripts/update-readme.py --base-url https://example.github.io/repo/

README.md 与 en/README.md 中被下面两行注释包住的内容会被整体替换：
    <!-- NOTES:START -->
    <!-- NOTES:END -->

目录中的标题、锚点规则与 assets/js/app.js 保持一致：
    - 标题依次取 front matter 的 title → 第一个 # 标题 → 文件名；
    - 小标题取 H2–H4，锚点使用页面同款 slugify 规则。
生成结果是一份目录：笔记标题链接到页面，H2–H4 作为嵌套链接指向对应章节。
英文目录来自 `en/<笔记>.md`（由 scripts/translate-notes.py 生成），与中文目录结构一一对应。

manifest.json 的字段与 scripts/build-manifest.ps1 保持一致：
    - title / date / lastModified / icon / tags / size；
    - 日期优先沿用旧 manifest，lastModified 优先取 Git 最后一次提交；
    - 自动跳过 en/ 目录与 README / USAGE 等非笔记文件。
manifest.en.json 由 en/ 下英文译文的 front matter 生成，结构与 translate-notes.py 一致。
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
README_EN = ROOT / "en" / "README.md"
MANIFEST = ROOT / "manifest.json"
MANIFEST_EN = ROOT / "manifest.en.json"
CONFIG_JS = ROOT / "assets" / "js" / "config.js"

START_MARK = "<!-- NOTES:START -->"
END_MARK = "<!-- NOTES:END -->"
EN_DIR = "en"
EN_SUFFIX = ".en.md"

# 与 assets/js/config.js 中的 excludeDirs / excludeFiles 保持一致
EXCLUDE_DIRS = {"en", "assets", "scripts", "node_modules", ".github", "_site", ".jekyll-cache"}
EXCLUDE_FILES = {"README.md", "README.en.md", "USAGE.md", "AGENTS.md"}

# 英文目录中展示的文件夹名称（未列出的目录保留原名）
DIR_LABELS_EN = {
    "前端": "Frontend",
    "日常生活": "Daily Life",
    "运动": "Sports",
    "后端": "Backend",
    "计算机基础": "Computer Science",
    "数据结构": "Data Structures",
    "算法": "Algorithms",
    "网络": "Networking",
    "操作系统": "Operating Systems",
    "数据库": "Databases",
    "工程化": "Engineering",
    "工具": "Tooling",
    "根目录": "Root",
}

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
    """去掉 .md / .en.md 与 01- 之类的排序前缀，仅用于展示。"""
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


def collect_notes(base_url: str, lang: str = "zh") -> list[dict[str, object]]:
    notes: list[dict[str, object]] = []
    folder = ROOT / EN_DIR if lang == "en" else ROOT
    pattern = "*.md"
    files = sorted(folder.rglob(pattern), key=lambda p: p.relative_to(ROOT).as_posix())

    for file_path in files:
        rel_full = file_path.relative_to(ROOT).as_posix()
        rel = rel_full[len(EN_DIR) + 1:] if lang == "en" else rel_full
        parts = rel.split("/")

        if lang == "zh" and rel.lower().endswith(EN_SUFFIX):
            continue
        if any(part.startswith(".") for part in parts):
            continue
        if rel in EXCLUDE_FILES:
            continue
        if parts[0] in EXCLUDE_DIRS:
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
            "path": rel_full if lang == "en" else rel,
            "dir": "/".join(parts[:-1]),
            "title": title,
            "outline": outline,
            "url": note_url(base_url, rel_full if lang == "en" else rel),
            "lang": lang,
        })

    notes.sort(key=lambda item: natural_key(str(item["path"])))
    return notes


def group_heading(dir_path: str, lang: str) -> str:
    if not dir_path:
        return DIR_LABELS_EN["根目录"] if lang == "en" else "根目录"
    labels = [DIR_LABELS_EN.get(part, part) for part in dir_path.split("/")] if lang == "en" \
        else dir_path.split("/")
    return " / ".join(labels)


def render_block(base_url: str, notes: list[dict[str, object]], lang: str = "zh") -> str:
    comment = ("<!-- This block is generated by scripts/update-readme.py. Do not edit manually. -->"
               if lang == "en" else
               "<!-- 本区域由 scripts/update-readme.py 自动生成，请勿手动修改 -->")
    lines = [START_MARK, comment, ""]

    groups: dict[str, list[dict[str, object]]] = {}
    for note in notes:
        groups.setdefault(str(note["dir"]), []).append(note)

    for dir_path in sorted(groups, key=natural_key):
        lines.extend([f"## {group_heading(dir_path, lang)}", ""])
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


def parse_tag_list(value: str) -> list[str]:
    value = (value or "").strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return [part.strip().strip('"').strip("'") for part in value.split(",") if part.strip()]


def git_last_modified(rel: str, cache: dict[str, str]) -> str:
    """与 build-manifest.ps1 的 Get-GitDate 一致，返回 yyyy-MM-dd。"""
    if rel in cache:
        return cache[rel]

    git_exe = shutil.which("git")
    if not git_exe:
        cache[rel] = ""
        return ""

    try:
        result = subprocess.run(
            [git_exe, "-C", str(ROOT), "log", "-1", "--format=%cI", "--", rel],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        cache[rel] = ""
        return ""

    iso = result.stdout.strip()
    if result.returncode != 0 or not iso:
        cache[rel] = ""
        return ""

    try:
        value = datetime.fromisoformat(iso.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        match = re.match(r"^(\d{4}-\d{2}-\d{2})", iso)
        value = match.group(1) if match else ""
    cache[rel] = value
    return value


def load_previous_manifest() -> dict[str, dict[str, str]]:
    if not MANIFEST.is_file():
        return {}
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

    previous: dict[str, dict[str, str]] = {}
    for item in data.get("files", []) if isinstance(data, dict) else []:
        if not isinstance(item, dict) or not item.get("path"):
            continue
        previous[str(item["path"])] = {
            "date": str(item.get("date", "")),
            "lastModified": str(item.get("lastModified", "")),
            "icon": str(item.get("icon", "")),
        }
    return previous


def build_manifest_data() -> dict[str, object]:
    """扫描笔记生成 manifest.json 数据，字段与 build-manifest.ps1 保持一致。"""
    previous = load_previous_manifest()
    git_cache: dict[str, str] = {}
    files: list[dict[str, object]] = []

    for file_path in ROOT.rglob("*.md"):
        rel = file_path.relative_to(ROOT).as_posix()
        parts = rel.split("/")
        if rel.lower().endswith(EN_SUFFIX):
            continue
        if any(part.startswith(".") for part in parts):
            continue
        if rel in EXCLUDE_FILES or parts[0] in EXCLUDE_DIRS:
            continue

        text = file_path.read_text(encoding="utf-8-sig")
        meta, body = split_front_matter(text)
        headings = extract_headings(body)

        title = meta.get("title", "").strip()
        if not title:
            title = next((value for level, value in headings if level == 1), "")
        if not title:
            title = file_path.stem

        old = previous.get(rel, {})
        date = meta.get("date", "").strip() or old.get("date", "")
        last_modified = (meta.get("updated", "").strip()
                         or meta.get("lastmodified", "").strip()
                         or git_last_modified(rel, git_cache)
                         or old.get("lastModified", ""))
        icon = meta.get("icon", "").strip() or old.get("icon", "")

        stat = file_path.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime).date().isoformat()
        date = date or mtime
        last_modified = last_modified or mtime

        files.append({
            "path": rel,
            "title": title.strip(),
            "date": date.strip(),
            "lastModified": last_modified.strip(),
            "icon": icon.strip(),
            "tags": parse_tag_list(meta.get("tags", "")),
            "size": stat.st_size,
        })

    files.sort(key=lambda item: str(item["path"]))
    return {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "count": len(files),
        "files": files,
    }


def build_en_manifest_data() -> dict[str, object]:
    """扫描 en/ 目录生成 manifest.en.json，字段与 translate-notes.py 保持一致。"""
    files: list[dict[str, object]] = []

    for target in (ROOT / EN_DIR).rglob("*.md"):
        rel_en = target.relative_to(ROOT).as_posix()
        rel = rel_en[len(EN_DIR) + 1:]
        parts = rel.split("/")
        if any(part.startswith(".") for part in parts):
            continue
        if rel in EXCLUDE_FILES:
            continue
        if parts[0] in EXCLUDE_DIRS:
            continue
        if not (ROOT / rel).is_file():
            continue

        meta, body = split_front_matter(target.read_text(encoding="utf-8-sig"))
        headings = extract_headings(body)
        title = meta.get("title", "").strip()
        if not title:
            title = next((value for level, value in headings if level == 1), "")
        if not title:
            title = display_name(Path(rel).name)

        files.append({
            "path": rel,
            "pathEn": rel_en,
            "title": title,
            "description": (meta.get("description") or meta.get("summary") or "").strip(),
            "tags": parse_tag_list(meta.get("tags", "")),
        })

    files.sort(key=lambda item: str(item["path"]))
    return {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "count": len(files),
        "files": files,
    }


def manifest_changed(old: dict[str, object] | None, new: dict[str, object]) -> bool:
    if not old:
        return True
    old_copy = dict(old)
    new_copy = dict(new)
    old_copy.pop("generatedAt", None)
    new_copy.pop("generatedAt", None)
    return old_copy != new_copy


def read_manifest_json(path: Path = MANIFEST) -> dict[str, object] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_manifest(data: dict[str, object], path: Path = MANIFEST) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def readme_en_template() -> str:
    return """# 📚 My Learning Notes

Markdown study notes organized by **learning area / topic / detail**. This is the complete table of contents — click any title to open the page or section. Use the `EN` / `中文` button in the title bar to switch languages.

<!-- NOTES:START -->
<!-- NOTES:END -->

---

> New notes only need a directory and a `.md` file; the GitHub Action refreshes the index, translations and both outlines automatically.
>
> This outline is generated by `scripts/update-readme.py`; do not edit inside the markers. See `USAGE.md` for setup and writing tips.
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="根据笔记内容重新生成 manifest.json 与中英文 README 目录。")
    parser.add_argument("--base-url", default="", help="GitHub Pages 站点地址，例如 https://owner.github.io/repo/")
    parser.add_argument("--check", action="store_true", help="只检查索引与 README 是否需要更新，不写入文件")
    parser.add_argument("--no-manifest", action="store_true", help="只更新 README，不刷新 manifest.json / manifest.en.json")
    args = parser.parse_args()

    if not README.is_file():
        print("找不到 README.md。", file=sys.stderr)
        return 1

    manifest_data = None
    manifest_en_data = None
    changed_manifest = False
    changed_manifest_en = False
    if not args.no_manifest:
        manifest_data = build_manifest_data()
        changed_manifest = manifest_changed(read_manifest_json(MANIFEST), manifest_data)
        manifest_en_data = build_en_manifest_data()
        changed_manifest_en = manifest_changed(read_manifest_json(MANIFEST_EN), manifest_en_data)

    base_url = detect_base_url(args.base_url)

    notes = collect_notes(base_url, "zh")
    block = render_block(base_url, notes, "zh")
    original = README.read_text(encoding="utf-8")
    updated = apply_block(original, block)

    en_notes = collect_notes(base_url, "en")
    updated_en = ""
    if en_notes:
        block_en = render_block(base_url, en_notes, "en")
        original_en = README_EN.read_text(encoding="utf-8") if README_EN.is_file() else readme_en_template()
        updated_en = apply_block(original_en, block_en)

    changed = updated != original
    changed_en = bool(updated_en) and (not README_EN.is_file()
                                       or updated_en != README_EN.read_text(encoding="utf-8"))

    if args.check:
        messages = []
        if not args.no_manifest:
            messages.append("manifest.json 需要更新。" if changed_manifest else "manifest.json 已是最新。")
            messages.append("manifest.en.json 需要更新。" if changed_manifest_en else "manifest.en.json 已是最新。")
        messages.append("README.md 需要更新。" if changed else "README.md 已是最新。")
        if en_notes:
            messages.append("en/README.md 需要更新。" if changed_en else "en/README.md 已是最新。")
        print("\n".join(messages))
        return 1 if changed or changed_en or changed_manifest or changed_manifest_en else 0

    if not args.no_manifest:
        if changed_manifest and manifest_data:
            write_manifest(manifest_data, MANIFEST)
            print(f"已更新 manifest.json：{len(manifest_data['files'])} 篇笔记。")
        else:
            print(f"manifest.json 已是最新：{len(manifest_data['files']) if manifest_data else 0} 篇笔记。")

        if changed_manifest_en and manifest_en_data:
            write_manifest(manifest_en_data, MANIFEST_EN)
            print(f"已更新 manifest.en.json：{len(manifest_en_data['files'])} 篇英文笔记。")
        else:
            print(f"manifest.en.json 已是最新：{len(manifest_en_data['files']) if manifest_en_data else 0} 篇英文笔记。")

    if changed:
        README.write_text(updated, encoding="utf-8")
        print(f"已更新 README.md：{len(notes)} 篇笔记。")
    else:
        print(f"README.md 已是最新：{len(notes)} 篇笔记。")

    if en_notes:
        if changed_en:
            README_EN.parent.mkdir(parents=True, exist_ok=True)
            README_EN.write_text(updated_en, encoding="utf-8")
            print(f"已更新 en/README.md：{len(en_notes)} 篇英文笔记。")
        else:
            print(f"en/README.md 已是最新：{len(en_notes)} 篇英文笔记。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
