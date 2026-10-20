/* =====================================================================
 * 我的学习笔记 · 前端逻辑
 * 纯静态、无构建步骤：目录来自 manifest.json，缺失时回退 GitHub API 扫描
 * ===================================================================== */
(function () {
  'use strict';

  var DEFAULTS = {
    title: '我的学习笔记',
    subtitle: '知识沉淀 · 持续更新',
    owner: '',
    repo: '',
    branch: 'main',
    home: 'README.md',
    excludeDirs: ['assets', 'scripts', 'node_modules', '.github'],
    excludeFiles: ['README.md'],
    footer: '持续学习，持续记录'
  };

  var CFG = Object.assign({}, DEFAULTS, window.SITE_CONFIG || {});

  /* ------------------------------------------------------------- 工具函数 */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
  }

  function encodePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
  }

  function normalizePath(path) {
    var parts = String(path).split('/');
    var out = [];
    parts.forEach(function (part) {
      if (!part || part === '.') return;
      if (part === '..') { out.pop(); return; }
      out.push(part);
    });
    return out.join('/');
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* 隐私模式下忽略 */ }
    return null;
  }

  function baseName(path) {
    var idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(idx + 1) : path;
  }

  function dirName(path) {
    var idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(0, idx) : '';
  }

  function stripExt(name) { return name.replace(/\.md$/i, ''); }

  // 去掉 "01-" 之类的排序前缀，仅用于展示
  function displayName(name) {
    var clean = stripExt(name);
    return clean.replace(/^\d+[\s._\-、]+/, '') || clean;
  }

  function sortKey(name) {
    var m = /^(\d+)/.exec(name);
    return { num: m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER, text: name };
  }

  function compareNames(a, b) {
    var ka = sortKey(a.name), kb = sortKey(b.name);
    if (ka.num !== kb.num) return ka.num - kb.num;
    return ka.text.localeCompare(kb.text, 'zh-CN', { numeric: true, sensitivity: 'base' });
  }

  function formatDate(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 10);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function toast(msg, ms) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.hidden = true; }, ms || 1800);
  }

  function scrollTop(smooth) {
    window.scrollTo({ top: 0, behavior: smooth === false ? 'auto' : 'smooth' });
  }

  /* ------------------------------------------------------------- 全局状态 */
  var state = {
    repo: null,
    files: [],
    fileMap: new Map(),
    tree: null,
    flat: [],
    navMap: new Map(),
    expanded: new Set(),
    current: '',
    manifestSource: '',
    corpus: null,
    corpusPromise: null,
    anchor: ''
  };

  try {
    var savedExpanded = JSON.parse(store('ln-expanded') || '[]');
    if (Array.isArray(savedExpanded)) savedExpanded.forEach(function (p) { state.expanded.add(p); });
  } catch (e) { /* ignore */ }

  /* ------------------------------------------------------------- 启动 */
  function init() {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(store('ln-theme') || (prefersDark ? 'dark' : 'light'), true);

    $('#site-title').textContent = CFG.title;
    $('#site-subtitle').textContent = CFG.subtitle;
    $('#foot-text').textContent = CFG.footer;
    document.title = CFG.title;

    state.repo = detectRepo();
    setupRepoLinks();
    bindUi();

    boot().then(function () {
      window.addEventListener('hashchange', handleRoute);
      handleRoute();
      schedulePrefetch();
    });
  }

  function schedulePrefetch() {
    if (!state.files.length) return;
    if (window.requestIdleCallback) {
      window.requestIdleCallback(function () { loadCorpus(); }, { timeout: 4000 });
    } else {
      setTimeout(function () { loadCorpus(); }, 2500);
    }
  }

  async function boot() {
    if (location.protocol === 'file:') {
      renderNavError('本地双击打开无法读取文件（浏览器安全限制）。请在项目目录运行 ' +
        '<code>powershell -ExecutionPolicy Bypass -File scripts/serve.ps1</code>，再访问 http://localhost:8080/');
      return;
    }
    try {
      var manifest = await loadManifest();
      state.files = manifest.files;
      state.manifestSource = manifest.source;
      state.fileMap = new Map();
      state.files.forEach(function (f) { state.fileMap.set(f.path, f); });
      buildIndex();
      renderNav();
      updateNavCount();
    } catch (err) {
      renderNavError(err && err.message ? err.message : String(err));
    }
  }

  function detectRepo() {
    var owner = (CFG.owner || '').trim();
    var repo = (CFG.repo || '').trim();
    if (owner && repo) return { owner: owner, repo: repo };
    if (/(^|\.)github\.io$/i.test(location.hostname)) {
      var autoOwner = location.hostname.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean)[0] || '';
      var autoRepo = seg && seg.indexOf('.') === -1 ? seg : autoOwner + '.github.io';
      return { owner: autoOwner, repo: autoRepo };
    }
    return { owner: owner, repo: repo };
  }

  function setupRepoLinks() {
    var repo = state.repo;
    var known = repo && repo.owner && repo.repo;
    [$('#repo-link'), $('#repo-link-2')].forEach(function (a) {
      if (!a) return;
      if (!known) { a.hidden = true; return; }
      a.hidden = false;
      a.href = 'https://github.com/' + repo.owner + '/' + repo.repo;
    });
  }

  /* ------------------------------------------------------------- 内容索引 */
  async function loadManifest() {
    var errors = [];

    // 1) 仓库内预生成的 manifest.json（推荐：无限流、首屏快）
    try {
      var res = await fetch('./manifest.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        var data = await res.json();
        var files = normalizeFiles(data && data.files);
        if (files.length) return { files: files, source: 'manifest.json' };
        errors.push('manifest.json 中没有可展示的 .md 文件');
      } else {
        errors.push('manifest.json HTTP ' + res.status);
      }
    } catch (e) {
      errors.push('manifest.json: ' + e.message);
    }

    // 2) 回退：GitHub API 递归扫描仓库（尚未配置 Action 时也能用）
    var repo = state.repo;
    if (repo && repo.owner && repo.repo) {
      var branches = [CFG.branch, 'main', 'master'].filter(function (b, i, arr) {
        return b && arr.indexOf(b) === i;
      });
      for (var i = 0; i < branches.length; i++) {
        try {
          var url = 'https://api.github.com/repos/' + encodeURIComponent(repo.owner) + '/' +
            encodeURIComponent(repo.repo) + '/git/trees/' + encodeURIComponent(branches[i]) + '?recursive=1';
          var apiRes = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
          if (apiRes.status === 403 || apiRes.status === 429) {
            throw new Error('GitHub API 访问频率受限，请稍后重试或配置 manifest.json');
          }
          if (!apiRes.ok) { errors.push('GitHub API ' + apiRes.status + ' (' + branches[i] + ')'); continue; }
          var tree = await apiRes.json();
          var list = (tree.tree || []).filter(function (item) {
            return item.type === 'blob' && /\.md$/i.test(item.path);
          }).map(function (item) { return { path: item.path, size: item.size }; });
          var apiFiles = normalizeFiles(list);
          if (apiFiles.length) return { files: apiFiles, source: 'GitHub API (' + branches[i] + ')' };
        } catch (e) {
          errors.push('GitHub API: ' + e.message);
        }
      }
    }

    throw new Error(errors.join('；') || '未找到任何 Markdown 内容');
  }

  function isExcluded(path) {
    if (path === CFG.home) return true;
    if ((CFG.excludeFiles || []).indexOf(path) !== -1) return true;
    if (path.split('/').some(function (p) { return p.charAt(0) === '.'; })) return true;
    var dirs = CFG.excludeDirs || [];
    for (var i = 0; i < dirs.length; i++) {
      if (path === dirs[i] || path.indexOf(dirs[i] + '/') === 0) return true;
    }
    return false;
  }

  function normalizeFiles(list) {
    var out = [];
    var seen = new Set();
    (list || []).forEach(function (item) {
      var rawPath = typeof item === 'string' ? item : (item && (item.path || item.name));
      if (!rawPath) return;
      var path = normalizePath(String(rawPath).replace(/\\/g, '/'));
      if (!path || !/\.md$/i.test(path) || seen.has(path) || isExcluded(path)) return;
      seen.add(path);
      out.push({
        path: path,
        title: (item && item.title) || '',
        date: formatDate(item && (item.date || item.mtime || item.modified)),
        size: (item && item.size) || 0,
        tags: (item && item.tags) || []
      });
    });
    out.sort(function (a, b) {
      return a.path.localeCompare(b.path, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });
    return out;
  }

  /* ------------------------------------------------------------- 目录树 */
  function buildIndex() {
    var root = { name: '', path: '', type: 'dir', children: [] };
    var dirs = new Map([['', root]]);

    state.files.forEach(function (file) {
      var parts = file.path.split('/');
      var parentPath = '';
      parts.forEach(function (part, i) {
        var isFile = i === parts.length - 1;
        var p = parentPath ? parentPath + '/' + part : part;
        var parent = dirs.get(parentPath);
        if (!parent) return;
        var node = null;
        for (var j = 0; j < parent.children.length; j++) {
          if (parent.children[j].name === part) { node = parent.children[j]; break; }
        }
        if (!node) {
          node = isFile
            ? { name: part, path: p, type: 'file', file: file, children: [] }
            : { name: part, path: p, type: 'dir', children: [] };
          parent.children.push(node);
          if (!isFile) dirs.set(p, node);
        }
        parentPath = p;
      });
    });

    sortTree(root);
    state.tree = root;
    state.flat = [];
    collectFiles(root, state.flat);
    state.navMap = new Map();
  }

  function sortTree(node) {
    node.children.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return compareNames(a, b);
    });
    node.children.forEach(function (c) { if (c.type === 'dir') sortTree(c); });
  }

  function collectFiles(node, out) {
    node.children.forEach(function (c) {
      if (c.type === 'file') out.push(c.file);
      else collectFiles(c, out);
    });
  }

  function collectDirs(node, out) {
    node.children.forEach(function (c) {
      if (c.type === 'dir') { out.push(c.path); collectDirs(c, out); }
    });
    return out;
  }

  function countFiles(node) {
    var n = 0;
    node.children.forEach(function (c) {
      if (c.type === 'file') n += 1;
      else n += countFiles(c);
    });
    return n;
  }

  function renderNav() {
    var nav = $('#nav');
    var keepScroll = nav.scrollTop;
    nav.innerHTML = '';

    if (!state.files.length) {
      nav.innerHTML = '<div class="nav-empty">还没有笔记。<br>在仓库新建「学习方向/内容/细节.md」后刷新页面即可。</div>';
      return;
    }

    nav.appendChild(buildList(state.tree.children, 0));
    nav.scrollTop = keepScroll;
    updateActive(state.current);
  }

  function buildList(children, depth) {
    var ul = document.createElement('ul');
    ul.className = depth === 0 ? 'nav-root' : 'nav-list';

    children.forEach(function (node) {
      var li = document.createElement('li');

      if (node.type === 'dir') {
        var open = state.expanded.has(node.path);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-dir';
        btn.dataset.path = node.path;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.title = node.path;
        btn.innerHTML = '<span class="chev">▸</span>' +
          '<span class="nav-label">' + escapeHtml(displayName(node.name)) + '</span>' +
          '<span class="nav-count">' + countFiles(node) + '</span>';
        li.appendChild(btn);
        li.appendChild(buildList(node.children, depth + 1));
      } else {
        var a = document.createElement('a');
        a.className = 'nav-file';
        a.href = toHash(node.path);
        a.dataset.path = node.path;
        a.title = node.path;
        a.innerHTML = '<span class="nav-label">' +
          escapeHtml((node.file && node.file.title) || displayName(node.name)) + '</span>';
        li.appendChild(a);
        state.navMap.set(node.path, a);
      }

      ul.appendChild(li);
    });

    return ul;
  }

  function updateNavCount() {
    var el = $('#nav-count');
    if (!el) return;
    if (!state.files.length) { el.textContent = ''; return; }
    var dirs = collectDirs(state.tree, []);
    el.textContent = state.files.length + ' 篇笔记 · ' + dirs.length + ' 个目录';
  }

  function renderNavError(message) {
    var nav = $('#nav');
    nav.innerHTML = '<div class="nav-error">目录加载失败：' + escapeHtml(message) + '<br><br>' +
      '<button type="button" class="btn" id="nav-retry">重新加载</button></div>';
    var retry = $('#nav-retry');
    if (retry) retry.addEventListener('click', function () { location.reload(); });
  }

  function persistExpanded() {
    store('ln-expanded', JSON.stringify(Array.from(state.expanded)));
  }

  function expandAncestors(path) {
    var parts = path.split('/');
    var changed = false;
    for (var i = 1; i < parts.length; i++) {
      var dir = parts.slice(0, i).join('/');
      if (!state.expanded.has(dir)) { state.expanded.add(dir); changed = true; }
    }
    if (changed) { persistExpanded(); renderNav(); }
  }

  function toggleDir(path) {
    if (state.expanded.has(path)) state.expanded.delete(path);
    else state.expanded.add(path);
    persistExpanded();
    renderNav();
  }

  function toggleExpandAll() {
    var all = collectDirs(state.tree || { children: [] }, []);
    var allOpen = all.length > 0 && all.every(function (p) { return state.expanded.has(p); });
    if (allOpen) state.expanded.clear();
    else all.forEach(function (p) { state.expanded.add(p); });
    persistExpanded();
    renderNav();
    var btn = $('#expand-btn');
    if (btn) btn.textContent = allOpen ? '展开全部' : '收起全部';
  }

  function updateActive(path) {
    state.navMap.forEach(function (el, p) {
      if (p === path) el.classList.add('active');
      else el.classList.remove('active');
    });
    var active = state.navMap.get(path);
    var nav = $('#nav');
    if (!active || !nav) return;
    var rect = active.getBoundingClientRect();
    var navRect = nav.getBoundingClientRect();
    if (rect.top < navRect.top + 8 || rect.bottom > navRect.bottom - 8) {
      nav.scrollTop += rect.top - navRect.top - nav.clientHeight / 2;
    }
  }

  /* ------------------------------------------------------------- 路由 */
  function toHash(path, anchor) {
    var h = '#/' + encodePath(path || '');
    if (anchor) h += '@' + encodeURIComponent(anchor);
    return h;
  }

  function parseRoute() {
    var raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { path: '', anchor: '' };
    var at = raw.indexOf('@');
    var rawPath = at >= 0 ? raw.slice(0, at) : raw;
    var anchor = at >= 0 ? safeDecode(raw.slice(at + 1)) : '';
    return {
      path: normalizePath(rawPath.split('/').map(safeDecode).join('/')),
      anchor: anchor
    };
  }

  async function handleRoute() {
    var route = parseRoute();
    closeSidebar();
    hideSearch(true);

    if (!route.path) { await renderHome(route.anchor); return; }
    if (route.path === state.current) {
      if (route.anchor) scrollToAnchor(route.anchor);
      return;
    }
    await openNote(route.path, route.anchor);
  }

  function skeletonHtml() {
    return '<div class="skeleton"><span></span><span></span><span></span><span></span></div>';
  }

  async function renderHome(anchor) {
    state.current = '';
    state.anchor = anchor || '';
    updateActive('');
    setBreadcrumb('');
    $('#pager').innerHTML = '';
    $('#toc').innerHTML = '';
    $('#edit-link').hidden = true;
    document.title = CFG.title;

    var article = $('#article');
    article.classList.add('home');
    article.innerHTML = skeletonHtml();

    var text = '';
    try {
      var res = await fetch('./' + encodePath(CFG.home), { cache: 'no-store' });
      if (res.ok) text = await res.text();
    } catch (e) { /* 忽略，使用内置首页 */ }

    if (!text) {
      article.innerHTML = builtinHome();
      if (state.anchor) scrollToAnchor(state.anchor);
      return;
    }
    renderInto(text, CFG.home, { isHome: true });
    appendHomePanels();
    if (state.anchor) scrollToAnchor(state.anchor);
  }

  async function openNote(path, anchor) {
    state.current = path;
    state.anchor = anchor || '';
    expandAncestors(path);
    updateActive(path);

    var article = $('#article');
    article.classList.remove('home');
    article.innerHTML = skeletonHtml();
    $('#pager').innerHTML = '';
    $('#toc').innerHTML = '';
    $('#edit-link').hidden = true;
    setBreadcrumb(path);
    scrollTop(false);

    try {
      var res = await fetch('./' + encodePath(path), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      renderInto(text, path, { isHome: false });
      if (state.anchor) scrollToAnchor(state.anchor);
    } catch (e) {
      renderNotFound(path, e);
    }
  }

  function setBreadcrumb(path) {
    var el = $('#breadcrumb');
    if (!el) return;
    if (!path) { el.innerHTML = '<span class="current">首页</span>'; return; }
    var parts = path.split('/');
    var html = '<a href="#/">首页</a>';
    parts.forEach(function (part, i) {
      var last = i === parts.length - 1;
      var label = last ? displayName(part) : part;
      html += '<span class="sep">/</span>' +
        (last ? '<span class="current">' : '<span>') + escapeHtml(label) + '</span>';
    });
    el.innerHTML = html;
  }

  function renderPager(path) {
    var el = $('#pager');
    if (!el) return;
    el.innerHTML = '';
    if (!state.flat.length) return;
    var idx = -1;
    for (var i = 0; i < state.flat.length; i++) {
      if (state.flat[i].path === path) { idx = i; break; }
    }
    if (idx < 0) return;
    var prev = state.flat[idx - 1];
    var next = state.flat[idx + 1];
    el.appendChild(prev ? pagerLink(prev, '上一篇', 'prev') : document.createElement('span'));
    if (next) el.appendChild(pagerLink(next, '下一篇', 'next'));
  }

  function pagerLink(file, label, cls) {
    var a = document.createElement('a');
    a.href = toHash(file.path);
    a.className = cls;
    a.innerHTML = '<span class="dir">' + label + ' · ' + escapeHtml(dirName(file.path) || '根目录') + '</span>' +
      '<span class="name">' + escapeHtml(file.title || displayName(baseName(file.path))) + '</span>';
    return a;
  }

  function updateEditLink(path) {
    var a = $('#edit-link');
    if (!a) return;
    var repo = state.repo;
    if (!path || path === CFG.home || !repo || !repo.owner || !repo.repo) { a.hidden = true; return; }
    a.hidden = false;
    a.href = 'https://github.com/' + repo.owner + '/' + repo.repo + '/edit/' +
      CFG.branch + '/' + encodePath(path);
  }

  function scrollToAnchor(id) {
    if (!id) return;
    var target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('flash');
    setTimeout(function () { target.classList.remove('flash'); }, 1200);
  }

  function renderNotFound(path, err) {
    var article = $('#article');
    article.classList.remove('home');
    var repo = state.repo;
    var gh = '';
    if (repo && repo.owner && repo.repo) {
      gh = '<p><a class="btn" target="_blank" rel="noopener" href="https://github.com/' +
        repo.owner + '/' + repo.repo + '/blob/' + CFG.branch + '/' + encodePath(path) +
        '">在 GitHub 查看该文件</a></p>';
    }
    var hint = state.files.length ? '' :
      '<p>目录索引为空，若是刚建的仓库，请等待一次 GitHub Action 运行完成，或手动执行 ' +
      '<code>scripts/build-manifest.ps1</code> 后提交 <code>manifest.json</code>。</p>';
    article.innerHTML = '<div class="state-box"><h2>找不到这篇笔记</h2>' +
      '<p>路径：<code>' + escapeHtml(path) + '</code>' + (err && err.message ? '（' + escapeHtml(err.message) + '）' : '') + '</p>' +
      '<p>可能原因：文件被重命名、还没有推送到仓库，或 <code>manifest.json</code> 索引尚未更新。</p>' +
      hint +
      '<div class="actions"><a class="btn primary" href="#/">返回首页</a>' +
      '<button type="button" class="btn" id="retry-note">重试</button></div>' + gh + '</div>';
    var retry = $('#retry-note');
    if (retry) retry.addEventListener('click', function () { openNote(path, state.anchor); });
    document.title = '未找到 · ' + CFG.title;
    setBreadcrumb(path);
  }

  /* ------------------------------------------------------------- 渲染正文 */
  function renderInto(markdown, path, opts) {
    opts = opts || {};
    var article = $('#article');
    var parsed = splitFrontMatter(markdown);
    var title = parsed.data.title || displayName(baseName(path));
    article.classList.toggle('home', !!opts.isHome);

    if (!window.marked) {
      article.innerHTML = '<div class="state-box"><h2>Markdown 渲染库未加载</h2>' +
        '<p>请检查能否访问 <code>cdn.jsdelivr.net</code>（公司网络 / 离线环境可能被拦截），' +
        '或把这些依赖下载到本地后修改 <code>index.html</code> 中的引用地址。</p>' +
        '<pre>' + escapeHtml(parsed.body.slice(0, 2000)) + '</pre></div>';
      return;
    }

    var html;
    try {
      html = window.marked.parse(parsed.body, { gfm: true, breaks: false });
    } catch (e) {
      article.innerHTML = '<div class="state-box"><h2>Markdown 解析失败</h2><p>' +
        escapeHtml(e.message) + '</p></div>';
      return;
    }
    article.innerHTML = html;

    var linkPath = opts.isHome ? '' : path;
    decorateHeadings(article, linkPath);
    decorateAlerts(article);
    decorateTables(article);
    resolveLinks(article, path);
    enhanceMermaid(article);
    enhanceCode(article);
    enhanceMath(article);
    buildToc(article, linkPath);
    renderMeta(article, parsed.data);

    if (!opts.isHome) {
      document.title = title + ' · ' + CFG.title;
      setBreadcrumb(path);
      renderPager(path);
      updateEditLink(path);
    } else {
      document.title = CFG.title;
    }
  }

  function splitFrontMatter(text) {
    var data = {};
    var body = String(text || '');
    var match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
    if (!match) return { data: data, body: body };

    match[1].split(/\r?\n/).forEach(function (line) {
      var m = /^\s*([A-Za-z0-9_\-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) return;
      var value = m[2].trim().replace(/^["']|["']$/g, '');
      if (value.charAt(0) === '[' && value.charAt(value.length - 1) === ']') {
        value = value.slice(1, -1).split(',').map(function (s) {
          return s.trim().replace(/^["']|["']$/g, '');
        }).filter(Boolean);
      }
      data[m[1]] = value;
    });

    return { data: data, body: body.slice(match[0].length) };
  }

  var CALENDAR_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    '<path fill="currentColor" d="M5 1a.5.5 0 0 1 .5.5V2h5v-.5a.5.5 0 0 1 1 0V2h1.5A1.5 1.5 0 0 1 14.5 3.5v10A1.5 1.5 0 0 1 13 15H3A1.5 1.5 0 0 1 1.5 13.5v-10A1.5 1.5 0 0 1 3 2h1.5v-.5A.5.5 0 0 1 5 1zM2.5 6v7.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V6h-11z"/>' +
    '</svg>';

  function renderMeta(article, fm) {
    var bits = [];
    if (fm.date) bits.push('<span class="meta-item">' + CALENDAR_ICON + escapeHtml(formatDate(fm.date)) + '</span>');
    if (fm.tags && fm.tags.length) {
      var tags = Array.isArray(fm.tags) ? fm.tags : String(fm.tags).split(/[,，\s]+/).filter(Boolean);
      if (tags.length) {
        bits.push('<span class="meta-tags">' + tags.map(function (t) {
          return '<span class="tag">' + escapeHtml(t) + '</span>';
        }).join('') + '</span>');
      }
    }
    if (!bits.length) return;
    var div = document.createElement('div');
    div.className = 'note-meta';
    div.innerHTML = bits.join('');
    article.insertBefore(div, article.firstChild);
  }

  /* ------------------------------------------------------------- 标题 / 目录 */
  function slugify(text) {
    return String(text).trim().toLowerCase()
      .replace(/[\s\u00a0]+/g, '-')
      .replace(/[!-,\.\/:-@\[-`{-~！-～、。，；：“”‘’（）【】《》〈〉〔〕…—·]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function decorateHeadings(article, path) {
    var heads = $$('h1, h2, h3, h4', article);
    var used = Object.create(null);
    heads.forEach(function (h) {
      var base = slugify(h.textContent) || 'section';
      var id = base;
      var n = 2;
      while (used[id]) { id = base + '-' + n; n += 1; }
      used[id] = true;
      h.id = id;

      var a = document.createElement('a');
      a.className = 'anchor';
      a.href = toHash(path, id);
      a.setAttribute('aria-label', '本节链接');
      a.title = '本节链接';
      a.textContent = '#';
      h.appendChild(a);
    });
  }

  var tocObserver = null;

  function buildToc(article, path) {
    var toc = $('#toc');
    if (!toc) return;
    toc.innerHTML = '';

    var heads = $$('h2, h3', article).filter(function (h) { return h.id; });
    if (!heads.length) {
      toc.innerHTML = '<div class="toc-empty">本页暂无小节</div>';
      return;
    }

    var ul = document.createElement('ul');
    heads.forEach(function (h) {
      var li = document.createElement('li');
      li.className = 'lvl-' + h.tagName.charAt(1);
      var a = document.createElement('a');
      a.href = toHash(path, h.id);
      a.textContent = h.textContent.replace(/#\s*$/, '').trim();
      a.dataset.target = h.id;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        state.anchor = h.id;
        if (window.history && history.replaceState) {
          history.replaceState(null, '', toHash(path, h.id));
        }
        scrollToAnchor(h.id);
      });
      li.appendChild(a);
      ul.appendChild(li);
    });
    toc.appendChild(ul);

    setupTocObserver(heads);
  }

  function setupTocObserver(heads) {
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    if (!('IntersectionObserver' in window)) return;

    var links = Object.create(null);
    $$('#toc a').forEach(function (a) { links[a.dataset.target] = a; });
    var visible = new Set();

    tocObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      var activeId = '';
      for (var i = 0; i < heads.length; i++) {
        if (visible.has(heads[i].id)) { activeId = heads[i].id; break; }
      }
      if (!activeId) {
        for (var j = 0; j < heads.length; j++) {
          if (heads[j].getBoundingClientRect().top < window.innerHeight * 0.35) activeId = heads[j].id;
        }
      }
      if (!activeId) return;
      Object.keys(links).forEach(function (id) {
        links[id].classList.toggle('active', id === activeId);
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

    heads.forEach(function (h) { tocObserver.observe(h); });
  }

  /* ------------------------------------------------------------- 内容装饰 */
  function decorateAlerts(article) {
    var icons = { NOTE: 'ℹ️', TIP: '💡', IMPORTANT: '📌', WARNING: '⚠️', CAUTION: '🚫' };
    var labels = { NOTE: '提示', TIP: '技巧', IMPORTANT: '重要', WARNING: '注意', CAUTION: '警告' };

    $$('blockquote', article).forEach(function (bq) {
      var first = bq.querySelector('p');
      if (!first) return;
      var m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(first.textContent.trim());
      if (!m) return;
      var type = m[1].toUpperCase();
      first.innerHTML = first.innerHTML.replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i, '');
      bq.classList.add('alert', 'alert-' + type.toLowerCase());

      var label = document.createElement('span');
      label.className = 'alert-title';
      label.textContent = icons[type] + ' ' + labels[type];
      bq.insertBefore(label, bq.firstChild);
    });
  }

  function decorateTables(article) {
    $$('table', article).forEach(function (table) {
      if (table.parentElement && table.parentElement.classList.contains('table-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  function resolveLinks(article, notePath) {
    var dir = dirName(notePath);
    var dirPrefix = dir ? dir + '/' : '';

    $$('a[href]', article).forEach(function (a) {
      if (a.classList.contains('anchor')) return;
      var raw = a.getAttribute('href') || '';
      if (!raw) return;

      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.indexOf('//') === 0) {
        if (/^https?:/i.test(raw)) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        return;
      }

      if (raw.charAt(0) === '#') {
        a.setAttribute('href', toHash(notePath, safeDecode(raw.slice(1))));
        return;
      }

      var idx = raw.indexOf('#');
      var filePart = idx >= 0 ? raw.slice(0, idx) : raw;
      var anchor = idx >= 0 ? safeDecode(raw.slice(idx + 1)) : '';
      var target = normalizePath(dirPrefix + decodeURISafe(filePart));

      if (/\.md$/i.test(target)) {
        a.setAttribute('href', toHash(target, anchor));
        a.classList.add('internal-link');
      } else {
        a.setAttribute('href', './' + encodePath(target) + (anchor ? '#' + encodeURIComponent(anchor) : ''));
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    });

    $$('img[src]', article).forEach(function (img) {
      var raw = img.getAttribute('src') || '';
      if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.indexOf('//') === 0) return;
      var target = normalizePath(dirPrefix + decodeURISafe(raw));
      img.setAttribute('src', './' + encodePath(target));
      img.loading = 'lazy';
      img.addEventListener('error', function () { img.classList.add('img-error'); });
    });
  }

  function decodeURISafe(str) {
    try { return decodeURI(str); } catch (e) { return str; }
  }

  /* ------------------------------------------------------------- 代码 / 图表 / 公式 */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function enhanceCode(article) {
    $$('pre', article).forEach(function (pre) {
      var code = pre.querySelector('code');
      if (!code) return;
      if (/language-mermaid/i.test(code.className || '')) return;

      if (window.hljs) {
        try { window.hljs.highlightElement(code); } catch (e) { /* 忽略单块高亮失败 */ }
      }
      if (pre.querySelector('.copy-btn')) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.textContent = '复制';
      btn.addEventListener('click', function () {
        copyText(code.textContent).then(function (ok) {
          btn.textContent = ok ? '已复制' : '复制失败';
          if (ok) btn.classList.add('copied');
          setTimeout(function () {
            btn.textContent = '复制';
            btn.classList.remove('copied');
          }, 1500);
        });
      });
      pre.appendChild(btn);
    });
  }

  function mermaidTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
  }

  function initMermaid() {
    if (!window.mermaid) return false;
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: mermaidTheme(),
        flowchart: { htmlLabels: true, useMaxWidth: true },
        sequence: { useMaxWidth: true }
      });
      return true;
    } catch (e) { return false; }
  }

  async function enhanceMermaid(article) {
    var blocks = $$('pre > code', article).filter(function (code) {
      return /language-mermaid/i.test(code.className || '');
    });
    if (!blocks.length || !initMermaid()) return;

    for (var i = 0; i < blocks.length; i++) {
      var code = blocks[i];
      var pre = code.parentElement;
      var src = code.textContent;
      var holder = document.createElement('div');
      holder.className = 'mermaid-block';
      holder.dataset.src = src;
      var target = document.createElement('div');
      target.className = 'mermaid';
      holder.appendChild(target);
      pre.parentNode.replaceChild(holder, pre);

      try {
        var result = await window.mermaid.render('mmd-' + Math.random().toString(36).slice(2), src);
        target.innerHTML = result.svg;
      } catch (e) {
        target.innerHTML = '<p class="mermaid-error">图表渲染失败：' +
          escapeHtml(e && e.message ? e.message : String(e)) + '</p>';
      }
    }
  }

  async function rerenderMermaid() {
    var holders = $$('.mermaid-block');
    if (!holders.length || !initMermaid()) return;
    for (var i = 0; i < holders.length; i++) {
      var holder = holders[i];
      var target = holder.querySelector('.mermaid');
      if (!target) continue;
      try {
        var result = await window.mermaid.render('mmd-' + Math.random().toString(36).slice(2), holder.dataset.src || '');
        target.innerHTML = result.svg;
      } catch (e) { /* 保留当前图 */ }
    }
  }

  function enhanceMath(article) {
    if (!window.renderMathInElement) return;
    try {
      window.renderMathInElement(article, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'img']
      });
    } catch (e) { /* 公式渲染失败时保留原文 */ }
  }

  /* ------------------------------------------------------------- 首页扩展 */
  function firstFile(node) {
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (child.type === 'file') return child.file;
      var nested = firstFile(child);
      if (nested) return nested;
    }
    return null;
  }

  function appendHomePanels() {
    var prev = $('#home-panels');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    if (!state.files.length || !state.tree) return;

    var main = $('#main');
    var foot = $('.page-foot', main);
    if (!main || !foot) return;

    var dirs = collectDirs(state.tree, []);
    var topDirs = state.tree.children.filter(function (c) { return c.type === 'dir'; });
    var dated = state.files.filter(function (f) { return f.date; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    var latest = dated.length ? dated[0].date : '';

    var panels = document.createElement('div');
    panels.id = 'home-panels';
    panels.className = 'home-panels';

    var html = '<h2>内容概览</h2><div class="stat-row">' +
      '<div class="stat-card"><span class="num">' + state.files.length + '</span><span class="label">篇笔记</span></div>' +
      '<div class="stat-card"><span class="num">' + topDirs.length + '</span><span class="label">个学习方向</span></div>' +
      '<div class="stat-card"><span class="num">' + dirs.length + '</span><span class="label">个分类目录</span></div>' +
      '<div class="stat-card"><span class="num" style="font-size:18px">' + (latest || '—') +
      '</span><span class="label">最近更新</span></div>' +
      '</div>';

    if (topDirs.length) {
      html += '<h2>学习方向</h2><div class="dir-chips">';
      topDirs.forEach(function (dir) {
        var first = firstFile(dir);
        html += '<a class="dir-chip" href="' + (first ? toHash(first.path) : '#/') + '">' +
          escapeHtml(displayName(dir.name)) + '<span class="count">' + countFiles(dir) + ' 篇</span></a>';
      });
      html += '</div>';
    }

    if (dated.length) {
      html += '<h2>最近更新</h2><ul class="recent-list">';
      dated.slice(0, 8).forEach(function (f) {
        html += '<li><span class="r-date">' + escapeHtml(f.date) + '</span><span>' +
          '<a class="r-title" href="' + toHash(f.path) + '">' +
          escapeHtml(f.title || displayName(baseName(f.path))) + '</a>' +
          '<span class="r-path">' + escapeHtml(dirName(f.path) || '根目录') + '</span></span></li>';
      });
      html += '</ul>';
    }

    panels.innerHTML = html;
    main.insertBefore(panels, foot);
  }

  function builtinHome() {
    var repo = state.repo || {};
    var url = repo.owner && repo.repo ? 'https://github.com/' + repo.owner + '/' + repo.repo : '';
    return '<div class="state-box"><h2>欢迎使用你的学习笔记站</h2>' +
      '<p>首页文件 <code>' + escapeHtml(CFG.home) + '</code> 暂时没有读取到，但不影响浏览笔记。</p>' +
      '<ol>' +
      '<li>在仓库中按 <code>学习方向/内容/细节.md</code> 新建 Markdown 文件；</li>' +
      '<li>运行 <code>scripts/build-manifest.ps1</code>（或等待 GitHub Action）更新索引；</li>' +
      '<li>刷新页面即可在左侧目录看到新笔记。</li>' +
      '</ol>' +
      (url ? '<p><a class="btn primary" href="' + url + '" target="_blank" rel="noopener">打开 GitHub 仓库</a></p>' : '') +
      '</div>';
  }

  /* ------------------------------------------------------------- 主题 / 交互 */
  function applyTheme(theme, initial) {
    var mode = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    if (!initial) store('ln-theme', mode);

    var light = $('#hljs-light');
    var darkLink = $('#hljs-dark');
    if (light) light.disabled = mode === 'dark';
    if (darkLink) darkLink.disabled = mode !== 'dark';

    var btn = $('#theme-btn');
    if (btn) {
      btn.textContent = mode === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', mode === 'dark' ? '切换到浅色主题' : '切换到深色主题');
    }
    if (!initial) rerenderMermaid();
  }

  function toggleSidebar(force) {
    var open = typeof force === 'boolean' ? force : !document.body.classList.contains('sidebar-open');
    document.body.classList.toggle('sidebar-open', open);

    var overlay = $('#overlay');
    if (overlay) overlay.hidden = !open;

    var btn = $('#menu-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? '关闭目录' : '打开目录');
    }
  }

  function closeSidebar() { toggleSidebar(false); }

  function onNavClick(e) {
    var dirBtn = e.target.closest ? e.target.closest('.nav-dir') : null;
    if (dirBtn) { toggleDir(dirBtn.dataset.path); return; }
    var fileLink = e.target.closest ? e.target.closest('.nav-file') : null;
    if (fileLink) closeSidebar();
  }

  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var pct = max > 0 ? (window.pageYOffset / max) * 100 : 0;
    var bar = $('#progress');
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    var top = $('#top-btn');
    if (top) top.hidden = window.pageYOffset < 420;
  }

  function bindUi() {
    var menuBtn = $('#menu-btn');
    if (menuBtn) menuBtn.addEventListener('click', function () { toggleSidebar(); });

    var overlay = $('#overlay');
    if (overlay) overlay.addEventListener('click', closeSidebar);

    var themeBtn = $('#theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      });
    }

    var expandBtn = $('#expand-btn');
    if (expandBtn) expandBtn.addEventListener('click', toggleExpandAll);

    var topBtn = $('#top-btn');
    if (topBtn) topBtn.addEventListener('click', function () { scrollTop(); });

    var nav = $('#nav');
    if (nav) nav.addEventListener('click', onNavClick);

    var search = $('#search');
    if (search) {
      var onInput = debounce(function () { runSearch(search.value); }, 220);
      search.addEventListener('input', onInput);
      search.addEventListener('focus', function () { runSearch(search.value); });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var first = $('#search-results .search-item');
          if (first) { e.preventDefault(); first.click(); }
        }
        if (e.key === 'Escape') { search.value = ''; hideSearch(true); search.blur(); }
      });
    }

    document.addEventListener('click', function (e) {
      var wrap = $('.search-wrap');
      if (wrap && !wrap.contains(e.target)) hideSearch(false);
    });

    document.addEventListener('keydown', function (e) {
      var active = document.activeElement;
      var tag = active ? active.tagName : '';
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (active && active.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        if (search) { search.focus(); search.select(); }
      }
      if (e.key === 'Escape') closeSidebar();
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', debounce(onScroll, 150));
    onScroll();
  }

  /* ------------------------------------------------------------- 搜索 */
  function searchableText(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(^|\s)#{1,6}\s+/g, ' ')
      .replace(/[*_~>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function loadCorpus() {
    if (state.corpusPromise) return state.corpusPromise;
    state.corpusPromise = Promise.all(state.files.map(function (file) {
      return fetch('./' + encodePath(file.path), { cache: 'force-cache' })
        .then(function (res) { return res.ok ? res.text() : ''; })
        .then(function (text) {
          return { file: file, text: searchableText(splitFrontMatter(text).body) };
        })
        .catch(function () { return { file: file, text: '' }; });
    })).then(function (items) {
      state.corpus = items;
      return items;
    }).catch(function () {
      state.corpusPromise = null;
      return [];
    });
    return state.corpusPromise;
  }

  function matchCorpus(corpus, lower) {
    var out = [];
    for (var i = 0; i < corpus.length && out.length < 12; i++) {
      var item = corpus[i];
      if (!item.text) continue;
      var idx = item.text.toLowerCase().indexOf(lower);
      if (idx < 0) continue;
      var start = Math.max(0, idx - 40);
      var end = Math.min(item.text.length, idx + lower.length + 70);
      out.push({
        file: item.file,
        snippet: (start > 0 ? '…' : '') + item.text.slice(start, end) + (end < item.text.length ? '…' : '')
      });
    }
    return out;
  }

  function highlightText(text, query) {
    var escaped = escapeHtml(text);
    var needle = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!needle) return escaped;
    try {
      return escaped.replace(new RegExp('(' + needle + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) { return escaped; }
  }

  function renderSearch(panel, query, titleHits, textHits, loading) {
    var titlePaths = new Set(titleHits.map(function (f) { return f.path; }));
    var html = '';

    if (titleHits.length) {
      html += '<div class="search-group-title">标题 / 路径匹配 · ' + titleHits.length + '</div>';
      titleHits.slice(0, 20).forEach(function (f) {
        var title = f.title || displayName(baseName(f.path));
        html += '<a class="search-item" href="' + toHash(f.path) + '">' +
          '<span class="si-title">' + highlightText(title, query) + '</span>' +
          '<span class="si-path">' + highlightText(f.path, query) + '</span></a>';
      });
    }

    var bodyHits = textHits.filter(function (hit) { return !titlePaths.has(hit.file.path); });
    if (bodyHits.length) {
      html += '<div class="search-group-title">正文匹配 · ' + bodyHits.length + '</div>';
      bodyHits.forEach(function (hit) {
        var f = hit.file;
        var title = f.title || displayName(baseName(f.path));
        html += '<a class="search-item" href="' + toHash(f.path) + '">' +
          '<span class="si-title">' + highlightText(title, query) + '</span>' +
          '<span class="si-snippet">' + highlightText(hit.snippet, query) + '</span></a>';
      });
    }

    if (!html) {
      html = '<div class="search-empty">没有找到与「' + escapeHtml(query) + '」相关的笔记</div>';
    }
    if (loading && !bodyHits.length) {
      html += '<div class="search-hint">正在检索全文…</div>';
    }

    panel.innerHTML = html;
    panel.hidden = false;
    $$('.search-item', panel).forEach(function (item) {
      item.addEventListener('click', function () { hideSearch(true); });
    });
  }

  async function runSearch(raw) {
    var query = String(raw || '').trim();
    var panel = $('#search-results');
    var input = $('#search');
    if (!panel || !input) return;
    if (!query) { hideSearch(false); return; }

    var lower = query.toLowerCase();
    var titleHits = state.files.filter(function (f) {
      var title = f.title || displayName(baseName(f.path));
      return title.toLowerCase().indexOf(lower) !== -1 || f.path.toLowerCase().indexOf(lower) !== -1;
    });

    var textHits = state.corpus ? matchCorpus(state.corpus, lower) : [];
    renderSearch(panel, query, titleHits, textHits, !state.corpus);

    if (!state.files.length) return;
    var corpus = await loadCorpus();
    if (!input.value.trim() || input.value.trim() !== query) return;
    if (!corpus.length) return;
    renderSearch(panel, query, titleHits, matchCorpus(corpus, lower), false);
  }

  function hideSearch(clearInput) {
    var panel = $('#search-results');
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
    if (clearInput) {
      var input = $('#search');
      if (input) input.value = '';
    }
  }



  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
