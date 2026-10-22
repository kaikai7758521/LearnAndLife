# 📚 我的学习笔记

按 **学习方向 / 内容 / 细节** 组织 Markdown 笔记，自动生成目录的纯静态站点。
界面做成 macOS 桌面风格：菜单栏、可关闭 / 缩放的红绿灯窗口、程序坞、深浅色主题和全站搜索。
没有构建步骤、没有依赖安装：把 `.md` 文件放进仓库，推送到 GitHub，Pages 就会自动更新。

> [!TIP]
> 侧边栏目录来自 `manifest.json`，由 `scripts/update-readme.py`（GitHub Action 自动调用）在每次提交 `.md` 后刷新并提交。
> 新建笔记只需要在 GitHub 网页上创建目录和文件，不需要在本地运行任何命令。

## 个性化站点

站点标题、副标题、品牌图标和页脚文字都在根目录的 `site.json` 里，改完刷新页面即可，不需要重新构建：

```json
{
  "title": "我的学习笔记",
  "subtitle": "知识沉淀 · 持续更新",
  "brandIcon": "📚",
  "footer": "持续学习，持续记录"
}
```

`assets/js/config.js` 只保留部署相关配置：GitHub 仓库信息、首页文件名、忽略的目录、是否显示「最近修改」。GitHub Pages 站点通常可以留空 `owner` / `repo`（会从 `*.github.io` 域名自动识别），本地预览或自定义域名时手动填写即可。

## 目录约定

```
学习方向/
  内容/
    细节.md
```

例如：

```
前端/
  JavaScript/
    01-变量与类型.md
    02-异步与事件循环.md
计算机基础/
  数据结构/
    01-数组与链表.md
```

- 目录名、文件名都可以用中文。
- 文件名前的 `01-`、`02-` 只用于排序，界面上会自动隐藏。
- 想调整顺序，改数字前缀即可。

## 新建一篇笔记（无需命令行）

全程在 GitHub 网页上完成，不需要在本地运行任何命令：

1. **新建目录和文件**：打开仓库页面，点 **Add file → Create new file**。在文件名输入框里直接写带目录的路径，目录会自动创建，例如：

   ```
   前端/JavaScript/03-闭包.md
   ```

   想新增分类时，直接在文件名前写新的目录名即可。

2. **写正文**：笔记开头可以写 front matter（可选）：

   ```markdown
   ---
   title: 闭包
   date: 2026-10-21
   updated: 2026-10-28
   icon: 🚀
   tags: [JavaScript, 基础]
   description: 一句话说明这篇笔记讲什么
   ---

   # 闭包

   正文……
   ```

   - `date` 是写作日期，`updated` 是最近修改日期（不写则取 Git 最后一次提交时间）。
   - `icon` 可以用任意 emoji 覆盖自动生成的页面图标。
   - `tags` 会显示在标题下方，`description` 会显示成摘要。

3. **提交**：点 **Commit changes**，直接提交到 `main` 分支。

4. **等待自动更新**：提交后不需要做任何事——

   - GitHub Action 检测到 `.md` 变化，自动运行 `scripts/translate-notes.py` 和 `scripts/update-readme.py`（后者同时刷新 `manifest.json` 与中英文目录），刷新并提交 `manifest.json`、`manifest.en.json`、`README.md`、`README.en.md` 与英文译文；
   - GitHub Pages 随之重新部署；
   - 部署完成后刷新页面，左侧目录、搜索和首页的「学习方向 / 最近更新」会自动出现新目录和新笔记。

> [!NOTE]
> `manifest.json`、`manifest.en.json` 与 `README.md` / `README.en.md` 的标记区由脚本自动维护，不要手动修改。

## 索引文件 `manifest.json`

`scripts/update-readme.py` 会扫描所有 Markdown 生成索引（Action 会自动运行），每篇笔记包含：

| 字段 | 说明 |
| --- | --- |
| `path` | 仓库内的相对路径 |
| `title` | front matter 的 `title` → 第一个 `#` 标题 → 文件名 |
| `date` | 写作日期（front matter → 旧索引 → 文件修改时间） |
| `lastModified` | 最近修改日期（front matter 的 `updated` → Git 提交时间 → 文件修改时间） |
| `icon` | front matter 的 `icon`，留空则按路径自动分配 emoji |
| `tags` | front matter 的 `tags` 数组，用于标签搜索 |
| `size` | 字节数 |

## 更新索引与 README 目录

