/**
 * 站点部署配置
 * ------------------------------------------------------------
 * 站点标题 / 副标题 / 图标 / 页脚文字请修改仓库根目录的 site.json，
 * 这里只保留「部署相关」的配置，刷新页面即可生效（无需构建）。
 *
 * owner / repo 留空时会根据 GitHub Pages 域名自动识别：
 *   https://<owner>.github.io/<repo>/  -> owner=<owner>, repo=<repo>
 *   https://<owner>.github.io/         -> repo=<owner>.github.io
 * 本地预览（localhost）时请手动填写，否则不显示「GitHub / 编辑此页」链接。
 */
window.SITE_CONFIG = {
  // 以下四项是 site.json 读取失败时的兜底值（正常情况下以 site.json 为准）
  title: '我的学习笔记',
  subtitle: '知识沉淀 · 持续更新',
  brandIcon: '📚',
  footer: '持续学习，持续记录',

  // GitHub 仓库信息（留空则根据 *.github.io 域名自动识别）
  owner: 'kaikai7758521',   // 例：'octocat'
  repo: 'LearnAndLife',     // 例：'learning-notes'
  // 分支名（GitHub Pages 通常使用 main 或 master）
  branch: 'main',

  // 首页展示的 Markdown 文件（仓库根目录下）
  home: 'README.md',

  // 生成目录索引时需要忽略的目录（仓库根目录相对路径）
  excludeDirs: ['assets', 'scripts', 'node_modules', '.github', '_site', '.jekyll-cache'],
  // 生成目录索引时需要忽略的文件（仓库相对路径）
  excludeFiles: ['README.md'],

  // 每个页面底部显示「最近修改」日期（数据来自 manifest.json / Git 提交）
  showLastModified: true,
  // 额外通过 GitHub API 读取当前文件的最后一次提交日期（失败时静默回退）
  liveLastModified: true
};
