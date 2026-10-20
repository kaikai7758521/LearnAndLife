/**
 * 站点配置
 * ------------------------------------------------------------
 * 只需要按需修改这里，刷新页面即可生效（无需构建）。
 * owner / repo 留空时会根据 GitHub Pages 域名自动识别：
 *   https://<owner>.github.io/<repo>/  -> owner=<owner>, repo=<repo>
 *   https://<owner>.github.io/         -> repo=<owner>.github.io
 * 本地预览（localhost）时请手动填写，否则不显示「GitHub / 编辑此页」链接。
 */
window.SITE_CONFIG = {
  // 站点标题（显示在左上角与浏览器标签页）
  title: '我的学习笔记',
  // 副标题
  subtitle: '知识沉淀 · 持续更新',

  // GitHub 仓库信息（留空则自动识别）
  owner: '',   // 例：'octocat'
  repo: '',    // 例：'learning-notes'
  // 分支名（GitHub Pages 通常使用 main 或 master）
  branch: 'main',

  // 首页展示的 Markdown 文件（仓库根目录下）
  home: 'README.md',

  // 生成目录索引时需要忽略的目录（仓库根目录相对路径）
  excludeDirs: ['assets', 'scripts', 'node_modules', '.github'],
  // 生成目录索引时需要忽略的文件（仓库相对路径）
  excludeFiles: ['README.md'],

  // 页脚文字
  footer: '持续学习，持续记录'
};