`manifest.json`、`README.md` 与 `README.en.md` 由同一个脚本生成。需要手动刷新时，在仓库根目录执行：

```bash
python3 scripts/update-readme.py
```

- 脚本会先扫描所有中文笔记，刷新 `manifest.json`（跳过 `.en.md`、README / USAGE）；
- 再读取 front matter 的 `title`、第一个 `#` 标题和 H2–H4 小标题，生成 `README.md`；
- 存在英文译文时，会同步扫描 `.en.md` 生成英文目录 `README.en.md` 与英文索引 `manifest.en.json`；
- 输出为纯目录形式：笔记标题本身即链接，小标题作为嵌套链接，行尾不再追加 URL；
- 自动生成与页面一致的锚点链接，并按「学习方向 / 内容」分组；
- 只替换两个标记之间的内容，标记之外的介绍和说明保持不变；
- 重复执行结果一致；加 `--check` 只检查是否需要更新，不写入文件；
- 加 `--no-manifest` 可只刷新 README，不重写 `manifest.json` / `manifest.en.json`；
- 使用自定义域名时，可用 `--base-url https://your-domain/` 指定链接前缀。

> [!TIP]
> 推送到 GitHub 后，Action 会自动执行该脚本并提交索引与目录，通常不需要在本地运行。`scripts/build-manifest.ps1` 仍保留给 Windows 用户单独生成索引，但 Action 不再需要它。

## 中英文切换与自动翻译

中文是唯一的内容源。英文译文与中文笔记放在同一目录，文件名加 `.en.md`：

```text
前端/JavaScript/01-变量与类型.md      # 中文原文
前端/JavaScript/01-变量与类型.en.md   # 英文译文（自动生成或手动维护）
```

### 自动翻译

`scripts/translate-notes.py` 会扫描所有中文笔记：

- 用 `translatedFrom`（中文源文件的 SHA-256）判断译文是否过期，内容没变就跳过；
- 调用 OpenAI 兼容的 Chat Completions 接口翻译，保留代码、表格、公式、Mermaid 和链接结构；
- 把相对 `.md` 链接自动改写为已有的 `.en.md`；
- 生成 `manifest.en.json`（英文标题 / 标签），供站点侧边栏和搜索使用。

在仓库 **Settings → Secrets and variables → Actions** 中添加：

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Secret | `TRANSLATE_API_KEY` | 必填，也可用 `OPENAI_API_KEY`；兼容 OpenAI、DeepSeek、Moonshot 等服务 |
| Variable | `TRANSLATE_API_URL` | 可选，默认 `https://api.openai.com/v1/chat/completions` |
| Variable | `TRANSLATE_MODEL` | 可选，默认 `gpt-4o-mini` |

> [!NOTE]
> 没有配置密钥时，脚本会安全跳过：已有译文继续使用，缺失译文的笔记在英文模式下自动回退中文并提示，不会影响站点发布。

手动执行：

```bash
python3 scripts/translate-notes.py           # 只翻译缺失 / 过期的笔记
python3 scripts/translate-notes.py --force   # 全部重新翻译
python3 scripts/translate-notes.py --check   # 只检查，不写文件
python3 scripts/translate-notes.py --strict  # 缺失 / 过期 / 失败时返回非零状态
```

### 手动维护译文

也可以直接新建 `xxx.en.md`，front matter 至少包含英文 `title`，然后运行：

```bash
python3 scripts/translate-notes.py     # 刷新 manifest.en.json
python3 scripts/update-readme.py       # 刷新 manifest.json 与 README.md / README.en.md
```

> [!IMPORTANT]
> 自动生成的译文带有 `lang: en` 与 `translatedFrom`，请勿手动修改 `translatedFrom`，否则脚本会认为译文过期并重新翻译。

### 站点切换

- 标题栏右侧的 `EN` / `中文` 按钮，以及菜单中的 🌐 项，都可以切换语言；
- 选择会记录在 `localStorage` 的 `ln-lang`，下次打开自动恢复；
- 英文模式会读取 `.en.md`，侧边栏、面包屑、搜索、分页与首页优先使用英文标题；
- 英文缺失时自动显示中文原文，并给出提示。

## 本地预览

浏览器出于安全限制不允许 `file://` 页面读取本地 Markdown。需要本地预览时（与新建笔记无关），在仓库根目录用 macOS 终端启动一个小服务器：

```bash
python3 -m http.server 8080
```

