# 📚 我的学习笔记

按 **学习方向 / 内容 / 细节** 组织 Markdown 笔记，自动生成目录的纯静态站点。
没有构建步骤、没有依赖安装：把 `.md` 文件放进仓库，推送到 GitHub，Pages 就会自动更新。

> [!TIP]
> 侧边栏目录来自 `manifest.json`；它既可以在本地用脚本生成，也会由 GitHub Action 在每次推送后自动刷新。

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

## 新建一篇笔记

任选一种方式：

1. **命令行（推荐）**

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/new-note.ps1 -Direction 前端 -Topic JavaScript -Name 闭包
   ```

2. **手动新建文件**，然后在笔记开头写上 front matter（可选）：

   ```markdown
   ---
   title: 闭包
   date: 2026-10-21
   tags: [JavaScript, 基础]
   ---

   # 闭包

   正文……
   ```

3. **写完刷新索引**

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/build-manifest.ps1
   ```

   > 推送到 GitHub 后，Action 会自动执行同样的脚本，无需手动运行。

## 本地预览

浏览器出于安全限制不允许 `file://` 页面读取本地 Markdown，所以本地预览需要一个小服务器：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

然后打开 <http://localhost:8080/>。换端口：`-Port 8081`。

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

   ```powershell
   git init
   git add .
   git commit -m "init: 学习笔记站"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/learning-notes.git
   git push -u origin main
   ```

2. 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`，保存。

3. 稍等 1–2 分钟，访问 `https://<你的用户名>.github.io/learning-notes/`。

4. 如果站点不在 `*.github.io` 根路径，`assets/js/config.js` 里的 `owner` / `repo` 一般可以留空（会自动识别）；本地预览或自定义域名时再手动填写。

> [!IMPORTANT]
> 首页文件固定为 `README.md`（可在 `config.js` 的 `home` 中修改）。它不会出现在左侧目录里。

## 常用文件

| 路径 | 作用 |
| --- | --- |
| `index.html` | 站点入口（无构建步骤，直接引用 CDN） |
| `assets/js/config.js` | 站点标题、仓库信息、首页文件、忽略目录 |
| `assets/js/app.js` | 目录树、路由、搜索、渲染增强 |
| `assets/css/style.css` | 全部样式与深色主题 |
| `manifest.json` | 自动生成的笔记索引（请一起提交） |
| `scripts/serve.ps1` | 本地预览服务器 |
| `scripts/build-manifest.ps1` | 重新生成 `manifest.json` |
| `scripts/new-note.ps1` | 新建笔记模板 |

## 快捷操作

- 按 `/` 聚焦搜索框，回车打开第一条结果。
- `Esc` 清空搜索 / 关闭移动端目录。
- 右侧「本页目录」跟随滚动高亮，点击可复制式跳转锚点。
- 右上角 🌙 / ☀️ 切换深浅主题，选择会记住。

---

祝你记录愉快 ✍️
