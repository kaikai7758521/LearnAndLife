/* =====================================================================
 * 我的学习笔记 · 前端逻辑（macOS 桌面风格）
 * 纯静态、无构建步骤：
 *   - 站点标题等外观配置来自 site.json（见 assets/js/config.js 说明）
 *   - 目录来自 manifest.json，缺失时回退 GitHub API 扫描
 *   - 每篇笔记的图标由文件名哈希生成，可在 front matter 用 icon 覆盖
 *   - 页面底部显示「最近更新」日期（manifest / Git 提交）
 * ===================================================================== */
(function () {
  'use strict';

  var DEFAULTS = {
    title: '我的学习笔记',
    subtitle: '知识沉淀 · 持续更新',
    brandIcon: '📚',
    footer: '持续学习，持续记录',
    titleEn: 'My Learning Notes',
    subtitleEn: 'Notes that grow with me',
    footerEn: 'Keep learning, keep writing',
    owner: '',
    repo: '',
    branch: 'main',
    home: 'README.md',
    homeEn: 'README.en.md',
    excludeDirs: ['assets', 'scripts', 'node_modules', '.github', '_site', '.jekyll-cache'],
    excludeFiles: ['README.md', 'README.en.md', 'USAGE.md'],
    showLastModified: true,
    liveLastModified: true
  };

  var CFG = Object.assign({}, DEFAULTS, window.SITE_CONFIG || {});
  var I18N = window.SITE_I18N || { zh: {}, en: {}, dirs: {} };

  /* ------------------------------------------------------------- 基础工具 */
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

  function stripExt(name) { return name.replace(/\.en\.md$|\.md$/i, ''); }

  function t(key, vars) {
    var table = I18N[state.lang] || I18N.zh || {};
    var value = table[key];
    if (value == null) value = (I18N.zh || {})[key];
    if (value == null) return key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        value = String(value).replace(new RegExp('\\{' + name + '\\}', 'g'), vars[name]);
      });
    }
    return String(value);
  }

  function dirLabel(name) {
    var label = displayName(name);
    if (state.lang === 'en') return I18N.dirs[label] || I18N.dirs[name] || label;
    return label;
  }

  function pathLabel(path) {
    var parts = String(path || '').split('/').filter(Boolean);
    if (!parts.length) return t('root');
    return parts.map(dirLabel).join(' / ');
  }

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

  // 2026-10-21 原样保留日期；带时间的 ISO 字符串按本地时区换算
  function formatDate(value) {
    if (!value) return '';
    var str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    var d = new Date(str);
    if (isNaN(d.getTime())) {
      var m = /^(\d{4}-\d{2}-\d{2})/.exec(str);
      return m ? m[1] : str.slice(0, 10);
    }
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mo + '-' + day;
  }

  function relTime(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime();
    if (diff < 0) return '';
    var day = 86400000;
    if (diff < 3600000) return t('justNow');
    if (diff < day) return Math.floor(diff / 3600000) + t('hoursAgo');
    if (diff < day * 30) return Math.floor(diff / day) + t('daysAgo');
    return '';
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

  function pad2(n) { return String(n).padStart(2, '0'); }

  /* --------------------------------------------------------------- 图标 */
  // 每篇笔记的图标由路径哈希决定：同一个文件永远得到同一个图标，
  // front matter 里的 `icon: 🚀` 或 manifest.json 的 icon 字段可覆盖。
  var PAGE_ICONS = [
    '📘', '📗', '📙', '📕', '📔', '📓', '📒', '📝', '🧠', '💡',
    '🧩', '🔬', '⚙️', '🧮', '🖥️', '⌨️', '🧑‍💻', '🗄️', '🌐', '🔐',
    '📡', '🧵', '🪄', '🚀', '🧭', '🗺️', '📦', '🏗️', '🧪', '🔭',
    '🎯', '🌟', '🍀', '🪐', '🧬', '📐', '📊', '🗂️', '🕹️', '🎨',
    '🪴', '☕️', '🐧', '🦀', '🐍', '☁️', '🔥', '⚡️'
  ];
  var FOLDER_ICONS = ['📁', '🗂️', '🧰', '📚', '🧱', '🧭', '🎒', '🏷️'];

  function hashString(str) {
    var h = 5381;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function iconFor(path, explicit) {
    if (explicit) return String(explicit);
    var file = state.fileMap.get(path);
    if (file && file.icon) return String(file.icon);
    return PAGE_ICONS[hashString(path) % PAGE_ICONS.length];
  }

  function folderIcon(path) {
    return FOLDER_ICONS[hashString(path) % FOLDER_ICONS.length];
  }

  function setBadge(el, icon) {
    if (!el) return;
    el.textContent = icon;
    el.setAttribute('data-icon', icon);
  }

  /* ------------------------------------------------------------- 全局状态 */
  var state = {
    repo: null,
    files: [],
    fileMap: new Map(),
    enMap: new Map(),
    tree: null,
    flat: [],
    navMap: new Map(),
    expanded: new Set(),
    expandedSaved: false,
    current: '',
    currentTitle: '',
    currentIcon: '',
    currentFm: null,
    commitCache: new Map(),
    manifestSource: '',
    lang: 'zh',
    corpus: null,
    corpusPromise: null,
    corpusDone: false,
    anchor: '',
    routeSeq: 0,
    site: {
      title: DEFAULTS.title,
      subtitle: DEFAULTS.subtitle,
      brandIcon: DEFAULTS.brandIcon,
      footer: DEFAULTS.footer,
      titleEn: DEFAULTS.titleEn,
      subtitleEn: DEFAULTS.subtitleEn,
      footerEn: DEFAULTS.footerEn
    }
  };

  try {
    var savedExpanded = JSON.parse(store('ln-expanded') || 'null');
    if (Array.isArray(savedExpanded)) {
      state.expandedSaved = true;
      savedExpanded.forEach(function (p) { state.expanded.add(p); });
    }
  } catch (e) { /* ignore */ }

  /* --------------------------------------------------------------- 启动 */
  function init() {
    state.lang = store('ln-lang') === 'en' ? 'en' : 'zh';
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';

    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(store('ln-theme') || (prefersDark ? 'dark' : 'light'), true);

    state.repo = detectRepo();
    restoreUiState();
    paintSite();
    applyStaticLang();
    bindUi();
    startClock();
    setupRepoLinks();

    loadSiteJson();

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
        '<code>python3 -m http.server 8080</code>，再访问 http://localhost:8080/');
      return;
    }
    try {
      var manifest = await loadManifest();
      state.files = manifest.files;
      state.manifestSource = manifest.source;
      state.fileMap = new Map();
      state.files.forEach(function (f) { state.fileMap.set(f.path, f); });
      await loadEnglishManifest();
      buildIndex();
      defaultExpand();
      renderNav();
      updateNavCount();
    } catch (err) {
      renderNavError(err && err.message ? err.message : String(err));
    }
  }

  /* --------------------------------------------- 站点配置（site.json） */
  function sanitizeSiteValue(value) {
    if (value == null) return '';
    return String(value).replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  }

  async function loadSiteJson() {
    try {
      var res = await fetch('./site.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      var data = await res.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      ['title', 'subtitle', 'brandIcon', 'footer', 'titleEn', 'subtitleEn', 'footerEn'].forEach(function (key) {
        var value = sanitizeSiteValue(data[key]);
        if (value) state.site[key] = value;
      });
      paintSite();
    } catch (e) { /* 使用 config.js 兜底值 */ }
  }

  function paintSite() {
    var en = state.lang === 'en';
    var title = (en ? (state.site.titleEn || DEFAULTS.titleEn) : state.site.title) || DEFAULTS.title;
    var subtitle = (en ? (state.site.subtitleEn || DEFAULTS.subtitleEn) : state.site.subtitle) || DEFAULTS.subtitle;
    var icon = state.site.brandIcon || DEFAULTS.brandIcon;
    var footer = (en ? (state.site.footerEn || DEFAULTS.footerEn) : state.site.footer) || DEFAULTS.footer;

    $$('#site-title').forEach(function (el) { el.textContent = title; });
    $$('#site-subtitle').forEach(function (el) { el.textContent = subtitle; });
    $$('#dh-title').forEach(function (el) { el.textContent = title; });
    $$('[data-brand-icon], #mb-brand').forEach(function (el) { setBadge(el, icon); });
    $$('#foot-text').forEach(function (el) { el.textContent = footer; });

    if (!state.current) updateWindowTitle('', '', icon);
    refreshDocTitle();
    setFavicon(icon);
  }

  /* --------------------------------------------------------- 中英文切换 */
  function applyStaticLang() {
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';

    $$('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    $$('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    $$('[data-i18n-title]').forEach(function (el) {
      var label = t(el.getAttribute('data-i18n-title'));
      el.title = label;
      el.setAttribute('aria-label', label);
    });

    paintLangUi();
    applyTheme(document.documentElement.getAttribute('data-theme'), true);
    syncExpandLabel();
    updateNavCount();
    if (!state.current) refreshDocTitle();
  }

  function paintLangUi() {
    var label = t('langButton');
    var title = t('switchLanguage');

    $$('#lang-btn, #lang-btn-top').forEach(function (btn) {
      btn.textContent = label;
      btn.title = title;
      btn.setAttribute('aria-label', title);
    });
    $$('#mb-lang').forEach(function (btn) {
      var text = btn.querySelector('span');
      if (text) text.textContent = t('menuLang');
    });
  }

  function setLanguage(lang, opts) {
    opts = opts || {};
    var next = lang === 'en' ? 'en' : 'zh';
    var changed = state.lang !== next;
    state.lang = next;
    store('ln-lang', next);

    state.corpus = null;
    state.corpusPromise = null;
    state.corpusDone = false;

    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
    paintSite();
    applyStaticLang();

    if (state.files.length) {
      renderNav();
      updateNavCount();
    }
    if (opts.render === false) return;

    if (state.current) {
      loadNote(state.current, '', { keepScroll: true });
    } else {
      renderHome('', { keepScroll: true });
    }
    var input = $('#search');
    if (input && !$('#search-results').hidden) renderSearchResults(input.value);
    if (changed) toast(next === 'en' ? 'English' : '中文');
  }

  function toggleLanguage() {
    setLanguage(state.lang === 'en' ? 'zh' : 'en');
  }

  function scrollRatio() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? (window.pageYOffset || document.documentElement.scrollTop || 0) / max : 0;
  }

  function restoreScrollRatio(ratio) {
    if (ratio == null) return;
    window.requestAnimationFrame(function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: Math.max(0, ratio * max), behavior: 'auto' });
    });
  }

  function setFavicon(icon) {
    var link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<text x="32" y="50" font-size="50" text-anchor="middle">' + escapeHtml(icon) + '</text></svg>';
    link.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
  }

  function refreshDocTitle() {
    var siteTitle = state.lang === 'en'
      ? (state.site.titleEn || DEFAULTS.titleEn)
      : (state.site.title || DEFAULTS.title);
    document.title = state.currentTitle
      ? state.currentTitle + ' · ' + siteTitle
      : siteTitle;
  }

  /* ----------------------------------------------------------- 菜单栏时钟 */
  function clockText() {
    var d = new Date();
    if (state.lang === 'en') {
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
        ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    var days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[d.getDay()] + ' ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function startClock() {
    var el = $('#mb-clock');
    if (!el) return;
    var tick = function () {
      el.textContent = clockText();
      el.title = new Date().toLocaleString('zh-CN');
    };
    tick();
    setInterval(tick, 20000);
  }

  /* ----------------------------------------------------------- 仓库识别 */
  function detectRepo() {
    var owner = (CFG.owner || '').trim();
    var repo = (CFG.repo || '').trim();
    var branch = (CFG.branch || 'main').trim();

    if (!owner || !repo) {
      var m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
      if (m) {
        owner = owner || m[1];
        var seg = location.pathname.split('/').filter(Boolean)[0] || '';
        if (!repo && seg && !/\.html?$/i.test(seg)) repo = seg;
      }
    }
    if (!owner || !repo) return null;
    return { owner: owner, repo: repo, branch: branch || 'main' };
  }

  function repoUrl() {
    return state.repo ? 'https://github.com/' + state.repo.owner + '/' + state.repo.repo : '';
  }

  function setupRepoLinks() {
    var url = repoUrl();
    ['#repo-link', '#repo-link-2', '#mb-repo', '#dock-repo'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      if (url) {
        el.href = url;
        el.hidden = false;
        el.removeAttribute('aria-hidden');
      } else {
        el.removeAttribute('href');
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
      }
    });
  }

  /* ------------------------------------------------------- manifest 索引 */
  function isExcluded(path) {
    var segments = path.split('/');
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].charAt(0) === '.') return true;
    }
    if ((CFG.excludeFiles || []).indexOf(path) !== -1) return true;
    if (/\.en\.md$/i.test(path)) return true;
    var dirs = CFG.excludeDirs || [];
    for (var j = 0; j < dirs.length; j++) {
      if (path === dirs[j] || path.indexOf(dirs[j] + '/') === 0) return true;
    }
    return false;
  }

  function normalizeFile(raw) {
    if (!raw || !raw.path) return null;
    var path = normalizePath(String(raw.path).replace(/^\.?\//, ''));
    if (!path || !/\.md$/i.test(path)) return null;
    var tags = raw.tags;
    if (typeof tags === 'string') {
      tags = tags.replace(/^\[|\]$/g, '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    }
    return {
      path: path,
      title: raw.title ? String(raw.title).trim() : '',
      titleEn: raw.titleEn ? String(raw.titleEn).trim() : '',
      date: raw.date ? String(raw.date).trim() : '',
      lastModified: String(raw.lastModified || raw.modified || raw.mtime || '').trim(),
      size: Number(raw.size) || 0,
      tags: Array.isArray(tags) ? tags : [],
      tagsEn: Array.isArray(raw.tagsEn) ? raw.tagsEn : [],
      icon: raw.icon ? String(raw.icon).trim() : ''
    };
  }

  async function loadManifest() {
    try {
      var res = await fetch('./manifest.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        var data = await res.json();
        var rawFiles = Array.isArray(data.files) ? data.files : [];
        var files = rawFiles.map(normalizeFile).filter(function (f) { return f && !isExcluded(f.path); });
        return { files: files, source: 'manifest' };
      }
    } catch (e) { /* 继续尝试 GitHub API */ }

    if (!state.repo) {
      throw new Error('没有找到 manifest.json，且未能识别 GitHub 仓库信息。请检查 assets/js/config.js 中的 owner / repo 配置。');
    }
    return githubScan();
  }

  async function githubScan() {
    var api = 'https://api.github.com/repos/' + state.repo.owner + '/' + state.repo.repo +
      '/git/trees/' + encodeURIComponent(state.repo.branch) + '?recursive=1';
    var res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) {
      throw new Error('manifest.json 缺失，且 GitHub API 扫描失败（HTTP ' + res.status + '）。' +
        '请检查网络后刷新重试。');
    }
    var data = await res.json();
    var files = (data.tree || [])
      .filter(function (item) { return item.type === 'blob' && /\.md$/i.test(item.path); })
      .map(function (item) { return normalizeFile(item); })
      .filter(function (f) { return f && !isExcluded(f.path); });
    return { files: files, source: 'github' };
  }

  async function loadEnglishManifest() {
    state.enMap = new Map();
    try {
      var res = await fetch('./manifest.en.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      var data = await res.json();
      var list = Array.isArray(data.files) ? data.files : [];
      list.forEach(function (item) {
        if (!item || !item.path) return;
        state.enMap.set(normalizePath(String(item.path)), item);
      });
      state.files.forEach(function (file) {
        var meta = state.enMap.get(file.path);
        if (!meta) return;
        if (meta.title) file.titleEn = String(meta.title).trim();
        if (Array.isArray(meta.tags)) file.tagsEn = meta.tags;
        if (meta.description) file.descriptionEn = String(meta.description).trim();
        file.hasEn = true;
      });
    } catch (e) { /* 没有英文清单时保持中文模式 */ }
  }

  function englishPathFor(path) {
    return /\.en\.md$/i.test(path) ? path : String(path).replace(/\.md$/i, '.en.md');
  }

  function noteFetchPath(path) {
    return state.lang === 'en' ? englishPathFor(path) : path;
  }

  function splitLangPath(path) {
    if (/\.en\.md$/i.test(path)) {
      return { path: path.replace(/\.en\.md$/i, '.md'), lang: 'en' };
    }
    return { path: path, lang: '' };
  }

  async function fetchNoteText(path) {
    var target = noteFetchPath(path);
    var res = await fetch('./' + encodePath(target), { cache: 'no-store' });
    if (res.ok) {
      return { text: await res.text(), path: target, english: target !== path };
    }
    if (target !== path) {
      var fallback = await fetch('./' + encodePath(path), { cache: 'no-store' });
      if (fallback.ok) {
        if (state.lang === 'en') toast(t('missingTranslation'), 2600);
        return { text: await fallback.text(), path: path, english: false };
      }
      throw new Error('HTTP ' + fallback.status);
    }
    throw new Error('HTTP ' + res.status);
  }

  function splitFrontMatter(text) {
    var str = String(text || '').replace(/^\uFEFF/, '');
    var match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(str);
    if (!match) return { data: {}, body: str };

    var data = {};
    match[1].split(/\r?\n/).forEach(function (line) {
      var kv = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (!kv) return;
      var key = kv[1].toLowerCase();
      var value = kv[2].trim();
      if (/^\[[\s\S]*\]$/.test(value)) {
        data[key] = value.slice(1, -1).split(',')
          .map(function (v) { return v.trim().replace(/^['"]|['"]$/g, ''); })
          .filter(Boolean);
      } else {
        data[key] = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
      }
    });
    return { data: data, body: str.slice(match[0].length) };
  }

  /* ------------------------------------------------------------- 目录树 */
  function buildIndex() {
    var root = { name: '', path: '', dirs: new Map(), files: [] };

    state.files.slice().sort(function (a, b) {
      return a.path.localeCompare(b.path, 'zh-CN', { numeric: true });
    }).forEach(function (file) {
      var parts = file.path.split('/');
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var name = parts[i];
        var path = parts.slice(0, i + 1).join('/');
        if (!node.dirs.has(name)) {
          node.dirs.set(name, { name: name, path: path, dirs: new Map(), files: [] });
        }
        node = node.dirs.get(name);
      }
      node.files.push(file);
    });

    sortNode(root);
    state.tree = root;
    state.flat = state.files.slice().sort(function (a, b) {
      return a.path.localeCompare(b.path, 'zh-CN', { numeric: true });
    });
  }

  function sortNode(node) {
    node.files.sort(function (a, b) {
      return compareNames({ name: baseName(a.path) }, { name: baseName(b.path) });
    });
    node.sortedDirs = Array.from(node.dirs.values()).sort(compareNames);
    node.sortedDirs.forEach(sortNode);
  }

  function defaultExpand() {
    if (!state.tree || state.expandedSaved) return;
    state.tree.sortedDirs.forEach(function (dir) { state.expanded.add(dir.path); });
  }

  function countFiles(node) {
    var total = node.files.length;
    node.sortedDirs.forEach(function (child) { total += countFiles(child); });
    return total;
  }

  function firstFile(node) {
    if (node.files.length) return node.files[0];
    for (var i = 0; i < node.sortedDirs.length; i++) {
      var found = firstFile(node.sortedDirs[i]);
      if (found) return found;
    }
    return null;
  }

  function fileTitle(file) {
    if (state.lang === 'en' && file.titleEn) return file.titleEn;
    return file.title || displayName(baseName(file.path));
  }

  function fileTags(file) {
    if (state.lang === 'en' && file.tagsEn && file.tagsEn.length) return file.tagsEn;
    return file.tags || [];
  }

  /* ------------------------------------------------------------- 侧边目录 */
  function renderNav() {
    var nav = $('#nav');
    if (!nav) return;

    state.navMap = new Map();

    if (!state.tree || !state.files.length) {
      nav.innerHTML = '<div class="nav-empty">' + escapeHtml(t('navEmpty')) + '</div>';
      syncExpandLabel();
      return;
    }

    nav.innerHTML = '<ul class="nav-root">' + nodeMarkup(state.tree) + '</ul>';
    $$('.nav-link', nav).forEach(function (link) {
      state.navMap.set(link.getAttribute('data-path'), link);
    });
    syncExpandLabel();
    if (state.current) updateActive(state.current);
  }

  function nodeMarkup(node) {
    var html = '';

    node.sortedDirs.forEach(function (dir) {
      var open = state.expanded.has(dir.path);
      html += '<li class="nav-group' + (open ? '' : ' collapsed') + '" data-path="' +
        escapeHtml(dir.path) + '">' +
        '<button type="button" class="nav-group-btn" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="nav-caret" aria-hidden="true">▸</span>' +
        '<span class="nav-folder" aria-hidden="true">' + folderIcon(dir.path) + '</span>' +
        '<span class="nav-group-label">' + escapeHtml(dirLabel(dir.name)) + '</span>' +
        '<span class="nav-count-badge">' + countFiles(dir) + '</span>' +
        '</button>' +
        '<ul class="nav-children">' + nodeMarkup(dir) + '</ul>' +
        '</li>';
    });

    node.files.forEach(function (file) {
      html += '<li class="nav-item">' +
        '<a class="nav-link" href="' + toHash(file.path) + '" data-path="' + escapeHtml(file.path) + '">' +
        '<span class="page-badge" aria-hidden="true">' + iconFor(file.path) + '</span>' +
        '<span class="nav-link-text">' + escapeHtml(fileTitle(file)) + '</span>' +
        '</a></li>';
    });

    return html;
  }

  function setGroupOpen(li, open) {
    if (!li) return;
    li.classList.toggle('collapsed', !open);
    var btn = $('.nav-group-btn', li);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function persistExpanded() {
    state.expandedSaved = true;
    store('ln-expanded', JSON.stringify(Array.from(state.expanded)));
  }

  function toggleDir(path) {
    if (!path) return;
    var open = !state.expanded.has(path);
    if (open) state.expanded.add(path);
    else state.expanded.delete(path);

    $$('.nav-group', $('#nav')).forEach(function (li) {
      if (li.getAttribute('data-path') === path) setGroupOpen(li, open);
    });
    persistExpanded();
  }

  function walkDirs(node, cb) {
    node.sortedDirs.forEach(function (dir) {
      cb(dir);
      walkDirs(dir, cb);
    });
  }

  function allExpanded() {
    if (!state.tree) return false;
    var total = 0, opened = 0;
    walkDirs(state.tree, function (dir) {
      total++;
      if (state.expanded.has(dir.path)) opened++;
    });
    return total > 0 && total === opened;
  }

  function toggleExpandAll() {
    if (!state.tree) return;
    var expand = !allExpanded();
    if (expand) walkDirs(state.tree, function (dir) { state.expanded.add(dir.path); });
    else state.expanded.clear();

    $$('.nav-group', $('#nav')).forEach(function (li) {
      setGroupOpen(li, expand);
    });
    persistExpanded();
    syncExpandLabel();
  }

  function syncExpandLabel() {
    var btn = $('#expand-btn');
    if (!btn) return;
    var expand = !allExpanded();
    btn.textContent = expand ? t('expandAll') : t('collapseAll');
    btn.setAttribute('aria-label', expand ? t('expandAll') : t('collapseAll'));
  }

  function expandAncestors(path) {
    var parts = path.split('/');
    for (var i = 1; i < parts.length; i++) {
      var dir = parts.slice(0, i).join('/');
      if (!state.expanded.has(dir)) {
        state.expanded.add(dir);
        $$('.nav-group', $('#nav')).forEach(function (li) {
          if (li.getAttribute('data-path') === dir) setGroupOpen(li, true);
        });
      }
    }
  }

  function updateActive(path) {
    state.navMap.forEach(function (link, key) {
      var active = key === path;
      link.classList.toggle('active', active);
      if (active) {
        link.setAttribute('aria-current', 'page');
        expandAncestors(path);
        if (link.scrollIntoView) {
          try { link.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
        }
      } else {
        link.removeAttribute('aria-current');
      }
    });
    persistExpanded();
  }

  function refreshNavIcons() {
    state.navMap.forEach(function (link, path) {
      setBadge($('.page-badge', link), iconFor(path));
    });
  }

  function updateNavCount() {
    var el = $('#nav-count');
    if (!el) return;
    el.textContent = state.files.length ? state.files.length + ' ' + t('notesUnit') : '—';
    el.title = state.manifestSource === 'github' ? t('navSourceGithub') : t('navSourceManifest');
  }

  function renderNavError(message) {
    var nav = $('#nav');
    if (nav) nav.innerHTML = '<div class="nav-error">' + message + '</div>';
    updateNavCount();
  }

  /* --------------------------------------------------------------- 路由 */
  function toHash(path, anchor) {
    var base = '#/' + encodePath(path || '');
    if (anchor) base += '@' + encodeURIComponent(anchor);
    return base;
  }

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { path: '', anchor: '' };
    var at = raw.indexOf('@');
    var pathPart = at >= 0 ? raw.slice(0, at) : raw;
    var anchor = at >= 0 ? safeDecode(raw.slice(at + 1)) : '';
    if (pathPart.charAt(0) === '@') {
      pathPart = '';
      anchor = safeDecode(raw.slice(1));
    }
    var path = pathPart ? normalizePath(pathPart.split('/').map(safeDecode).join('/')) : '';
    return { path: path, anchor: anchor };
  }

  function handleRoute() {
    var route = parseHash();
    var resolved = splitLangPath(route.path);
    if (resolved.lang && resolved.lang !== state.lang) {
      setLanguage(resolved.lang, { render: false });
    }
    route.path = resolved.path;
    state.anchor = route.anchor;

    if (!route.path) {
      renderHome(route.anchor);
      closeMobileSidebar();
      hideSearch(true);
      return;
    }
    if (!state.fileMap.has(route.path)) {
      if (state.files.length) renderNotFound(route.path);
      else renderHome(route.anchor);
      closeMobileSidebar();
      return;
    }
    // 同一篇笔记内跳转锚点：只滚动，不重新拉取正文
    if (route.path === state.current) {
      if (route.anchor) scrollToAnchor(route.anchor, true);
      closeMobileSidebar();
      return;
    }
    loadNote(route.path, route.anchor);
    closeMobileSidebar();
  }

  function scrollToAnchor(anchor, smooth) {
    if (!anchor) { scrollTop(false); return; }
    var target = document.getElementById(anchor);
    if (!target) { scrollTop(false); return; }
    var header = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h'), 10) || 96;
    var top = target.getBoundingClientRect().top + window.pageYOffset - header - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: smooth === false ? 'auto' : 'smooth' });
  }

  function requestAnchorScroll(anchor) {
    if (!anchor) return;
    window.requestAnimationFrame(function () {
      setTimeout(function () { scrollToAnchor(anchor, true); }, 60);
    });
  }

  /* --------------------------------------------------------------- 首页 */
  function latestFiles(limit) {
    return state.files.filter(function (f) { return f.date || f.lastModified; })
      .slice()
      .sort(function (a, b) {
        return String(b.lastModified || b.date).localeCompare(String(a.lastModified || a.date));
      })
      .slice(0, limit || 6);
  }

  function countDirs() {
    var total = 0;
    if (state.tree) walkDirs(state.tree, function () { total++; });
    return total;
  }

  function homeHtml() {
    var en = state.lang === 'en';
    var icon = state.site.brandIcon || DEFAULTS.brandIcon;
    var dirs = state.tree ? state.tree.sortedDirs : [];
    var recent = latestFiles(6);
    var latest = recent.length ? formatDate(recent[0].lastModified || recent[0].date) : '—';
    var siteTitle = (en ? (state.site.titleEn || DEFAULTS.titleEn) : state.site.title) || DEFAULTS.title;
    var siteSubtitle = (en ? (state.site.subtitleEn || DEFAULTS.subtitleEn) : state.site.subtitle) || DEFAULTS.subtitle;

    var html = '<section class="home-hero">' +
      '<span class="home-hero-badge" data-brand-icon aria-hidden="true">' + icon + '</span>' +
      '<h1>' + escapeHtml(siteTitle) + '</h1>' +
      '<p class="home-sub">' + escapeHtml(siteSubtitle) + '</p>' +
      '<div class="home-stats">' +
      '<span class="home-stat"><b>' + state.files.length + '</b> ' + escapeHtml(t('notesCount')) + '</span>' +
      '<span class="home-stat"><b>' + dirs.length + '</b> ' + escapeHtml(t('directionCount')) + '</span>' +
      '<span class="home-stat"><b>' + countDirs() + '</b> ' + escapeHtml(t('categoryCount')) + '</span>' +
      '<span class="home-stat">' + escapeHtml(t('recentUpdates')) + ' <b>' + escapeHtml(latest) + '</b></span>' +
      '</div></section>';

    if (dirs.length) {
      html += '<section class="home-block"><div class="home-section-head"><h2>' + escapeHtml(t('learningAreas')) + '</h2>' +
        '<span>' + dirs.length + ' ' + escapeHtml(t('directionCount')) + '</span></div><div class="folder-grid">';
      dirs.forEach(function (dir) {
        var first = firstFile(dir);
        var topics = dir.sortedDirs.length;
        html += '<a class="folder-card" href="' + (first ? toHash(first.path) : '#/') + '">' +
          '<span class="page-badge" aria-hidden="true">' + folderIcon(dir.path) + '</span>' +
          '<span class="folder-card-body">' +
          '<span class="folder-card-title">' + escapeHtml(dirLabel(dir.name)) + '</span>' +
          '<span class="folder-card-desc">' + countFiles(dir) + ' ' + escapeHtml(t('notesCount')) +
          (topics ? ' · ' + topics + ' ' + escapeHtml(t('categoryCount')) : '') +
          (first ? ' · ' + escapeHtml(t('startWith')) + escapeHtml(fileTitle(first)) + escapeHtml(t('startWithEnd')) : '') +
          '</span></span></a>';
      });
      html += '</div></section>';
    }

    if (recent.length) {
      html += '<section class="home-block"><div class="home-section-head"><h2>' + escapeHtml(t('recentUpdates')) + '</h2>' +
        '<span>' + escapeHtml(t('recentSort')) + '</span></div><ul class="recent-list">';
      recent.forEach(function (file) {
        html += '<li><a class="recent-item" href="' + toHash(file.path) + '">' +
          '<span class="page-badge" aria-hidden="true">' + iconFor(file.path) + '</span>' +
          '<span class="recent-main"><span class="recent-title">' + escapeHtml(fileTitle(file)) + '</span>' +
          '<span class="recent-path">' + escapeHtml(pathLabel(dirName(file.path))) + '</span></span>' +
          '<span class="recent-date">' + escapeHtml(formatDate(file.lastModified || file.date)) + '</span>' +
          '</a></li>';
      });
      html += '</ul></section>';
    }

    html += '<section class="home-block home-readme"><div class="home-section-head">' +
      '<h2>' + escapeHtml(t('siteNotes')) + '</h2><span>' + escapeHtml(en ? (CFG.homeEn || DEFAULTS.homeEn) : CFG.home) + '</span></div>' +
      '<div id="home-doc" class="home-doc markdown-body">' +
      '<div class="state-box">' + escapeHtml(t('loadingHome')) + '</div></div></section>';

    return html;
  }

  async function renderHome(anchor, opts) {
    opts = opts || {};
    var ratio = opts.keepScroll ? scrollRatio() : null;
    var article = $('#article');
    if (!article) return;
    var seq = ++state.routeSeq;

    state.current = '';
    state.currentTitle = '';
    state.currentIcon = state.site.brandIcon || DEFAULTS.brandIcon;
    state.currentFm = null;

    article.classList.add('home-view');
    article.innerHTML = homeHtml();

    updateActive('');
    setBreadcrumb('');
    updateWindowTitle('', '', state.currentIcon);
    refreshDocTitle();
    renderPager('');
    renderToc([]);
    setEditLink('');
    renderFootUpdated('', null);

    var doc = $('#home-doc');
    if (!doc) return;

    try {
      var candidates = state.lang === 'en' ? [CFG.homeEn || DEFAULTS.homeEn, CFG.home] : [CFG.home];
      var text = '';
      var usedPath = candidates[0];
      for (var i = 0; i < candidates.length; i++) {
        var res = await fetch('./' + encodePath(candidates[i]), { cache: 'no-store' });
        if (res.ok) {
          text = await res.text();
          usedPath = candidates[i];
          break;
        }
      }
      if (!text) throw new Error('HTTP 404');
      if (seq !== state.routeSeq) return;
      if (state.lang === 'en' && usedPath !== candidates[0]) toast(t('missingHome'), 2600);
      var parsed = splitFrontMatter(text);
      var homeTitle = state.lang === 'en'
        ? (state.site.titleEn || DEFAULTS.titleEn)
        : (state.site.title || DEFAULTS.title);
      var body = stripLeadingH1(parsed.body, homeTitle);
      doc.innerHTML = '';
      renderMarkdown(doc, body, usedPath, { isHome: true, skipMeta: true });
      buildToc(doc);
      restoreScrollRatio(ratio);
    } catch (e) {
      if (seq !== state.routeSeq) return;
      doc.innerHTML = builtinHome();
      renderToc([]);
    }

    requestAnchorScroll(anchor);
  }

  function builtinHome() {
    if (state.lang === 'en') {
      return '<div class="state-box"><h2>Welcome to your study notes</h2>' +
        '<p>The home file <code>' + escapeHtml(CFG.homeEn || DEFAULTS.homeEn) + '</code> could not be loaded, but the notes are still available.</p>' +
        '<ol>' +
        '<li>Create Markdown files under <code>area/topic/detail.md</code>;</li>' +
        '<li>Wait for GitHub Actions to refresh the index;</li>' +
        '<li>Reload the page and the new note appears in the sidebar.</li>' +
        '</ol></div>';
    }
    return '<div class="state-box"><h2>欢迎使用你的学习笔记站</h2>' +
      '<p>首页文件 <code>' + escapeHtml(CFG.home) + '</code> 暂时没有读取到，但不影响浏览笔记。</p>' +
      '<ol>' +
      '<li>在仓库中按 <code>学习方向/内容/细节.md</code> 新建 Markdown 文件；</li>' +
      '<li>等待 GitHub Action 自动更新索引（无需本地运行命令）；</li>' +
      '<li>刷新页面即可在左侧目录看到新笔记。</li>' +
      '</ol></div>';
  }

  /* ------------------------------------------------------------- 读取笔记 */
  function updateWindowTitle(title, path, icon) {
    var winTitle = $('#win-title');
    var winPath = $('#win-path');
    var winIcon = $('#win-icon');

    state.currentTitle = title || '';
    state.currentIcon = icon || (title ? iconFor(path) : (state.site.brandIcon || DEFAULTS.brandIcon));

    if (winTitle) winTitle.textContent = title || ((state.lang === 'en' ? state.site.titleEn : state.site.title) || DEFAULTS.title);
    if (winPath) winPath.textContent = title ? pathLabel(dirName(path)) : t('home');
    if (winIcon) {
      winIcon.hidden = false;
      setBadge(winIcon, state.currentIcon);
    }
    if (title) refreshDocTitle();
  }

  function setBreadcrumb(path) {
    var el = $('#breadcrumb');
    if (!el) return;

    var html = '<a href="' + toHash('') + '">🏠 ' + escapeHtml(t('home')) + '</a>';

    if (path) {
      var parts = path.split('/');
      var dirs = parts.slice(0, -1);
      var acc = [];
      dirs.forEach(function (name) {
        acc.push(name);
        html += '<span class="sep">›</span><span title="' + escapeHtml(acc.join('/')) + '">' +
          escapeHtml(dirLabel(name)) + '</span>';
      });
      html += '<span class="sep">›</span><span class="current">' +
        escapeHtml(fileTitle(state.fileMap.get(path) || { path: path })) + '</span>';
    } else {
      html = '<span class="current">🏠 ' + escapeHtml(t('home')) + '</span>';
    }

    el.innerHTML = html;
  }

  function setEditLink(path) {
    var link = $('#edit-link');
    if (!link) return;
    var url = state.repo && path
      ? 'https://github.com/' + state.repo.owner + '/' + state.repo.repo + '/edit/' +
        encodeURIComponent(state.repo.branch) + '/' + path.split('/').map(encodeURIComponent).join('/')
      : '';
    if (url) {
      link.href = url;
      link.hidden = false;
    } else {
      link.removeAttribute('href');
      link.hidden = true;
    }
  }

  function loadNote(path, anchor, opts) {
    opts = opts || {};
    var ratio = opts.keepScroll ? scrollRatio() : null;
    var file = state.fileMap.get(path);
    var article = $('#article');
    if (!file || !article) { renderNotFound(path); return; }
    var seq = ++state.routeSeq;

    state.current = path;
    state.currentFm = null;

    var icon = iconFor(path);
    article.classList.remove('home-view');
    article.innerHTML = '<div class="skeleton" aria-hidden="true">' +
      '<span></span><span></span><span></span><span></span></div>';

    updateActive(path);
    setBreadcrumb(path);
    updateWindowTitle(fileTitle(file), path, icon);
    refreshDocTitle();
    renderPager(path);
    renderToc([]);
    setEditLink(path);
    renderFootUpdated(path, null);
    if (!opts.keepScroll) scrollTop(false);

    fetchNoteText(path)
      .then(function (result) {
        if (seq !== state.routeSeq) return;
        renderNote(result.text, path, result.english);
        if (opts.keepScroll) restoreScrollRatio(ratio);
        else requestAnchorScroll(anchor);
      })
      .catch(function (err) {
        if (seq !== state.routeSeq) return;
        article.innerHTML = '<div class="state-box"><h2>' + escapeHtml(t('readFailed')) + '</h2>' +
          '<p>' + escapeHtml(path) +
          (err && err.message ? '（' + escapeHtml(err.message) + '）' : '') + '</p>' +
          '<p>' + escapeHtml(t('readFailedHint')) + '</p>' +
          '<p><a class="btn primary" href="' + toHash('') + '">' + escapeHtml(t('backHome')) + '</a></p></div>';
      });
  }

  function stripLeadingH1(body, title) {
    var match = /^\s*#\s+([^\n]+)\n?/.exec(body);
    if (!match) return body;
    var heading = match[1].replace(/[*_`~]/g, '').replace(/\s+#+\s*$/, '').trim();
    var a = heading.replace(/\s+/g, '').toLowerCase();
    var b = String(title || '').replace(/\s+/g, '').toLowerCase();
    if (a && b && (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) {
      return body.slice(match[0].length).replace(/^\s*\n/, '');
    }
    return body;
  }

  function readingTime(body) {
    var text = String(body || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~|]/g, ' ');
    var cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var words = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    return Math.max(1, Math.round(cjk / 350 + words / 220));
  }

  function renderNote(text, path, english) {
    var file = state.fileMap.get(path) || { path: path };
    var parsed = splitFrontMatter(text);
    var fm = parsed.data || {};

    if (fm.icon) file.icon = String(fm.icon).trim();
    if (fm.title) {
      if (english) file.titleEn = String(fm.title).trim();
      else file.title = String(fm.title).trim();
    }
    if (fm.date) file.date = String(fm.date).trim();
    if (fm.updated) file.lastModified = String(fm.updated).trim();

    var title = fileTitle(file);
    var icon = iconFor(path, fm.icon);
    var body = stripLeadingH1(parsed.body, title);

    text = null;
    state.currentFm = fm;

    var article = $('#article');
    if (!article) return;
    article.classList.remove('home-view');
    article.innerHTML = '';
    article.appendChild(buildArticleHead(title, path, fm, body));

    var content = document.createElement('div');
    content.className = 'md-content';
    article.appendChild(content);
    renderMarkdown(content, body, path, {});
    buildToc(content);

    updateWindowTitle(title, path, icon);
    refreshDocTitle();
    setBreadcrumb(path);
    updateActive(path);
    renderPager(path);
    setEditLink(path);
    renderFootUpdated(path, fm);

    var link = state.navMap.get(path);
    if (link) {
      var label = $('.nav-link-text', link);
      if (label) label.textContent = title;
      setBadge($('.page-badge', link), icon);
    }
  }

  function buildArticleHead(title, path, fm, body) {
    var icon = iconFor(path, fm.icon);
    var date = formatDate(fm.updated || fm.date || (state.fileMap.get(path) || {}).date);
    var tags = Array.isArray(fm.tags) ? fm.tags : [];
    var desc = fm.description || fm.summary || fm.desc || '';

    var chips = '<span class="meta-chip">📂 ' + escapeHtml(pathLabel(dirName(path))) + '</span>';
    if (date) chips += '<span class="meta-chip">📅 ' + escapeHtml(date) + '</span>';
    chips += '<span class="meta-chip">⏱ ' + readingTime(body) + ' ' + escapeHtml(t('minRead')) + '</span>';
    tags.slice(0, 6).forEach(function (tag) {
      chips += '<span class="meta-chip">#' + escapeHtml(tag) + '</span>';
    });

    var head = document.createElement('header');
    head.className = 'article-head';
    head.innerHTML = '<h1 class="article-title">' +
      '<span class="page-badge" aria-hidden="true">' + icon + '</span>' +
      '<span class="article-title-text">' + escapeHtml(title) + '</span></h1>' +
      '<div class="article-meta">' + chips + '</div>' +
      (desc ? '<p class="article-desc">' + escapeHtml(desc) + '</p>' : '');
    return head;
  }

  function renderPager(path) {
    var el = $('#pager');
    if (!el) return;
    if (!path || !state.flat.length) { el.innerHTML = ''; return; }

    var index = -1;
    state.flat.forEach(function (f, i) { if (f.path === path) index = i; });
    if (index < 0) { el.innerHTML = ''; return; }

    var prev = index > 0 ? state.flat[index - 1] : null;
    var next = index < state.flat.length - 1 ? state.flat[index + 1] : null;

    function item(file, cls, label) {
      if (!file) return '<span class="pager-link ' + cls + '" aria-hidden="true"></span>';
      return '<a class="pager-link ' + cls + '" href="' + toHash(file.path) + '">' +
        '<span class="pg-dir">' + label + '</span>' +
        '<span class="pg-title">' + escapeHtml(fileTitle(file)) + '</span></a>';
    }

    el.innerHTML = item(prev, 'pg-prev', t('prev')) + item(next, 'pg-next', t('next'));
  }

  function renderToc(items) {
    var el = $('#toc');
    if (!el) return;
    if (!items || !items.length) {
      el.innerHTML = '<div class="toc-empty">' + escapeHtml(t('tocEmpty')) + '</div>';
      return;
    }
    el.innerHTML = items.map(function (item) {
      return '<a class="toc-h' + item.level + '" href="' + toHash(state.current, item.id) +
        '" data-target="' + escapeHtml(item.id) + '">' + escapeHtml(item.text) + '</a>';
    }).join('');
  }

  function renderNotFound(path) {
    state.routeSeq += 1;
    state.current = path;
    state.currentTitle = t('notFoundTitle');
    refreshDocTitle();
    updateActive(path);
    setBreadcrumb(path || '');
    updateWindowTitle(t('notFoundTitle'), path || '', '🧭');
    renderPager('');
    renderToc([]);
    setEditLink('');
    renderFootUpdated('', null);
    var foot = $('#foot-updated');
    if (foot) { foot.hidden = true; foot.innerHTML = ''; }

    var article = $('#article');
    if (article) {
      article.classList.remove('home-view');
      article.innerHTML = '<div class="state-box"><h2>' + escapeHtml(t('notFoundTitle')) + '</h2>' +
        '<p><code>' + escapeHtml(path || '') + '</code> ' + escapeHtml(t('notFoundBody')) + '</p>' +
        '<p>' + escapeHtml(t('notFoundHint')) + '</p>' +
        '<p><a class="btn primary" href="' + toHash('') + '">' + escapeHtml(t('backHome')) + '</a></p></div>';
    }
  }

  /* ------------------------------------------------------------- 更新时间 */
  function latestSiteDate() {
    var dates = state.files.map(function (f) {
      return formatDate(f.lastModified || f.date);
    }).filter(Boolean);
    dates.sort();
    return dates.length ? dates[dates.length - 1] : '';
  }

  function renderFootUpdated(path, fm) {
    var el = $('#foot-updated');
    if (!el) return;

    if (CFG.showLastModified === false) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    var date = '';
    if (fm) date = formatDate(fm.updated);
    if (!date && path) {
      var file = state.fileMap.get(path);
      if (file) {
        var fallback = (fm && fm.date) || file.date;
        date = formatDate(file.lastModified || fallback);
      }
    }
    if (!date && fm) date = formatDate(fm.date);
    if (!path) date = latestSiteDate();

    if (!date) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    el.hidden = false;
    el.innerHTML = (path ? t('footerRecent') : t('footerSiteRecent')) +
      '<span class="fu-date">' + escapeHtml(date) + '</span>' +
      '<span class="fu-live" id="fu-live"></span>';

    if (path && CFG.liveLastModified !== false && state.repo) fetchCommitDate(path);
  }

  function fetchCommitDate(path) {
    if (state.commitCache.has(path)) {
      paintCommit(path, state.commitCache.get(path));
      return;
    }

    var url = 'https://api.github.com/repos/' + state.repo.owner + '/' + state.repo.repo +
      '/commits?path=' + encodeURIComponent(path) +
      '&sha=' + encodeURIComponent(state.repo.branch) + '&per_page=1';

    fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (list) {
        if (!Array.isArray(list) || !list.length) return;
        var commit = list[0].commit || {};
        var iso = (commit.committer && commit.committer.date) ||
          (commit.author && commit.author.date) || '';
        if (!iso) return;
        state.commitCache.set(path, iso);
        paintCommit(path, iso);
      })
      .catch(function () { /* 未登录 / 超限时静默忽略 */ });
  }

  function paintCommit(path, iso) {
    if (state.current !== path) return;
    var live = $('#fu-live');
    if (!live) return;
    var rel = relTime(iso);
    live.textContent = t('gitCommit') + formatDate(iso) + (rel ? ' (' + rel + ')' : '');
  }

  /* ------------------------------------------------------------- 渲染 Markdown */
  function renderMarkdown(container, markdown, path, opts) {
    opts = opts || {};
    var linkPath = opts.isHome ? '' : path;

    if (!window.marked) {
      container.innerHTML = '<div class="state-box"><h2>Markdown 渲染库未加载</h2>' +
        '<p>请检查能否访问 <code>cdn.jsdelivr.net</code>（公司网络 / 离线环境可能被拦截），' +
        '或把这些依赖下载到本地后修改 <code>index.html</code> 中的引用地址。</p>' +
        '<pre>' + escapeHtml(String(markdown).slice(0, 2000)) + '</pre></div>';
      return;
    }

    var html;
    try {
      html = window.marked.parse(markdown, { gfm: true, breaks: false });
    } catch (e) {
      container.innerHTML = '<div class="state-box"><h2>Markdown 解析失败</h2><p>' +
        escapeHtml(e.message) + '</p></div>';
      return;
    }

    container.innerHTML = html;
    decorateHeadings(container, linkPath);
    decorateAlerts(container);
    decorateTables(container);
    resolveLinks(container, path, linkPath);
    enhanceMermaid(container);
    enhanceCode(container);
    enhanceMath(container);
  }

  function slugify(text) {
    return String(text).trim().toLowerCase()
      .replace(/[\s\u00a0]+/g, '-')
      .replace(/[!-,\.\/:-@\[-`{-~！-～、。，；：“”‘’（）【】《》〈〉〔〕…—·]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function decorateHeadings(container, linkPath) {
    var heads = $$('h1, h2, h3, h4', container);
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
      a.href = toHash(linkPath, id);
      a.setAttribute('aria-label', t('sectionLink'));
      a.title = t('sectionLink');
      a.textContent = '#';
      h.appendChild(a);
    });
  }

  var tocObserver = null;

  function buildToc(container) {
    var heads = $$('h2, h3, h4', container).filter(function (h) { return h.id; });
    var items = heads.map(function (h) {
      return {
        level: parseInt(h.tagName.charAt(1), 10),
        id: h.id,
        text: h.textContent.replace(/#\s*$/, '').trim()
      };
    });
    renderToc(items);
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
    var labels = { NOTE: t('alertNote'), TIP: t('alertTip'), IMPORTANT: t('alertImportant'),
      WARNING: t('alertWarning'), CAUTION: t('alertCaution') };

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

  function resolveLinks(article, notePath, linkPath) {
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
        a.setAttribute('href', toHash(linkPath, safeDecode(raw.slice(1))));
        return;
      }

      var idx = raw.indexOf('#');
      var filePart = idx >= 0 ? raw.slice(0, idx) : raw;
      var anchor = idx >= 0 ? safeDecode(raw.slice(idx + 1)) : '';
      var target = normalizePath(dirPrefix + decodeURISafe(filePart));

      if (/\.en\.md$/i.test(target)) {
        a.setAttribute('href', toHash(target, anchor));
        a.classList.add('internal-link');
      } else if (/\.md$/i.test(target)) {
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

  /* --------------------------------------------------------- 代码 / 图表 / 公式 */
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
      btn.textContent = t('copy');
      btn.addEventListener('click', function () {
        copyText(code.textContent).then(function (ok) {
          btn.textContent = ok ? t('copied') : t('copyFailed');
          if (ok) btn.classList.add('copied');
          setTimeout(function () {
            btn.textContent = t('copy');
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

  /* ------------------------------------------------------------- 主题 / UI 状态 */
  function applyTheme(mode, silent) {
    var dark = mode === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

    var light = $('#hljs-light');
    var darkSheet = $('#hljs-dark');
    if (light) light.disabled = dark;
    if (darkSheet) darkSheet.disabled = !dark;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1e1e21' : '#eef3fb');

    store('ln-theme', dark ? 'dark' : 'light');
    $$('#theme-btn, #mb-theme, #dock-theme').forEach(function (btn) {
      if (btn.id === 'mb-theme') {
        var label = btn.querySelector('span');
        if (label) label.textContent = dark ? t('themeLight') : t('themeDark');
        btn.firstChild.nodeValue = dark ? '☀️ ' : '🌙 ';
      } else {
        btn.textContent = dark ? '☀️' : '🌙';
        btn.title = dark ? t('themeLight') : t('themeDark');
      }
    });

    var isMobile = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
    if (!silent && !isMobile) rerenderMermaid();
  }

  function toggleTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(dark ? 'light' : 'dark');
  }

  function restoreUiState() {
    if (store('ln-sidebar-hidden') === '1') document.body.classList.add('sidebar-hidden');
    document.body.classList.add('window-open');
    document.body.classList.remove('window-closed');
    if (document.body.classList.contains('sidebar-hidden')) {
      var btn = $('#sidebar-btn');
      if (btn) btn.setAttribute('aria-pressed', 'false');
    }
  }

  function setSidebarHidden(hidden) {
    document.body.classList.toggle('sidebar-hidden', hidden);
    store('ln-sidebar-hidden', hidden ? '1' : '0');
    var btn = $('#sidebar-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
      btn.setAttribute('aria-label', hidden ? t('showSidebar') : t('hideSidebar'));
    }
  }

  function toggleSidebar() {
    if (window.innerWidth <= 940) {
      toggleMobileSidebar();
      return;
    }
    setSidebarHidden(!document.body.classList.contains('sidebar-hidden'));
  }

  function openMobileSidebar() {
    document.body.classList.add('sidebar-open');
    var overlay = $('#overlay');
    if (overlay) overlay.hidden = false;
    var menu = $('#menu-btn');
    if (menu) menu.setAttribute('aria-expanded', 'true');
  }

  function closeMobileSidebar() {
    document.body.classList.remove('sidebar-open');
    document.body.classList.remove('search-open');
    var overlay = $('#overlay');
    if (overlay) overlay.hidden = true;
    var menu = $('#menu-btn');
    if (menu) menu.setAttribute('aria-expanded', 'false');
  }

  function toggleMobileSidebar() {
    if (document.body.classList.contains('sidebar-open')) closeMobileSidebar();
    else openMobileSidebar();
  }

  function openWindow() {
    document.body.classList.remove('window-closed');
    document.body.classList.add('window-open');
    closeMobileSidebar();
  }

  function closeWindow() {
    document.body.classList.add('window-closed');
    document.body.classList.remove('window-open');
    closeMobileSidebar();
    hideSearch(true);
  }

  function toggleZoom() {
    document.body.classList.toggle('zoomed');
    var zoomed = document.body.classList.contains('zoomed');
    toast(zoomed ? t('windowZoomed') : t('windowRestored'));
    window.requestAnimationFrame(function () {
      if (state.anchor) scrollToAnchor(state.anchor, false);
    });
  }

  function setMenuOpen(open) {
    var details = $('#mb-menu');
    if (details) details.open = !!open;
  }

  /* --------------------------------------------------------------- 搜索 */
  var searchCursor = -1;

  function searchText(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~|]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function loadCorpus() {
    if (state.corpusPromise) return state.corpusPromise;
    if (!state.files.length) return Promise.resolve(null);

    state.corpus = new Map();
    state.corpusDone = false;
    var queue = state.files.slice(0, 120);
    var total = queue.length;
    var active = 0;
    var settled = 0;

    state.corpusPromise = new Promise(function (resolve) {
      function finish() {
        if (settled === total) {
          state.corpusDone = true;
          resolve(state.corpus);
        }
      }
      function next() {
        if (!queue.length && active === 0) return;
        while (active < 4 && queue.length) {
          (function (file) {
            active += 1;
            var target = noteFetchPath(file.path);
            fetch('./' + encodePath(target), { cache: 'force-cache' })
              .then(function (res) {
                if (res.ok) return res.text();
                if (target !== file.path) {
                  return fetch('./' + encodePath(file.path), { cache: 'force-cache' })
                    .then(function (fallback) { return fallback.ok ? fallback.text() : ''; });
                }
                return '';
              })
              .then(function (text) {
                if (text) state.corpus.set(file.path, searchText(splitFrontMatter(text).body));
              })
              .catch(function () { /* 单篇失败不影响其他 */ })
              .then(function () {
                active -= 1;
                settled += 1;
                finish();
                next();
              });
          })(queue.shift());
        }
      }
      next();
    });

    return state.corpusPromise;
  }

  function excerptFor(path, query) {
    if (!state.corpus || !state.corpus.has(path)) return '';
    var text = state.corpus.get(path);
    var idx = text.toLowerCase().indexOf(query);
    if (idx < 0) return '';
    var start = Math.max(0, idx - 28);
    var snippet = text.slice(start, start + 96).trim();
    return (start > 0 ? '…' : '') + snippet + (start + 96 < text.length ? '…' : '');
  }

  function searchFiles(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    var results = [];

    state.files.forEach(function (file) {
      var title = fileTitle(file);
      var lowerTitle = title.toLowerCase();
      var lowerPath = file.path.toLowerCase();
      var score = 0;

      if (lowerTitle === q) score = 120;
      else if (lowerTitle.indexOf(q) === 0) score = 100;
      else if (lowerTitle.indexOf(q) >= 0) score = 85;
      else if (lowerPath.indexOf(q) >= 0) score = 60;

      var tags = fileTags(file).map(function (tag) { return String(tag).toLowerCase(); });
      if (tags.indexOf(q) >= 0) score += 25;

      var excerpt = excerptFor(file.path, q);
      if (excerpt) score += 12;
      if (!score) return;

      results.push({
        file: file,
        title: title,
        score: score,
        excerpt: excerpt
      });
    });

    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title, 'zh-CN', { sensitivity: 'base' });
    });
    return results;
  }

  function renderSearchResults(query) {
    var box = $('#search-results');
    if (!box) return;
    searchCursor = -1;

    if (!query.trim()) {
      var recent = latestFiles(5);
      box.innerHTML = recent.length
        ? recent.map(function (f) {
            return '<a class="sr-item" role="option" href="' + toHash(f.path) + '">' +
              '<span class="sr-title">' + iconFor(f.path) + ' ' + escapeHtml(fileTitle(f)) + '</span>' +
              '<span class="sr-path">' + escapeHtml(pathLabel(dirName(f.path))) + '</span></a>';
          }).join('')
        : '<div class="sr-empty">' + escapeHtml(t('searchTip')) + '</div>';
      box.hidden = false;
      return;
    }

    var results = searchFiles(query).slice(0, 12);
    if (!results.length) {
      var stillLoading = state.corpusPromise && !state.corpusDone;
      box.innerHTML = '<div class="sr-empty">' + escapeHtml(t('noResults')) +
        (stillLoading ? ' (' + escapeHtml(t('searching')) + ')' : '') + '</div>';
      box.hidden = false;
      if (stillLoading) loadCorpus().then(function () {
        var input = $('#search');
        if (input && input.value.trim() === query.trim()) renderSearchResults(query);
      });
      return;
    }

    box.innerHTML = results.map(function (r) {
      return '<a class="sr-item" role="option" href="' + toHash(r.file.path) + '">' +
        '<span class="sr-title">' + iconFor(r.file.path) + ' ' + escapeHtml(r.title) + '</span>' +
        '<span class="sr-path">' + escapeHtml(r.excerpt || pathLabel(dirName(r.file.path))) + '</span></a>';
    }).join('');
    box.hidden = false;
  }

  function hideSearch(force) {
    var box = $('#search-results');
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
    searchCursor = -1;
    if (force) {
      var input = $('#search');
      if (input) input.value = '';
      document.body.classList.remove('search-open');
    }
  }

  function focusSearch() {
    var input = $('#search');
    if (!input) return;
    document.body.classList.add('search-open');
    input.focus();
    input.select();
    renderSearchResults(input.value);
  }

  function moveSearchCursor(step) {
    var box = $('#search-results');
    if (!box || box.hidden) return;
    var items = $$('.sr-item', box);
    if (!items.length) return;
    searchCursor = (searchCursor + step + items.length) % items.length;
    items.forEach(function (item, i) { item.classList.toggle('active', i === searchCursor); });
    if (items[searchCursor].scrollIntoView) {
      try { items[searchCursor].scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    }
  }

  /* ------------------------------------------------------------- UI 绑定 */
  function bindUi() {
    setupNavUi();
    setupSearchUi();
    setupWindowUi();
    setupDockUi();
    setupLangUi();
    setupKeyboard();
    setupScrollUi();

    var overlay = $('#overlay');
    if (overlay) overlay.addEventListener('click', closeMobileSidebar);

    document.addEventListener('click', function (e) {
      var menu = $('#mb-menu');
      if (menu && menu.open && !menu.contains(e.target)) menu.open = false;
      var wrap = $('#search-wrap');
      if (wrap && !wrap.contains(e.target)) hideSearch(false);
    });

    window.addEventListener('resize', debounce(function () {
      if (window.innerWidth > 940) closeMobileSidebar();
      if (window.innerWidth > 760) document.body.classList.remove('search-open');
    }, 120));
  }

  function setupNavUi() {
    var nav = $('#nav');
    if (nav) {
      nav.addEventListener('click', function (e) {
        var groupBtn = e.target.closest ? e.target.closest('.nav-group-btn') : null;
        if (groupBtn) {
          e.preventDefault();
          var group = groupBtn.parentElement;
          if (group) toggleDir(group.getAttribute('data-path'));
          return;
        }
        if (e.target.closest && e.target.closest('.nav-link')) closeMobileSidebar();
      });
    }

    $$('#menu-btn').forEach(function (btn) {
      btn.addEventListener('click', toggleMobileSidebar);
    });
    $$('#sidebar-btn, #mb-sidebar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleSidebar();
        setMenuOpen(false);
      });
    });
    $$('#expand-btn, #mb-expand').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleExpandAll();
        setMenuOpen(false);
        toast(allExpanded() ? t('expandedAll') : t('collapsedAll'));
      });
    });
  }

  function setupSearchUi() {
    var input = $('#search');
    var box = $('#search-results');
    var runSearch = debounce(function () { renderSearchResults(input.value); }, 110);

    if (input) {
      input.addEventListener('focus', function () { renderSearchResults(input.value); });
      input.addEventListener('input', runSearch);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchCursor(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchCursor(-1); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          var items = box ? $$('.sr-item', box) : [];
          var target = items[searchCursor >= 0 ? searchCursor : 0];
          if (target) {
            location.hash = target.getAttribute('href');
            hideSearch(true);
            input.blur();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          hideSearch(true);
          input.blur();
        }
      });
    }

    if (box) {
      box.addEventListener('click', function (e) {
        var item = e.target.closest ? e.target.closest('.sr-item') : null;
        if (item) hideSearch(true);
      });
      box.addEventListener('mousemove', function (e) {
        var item = e.target.closest ? e.target.closest('.sr-item') : null;
        if (!item) return;
        var items = $$('.sr-item', box);
        searchCursor = items.indexOf(item);
        items.forEach(function (el, i) { el.classList.toggle('active', i === searchCursor); });
      });
    }

    $$('#search-toggle, #mb-search, #dock-search').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMenuOpen(false);
        openWindow();
        focusSearch();
      });
    });
  }

  function setupWindowUi() {
    var win = $('#window');
    if (!win) return;

    var close = $('#win-close');
    if (close) close.addEventListener('click', function () {
      closeWindow();
      toast(t('windowClosed'));
    });

    var min = $('#win-min');
    if (min) min.addEventListener('click', function () {
      closeWindow();
      toast(t('windowMinimized'));
    });

    $$('#win-zoom, #mb-zoom').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMenuOpen(false);
        toggleZoom();
      });
    });

    var reopen = $('#reopen-btn');
    if (reopen) reopen.addEventListener('click', function () {
      openWindow();
      toast(t('windowReopened'));
    });

    win.addEventListener('dblclick', function (e) {
      if (e.target.closest && e.target.closest('.titlebar') && !e.target.closest('.tb-btn, .tl, input, a, button')) {
        toggleZoom();
      }
    });
  }

  function setupDockUi() {
    var home = $('#dock-home');
    if (home) home.addEventListener('click', function () {
      openWindow();
      if (location.hash.replace(/^#\/?/, '') !== '') location.hash = '#/';
      else renderHome('');
    });

    var top = $('#dock-top');
    if (top) top.addEventListener('click', function () {
      openWindow();
      scrollTop();
    });

    $$('#theme-btn, #mb-theme, #dock-theme').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMenuOpen(false);
        toggleTheme();
      });
    });
  }

  function setupLangUi() {
    $$('#lang-btn, #lang-btn-top, #mb-lang').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        setMenuOpen(false);
        toggleLanguage();
      });
    });
  }

  function setupKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      var key = e.key || '';
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

      if ((key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'k')) {
        e.preventDefault();
        openWindow();
        focusSearch();
        return;
      }
      if (key === 'Escape') {
        setMenuOpen(false);
        hideSearch(true);
        closeMobileSidebar();
        if (typing) e.target.blur();
        return;
      }
      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      if (e.altKey && key === 'ArrowLeft') {
        e.preventDefault();
        if (history.length > 1) history.back();
      }
    });
  }

  function setupScrollUi() {
    var progress = $('#progress');
    var topBtn = $('#top-btn');
    var ticking = false;

    function update() {
      ticking = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      if (progress) progress.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + '%';
      if (topBtn) topBtn.hidden = y < 320;
    }

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener('resize', update);
    update();

    if (topBtn) topBtn.addEventListener('click', function () { scrollTop(); });
    $$('#mb-top').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMenuOpen(false);
        scrollTop();
      });
    });
  }

  /* --------------------------------------------------------------- 启动 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