然后打开 <http://localhost:8080/>。换端口时把 `8080` 改成其他数字即可，例如 `python3 -m http.server 8081`。

## 写作支持的语法

| 语法 | 说明 |
| --- | --- |
| 标准 Markdown | 标题、列表、表格、任务列表、脚注式链接等 |
| 代码高亮 | 围栏代码块 + 语言名，自动高亮并带「复制」按钮 |
| Mermaid | 以 ```` ```mermaid ```` 开头的代码块会自动渲染成图表 |
| KaTeX 公式 | 行内 `$E=mc^2$`，块级 `$$ ... $$` |
| 提示块 | `> [!NOTE]`、`[!TIP]`、`[!WARNING]`、`[!IMPORTANT]`、`[!CAUTION]` |
| 相对链接 | `[另一篇](./02-异步与事件循环.md)` 在站内直接跳转 |
| 图片 | 相对路径即可，例如 `![](./images/a.png)` |

> [!WARNING]
> 公式里的 `$` 与代码块中的 `$` 可能冲突；如果某段文字被误识别为公式，用反引号包起来即可。

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库，例如 `learning-notes`，把本项目推上去：

   ```bash
   git init
   git add .
   git commit -m "init: 学习笔记站"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/learning-notes.git
   git push -u origin main
   ```

2. 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`，保存。

3. 稍等 1–2 分钟，访问 `https://<你的用户名>.github.io/learning-notes/`。

4. 如果站点不在 `*.github.io` 根路径，`assets/js/config.js` 里的 `owner` / `repo` 一般可以留空（会自动识别）；本地预览或自定义域名时再手动填写。本项目已按当前仓库填写为 `kaikai7758521/LearnAndLife`。

> [!IMPORTANT]
> 仓库根目录的 `.nojekyll` 必须保留。否则 GitHub Pages 会用 Jekyll 把带 front matter 的 `.md` 转换成 `.html`，前端按 `.md` 路径请求时会 404。

> [!IMPORTANT]
> 首页文件固定为 `README.md`（可在 `config.js` 的 `home` 中修改）。它不会出现在左侧目录里。

## 常用文件

| 路径 | 作用 |
| --- | --- |
| `index.html` | 站点入口（无构建步骤，直接引用 CDN） |
| `site.json` | 站点标题、副标题、品牌图标、页脚文字 |
| `assets/js/config.js` | 仓库信息、首页文件、忽略目录、最近修改开关 |
| `assets/js/app.js` | 目录树、路由、搜索、渲染增强、窗口交互 |
| `assets/css/style.css` | 全部样式、macOS 桌面外观与深色主题 |
| `manifest.json` | 自动生成的笔记索引（请一起提交） |
| `.nojekyll` | 让 GitHub Pages 跳过 Jekyll，原样发布 `.md` 笔记（请勿删除） |
| `.github/workflows/build-manifest.yml` | 推送 `.md` 后自动刷新索引、翻译与 README 目录并提交 |
| `scripts/serve.ps1` | 本地预览服务器（Windows PowerShell 可选；macOS 用 `python3 -m http.server 8080`） |
| `scripts/build-manifest.ps1` | 可选，Windows 下单独生成索引；Action 已由 `update-readme.py` 统一生成 |
| `scripts/translate-notes.py` | 生成 / 更新英文译文与 `manifest.en.json`（由 Action 自动调用，也可本地运行） |
| `scripts/update-readme.py` | 刷新 `manifest.json` 与 README.md / README.en.md 目录（Action 自动调用，也可本地运行） |
| `manifest.en.json` | 自动生成的英文标题 / 标签索引（请一起提交） |
| `README.en.md` | 自动生成的英文首页与目录（请一起提交） |
| `USAGE.md` | 使用说明（本文件） |

## 快捷操作

- 按 `/` 或 `Cmd / Ctrl + K` 聚焦搜索框，`↑` / `↓` 选择结果，回车打开。
- `Cmd / Ctrl + B` 隐藏 / 显示左侧目录；`Esc` 关闭搜索、菜单和移动端目录。
- `Alt + ←` 返回上一页（浏览器自带的返回快捷键同样可用）。
- 标题栏红绿灯：🔴 关闭窗口、🟡 最小化到程序坞、🟢 铺满屏幕；双击标题栏也可以缩放。
- 右侧「本页目录」跟随滚动高亮，点击可跳转锚点。
- 右上角 🌙 / ☀️ 切换深浅主题，选择会记住。

---

祝你记录愉快 ✍️
