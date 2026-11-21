# WebView 跨端深入：WKWebView、JSBridge 与混合容器
> 一句话：**iOS 上的 WebView 跨端，本质是把浏览器内核当成运行时：页面负责 UI，WKWebView 负责渲染，JSBridge 负责把「网页」接上「原生能力」。**
> 适用：做 Hybrid 容器、运营页、小程序宿主、Flutter/RN 内嵌 H5 的同学。

## 一、iOS WebView 的技术底座
### 1. UIWebView → WKWebView
| 维度 | UIWebView（已废弃） | WKWebView（iOS 8+） |
|---|---|---|
| 进程模型 | 与 App 同进程 | 独立 WebContent 进程 + Networking 进程 |
| JS 引擎 | Nitro（JIT） | Nitro（JIT），但**跨进程** |
| JS 上下文 | 可通过 `JSContext` 直接互调 | 无法直接拿 `JSContext`，只能消息通信 |
| 崩溃影响 | JS OOM 直接带崩 App | 内容进程被杀，App 可捕获并恢复 |
| 性能 | 滚动、内存差 | 滚动与渲染显著改善 |
| 状态 | iOS 12 废弃，2020 年起不再接收 | 当前唯一选择 |

> 关键认知：WKWebView **不是 App 里的一个控件那么简单**，它背后是三个进程：App 进程、Networking 进程、WebContent 进程。跨进程带来了稳定性，也带来了「不能直接拦截网络」「Cookie 不共享」「内存不归你管」这三类经典问题。

### 2. 进程模型带来的四个直接后果
1. **`NSURLProtocol` 拦不到 WKWebView 的请求**：请求发生在 Networking 进程，自定义协议栈无效；
2. **Cookie 不自动共享**：`WKHTTPCookieStore` 与 `NSHTTPCookieStorage` 是两套存储；
3. **内容进程可能被系统回收**：收到 `webViewWebContentProcessDidTerminate` 时必须能重建页面；
4. **JS 与原生不能同步互调**：所有 Bridge 调用天然异步，同步等待只能靠阻塞式 hack，不能用于生产。

## 二、一次页面加载发生了什么
```
loadRequest
  → Networking 进程：DNS / TLS / HTTP 缓存 / Cookie 附加
  → WebContent 进程：HTML 解析 → DOM + CSSOM → Render Tree
  → Layout → Paint → Composite
  → GPU 合成上屏
```
- **HTML 解析是流式的**：DOMContentLoaded 只代表 DOM 就绪，图片、字体、async 脚本仍可能未完成；
- **JS 在 WebContent 进程执行**，与 App 主线程隔离，但**会阻塞同进程的渲染与事件**；
- `WKNavigationDelegate` 的 `didFinish` 只代表主文档加载结束，不代表首屏可见；
- WKWebView 自带手势与滚动，`scrollView` 属性可调，但滚动发生在 WebContent 进程，原生侧拿不到逐帧回调。

### 观测首屏的正确指标
| 指标 | 含义 | 采集方式 |
|---|---|---|
| 白屏时长 | 从打开容器到首帧有内容 | 原生打点 + `didFinish` + JS `first-paint` |
| FCP | 首次内容绘制 | PerformanceObserver |
| LCP | 最大内容绘制 | PerformanceObserver |
| INP | 交互到下次绘制 | PerformanceObserver |
| Bridge 成功率/耗时 | 原生调用可靠性 | 自建埋点 |

## 三、JSBridge 的四代实现
### 1. URL Scheme 拦截（最原始）
```js
// JS 侧：改 location 或插入 iframe
location.href = "myapp://camera?cb=1";
```
原生在 `decidePolicyFor navigationAction` 里拦截自定义 scheme。
问题：会打断当前页面导航、参数长度受限、连续调用会丢消息。现在只作为兜底。

### 2. `prompt` 拦截（同步 hack）
JS 调 `prompt("bridge://...")`，原生在 `WKUIDelegate` 的 `runJavaScriptTextInputPanel` 里拿到参数并同步返回结果。
优点是**同步**，缺点是实现丑陋、阻塞 UI、已被多数团队弃用。

### 3. `WKScriptMessageHandler`（主流）
```swift
let config = WKWebViewConfiguration()
let controller = WKUserContentController()
controller.add(self, name: "bridge")
config.userContentController = controller
let webView = WKWebView(frame: .zero, configuration: config)

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "bridge",
              let body = message.body as? [String: Any],
              let method = body["method"] as? String,
              let params = body["params"] as? [String: Any],
              let callbackId = body["callbackId"] as? String else { return }
        handle(method: method, params: params) { result in
            let js = "window.__bridge.resolve('\(callbackId)', \(jsonString(result)))"
            DispatchQueue.main.async { self.webView.evaluateJavaScript(js) }
        }
    }
}
```
```js
// JS 侧：Promise 化封装
window.__bridge = (() => {
  const pending = new Map();
  let seq = 0;
  const post = (msg) => window.webkit.messageHandlers.bridge.postMessage(msg);
  return {
    call(method, params = {}) {
      const callbackId = `cb_${++seq}`;
      return new Promise((resolve, reject) => {
        pending.set(callbackId, { resolve, reject });
        post({ method, params, callbackId });
        setTimeout(() => {
          if (pending.delete(callbackId)) reject(new Error("bridge timeout"));
        }, 5000);
      });
    },
    resolve(id, data) {
      const p = pending.get(id);
      if (p) { pending.delete(id); p.resolve(data); }
    },
    reject(id, err) {
      const p = pending.get(id);
      if (p) { pending.delete(id); p.reject(new Error(err)); }
    }
  };
})();
```
要点：
- `postMessage` 的参数必须是 **JSON 可序列化**类型；函数、Date、undefined 会丢失或报错；
- 回调要维护 `callbackId → Promise` 映射，并处理超时、重复回调、页面跳转后的悬挂回调；
- 原生回调用 `evaluateJavaScript` 时注意字符串转义，优先用 `callAsyncJavaScript`。

### 4. `WKScriptMessageHandlerWithReply`（iOS 14+）
```swift
controller.addScriptMessageHandler(self, contentWorld: .page, name: "bridge")

func userContentController(_ controller: WKUserContentController,
                           didReceive message: WKScriptMessage,
                           replyHandler: @escaping (Any?, String?) -> Void) {
    replyHandler(["ok": true], nil)
}
```
```js
const result = await window.webkit.messageHandlers.bridge.postMessage({
  method: "getUserInfo", params: {}
});
```
好处：**请求-响应天然配对**，不用自己维护 callbackId；缺点：iOS 14+，且仍然异步。

### 5. 设计一个可靠 Bridge 的最低要求
1. **协议版本握手**：页面加载后先 `bridge.ready`，原生返回版本与能力列表；
2. **消息信封**：`{id, method, params, version}`，原生侧做 schema 校验；
3. **队列**：Bridge 未就绪时的调用先入队，ready 后 flush；
4. **超时与重试**：原生无响应必须 reject，避免页面永久 pending；
5. **批量合并**：高频小消息（滚动位置、埋点）合并发送，别一条一个 `postMessage`；
6. **线程约束**：`WKScriptMessageHandler` 回调在主线程，耗时操作必须切走，结果再切回主线程 `evaluateJavaScript`。

## 四、脚本注入与隔离
### 1. 注入时机
```swift
let source = "window.__APP_ENV__ = { platform: 'ios' };"
let script = WKUserScript(source: source,
                          injectionTime: .atDocumentStart,
                          forMainFrameOnly: true)
config.userContentController.addUserScript(script)
```
- `.atDocumentStart`：DOM 构建前执行，适合注入 Bridge、环境变量；
- `.atDocumentEnd`：DOM 就绪后执行，适合操作页面；
- `forMainFrameOnly: true` 避免注入到 iframe，减少污染与安全风险。

### 2. `WKContentWorld`（iOS 14+）
页面 JS 与注入脚本默认共享同一个全局对象，容易命名冲突，也可能被页面脚本篡改 Bridge。`WKContentWorld` 提供隔离世界：
```swift
let world = WKContentWorld.world(name: "app_bridge")
webView.evaluateJavaScript(js, in: nil, in: world)
```
隔离世界里的变量页面看不到，适合放内部 Bridge 实现；代价是跨世界共享数据必须显式传参。

### 3. 执行 JS 的两种方式
| 方式 | 版本 | 特点 |
|---|---|---|
| `evaluateJavaScript(_:)` | iOS 8 | 字符串拼接，需自己转义，返回值类型受限 |
| `callAsyncJavaScript(_:arguments:in:in:completionHandler:)` | iOS 14 | 参数按 JSON 传递，自动转义，支持 async/await |

```swift
webView.callAsyncJavaScript(
    "return window.__bridge.resolve(callbackId, payload);",
    arguments: ["callbackId": id, "payload": result],
    in: nil,
    in: .page
) { result in /* 处理错误 */ }
```
> 不要用字符串拼接把用户输入塞进 JS，这是最典型的 JS 注入入口。

## 五、Cookie、存储与登录态
### 1. 两套 Cookie 存储
- `NSHTTPCookieStorage`：给 `URLSession` 用；
- `WKHTTPCookieStore`：给 WKWebView 用；
- 二者**不会自动同步**。原生登录后要把 token 写入 `WKHTTPCookieStore`：
```swift
HTTPCookieStorage.shared.cookies?.forEach { cookie in
    webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
}
```
反向同步（网页登录 → 原生）需要在 `didFinish` 后读取 `getAllCookies`。

### 2. 存储隔离与 ITP
- `WKWebsiteDataStore.default()` 持久化；`.nonPersistent()` 是内存态（无痕），退出即清；
- 同一 `WKWebsiteDataStore` 下的多个 WKWebView 共享 Cookie / localStorage / IndexedDB；
- Safari 的 **ITP（智能防跟踪）** 同样影响 WKWebView：无用户交互的站点，脚本可写存储有 7 天上限；第三方 Cookie 默认受限；
- 因此「网页登录态能不能长期保持」不能只靠 Cookie，重要凭证应通过 Bridge 交给原生 Keychain 管理。

### 3. 登录与 OAuth
- 第三方登录、支付授权应使用 **`ASWebAuthenticationSession`**，而不是在 App 内 WKWebView 打开登录页：后者既拿不到系统级密码自动填充，也容易被判定为钓鱼；
- 登录完成用自定义 scheme 或 Universal Link 回调 App，再把凭证通过 Bridge 注入页面；
- 不要在 Bridge 里明文传长期 token，至少做一次性的短期票据交换。

## 六、离线与本地资源
### 1. `WKURLSchemeHandler`（iOS 11+）
```swift
config.setURLSchemeHandler(LocalHandler(), forURLScheme: "app")
webView.load(URLRequest(url: URL(string: "app://local/index.html")!))
```
- 只能注册**自定义 scheme**，注册 `http` / `https` / `file` 会直接抛异常；
- 适合把 H5 离线包映射成本地资源，省去起本地服务器；
- 注意返回的 `MIME type`、`Content-Length`、Range 请求，否则视频、字体可能加载失败。

### 2. 本地文件加载
```swift
webView.loadFileURL(indexURL, allowingReadAccessTo: bundleDirectory)
```
坑：
- `file://` 下 `fetch`、XHR、Service Worker、部分存储 API 受限；
- 相对路径必须落在 `allowingReadAccessTo` 目录内；
- 需要完整 Web 能力时，更稳的做法是 **scheme handler 模拟 http 源**，或起一个本地 HTTP 服务（仅监听 127.0.0.1）。

### 3. Service Worker 与缓存
- WKWebView 对 Service Worker 支持有限，`file://` 与自定义 scheme 下不可用；
- 离线优先的包，建议「本地资源 + 版本化增量更新」，不要过度依赖 SW；
- HTTP 缓存策略由 `URLRequest.cachePolicy` 与响应头共同决定，离线包更新要处理「旧 HTML 引旧 JS」的版本一致性。

## 七、性能优化
### 1. 启动
1. **预热进程**：提前创建 WKWebView 加载 `about:blank`，复用 `WKProcessPool` / `WKWebsiteDataStore`，减少首次白屏；
2. **复用实例**：列表页、活动页共用池化 WKWebView，避免频繁创建销毁；
3. **首屏资源内联**：关键 CSS 内联、JS 延后、图片预连接；
4. **SSR / 预渲染**：首屏由服务端直出，别等 JS 框架挂载。

### 2. 滚动与渲染
- 避免在 `scroll` 事件里做重排（读写 `offsetTop`、改样式），使用 `passive: true`；
- 长列表用虚拟滚动，不要一次渲染上千 DOM；
- 动画优先 `transform` / `opacity`，避免触发布局与重绘；
- 慎用 `position: fixed` 与 `100vh`：iOS 动态工具栏会导致跳动，改用 `dvh` / `svh`；
- 阴影、圆角、`filter`、`backdrop-filter` 在 WebView 里都是高开销项。

### 3. Bridge 性能
- 单条消息序列化 + 跨进程传输成本不低，**高频场景必须合并/降频**；
- 大对象（图片 base64、长列表）不要走 Bridge，改传 URL 或分页；
- 避免「JS 调原生 → 原生调 JS → JS 再调原生」的往返风暴。

### 4. 内存与进程回收
- 图片是内存大头：限制解码尺寸、及时释放、避免 base64 大图；
- 监听 `webViewWebContentProcessDidTerminate`，记录 URL 与滚动位置，自动重建；
- 多个 WKWebView 同时存活会放大内存，非可见页面应销毁或复用。

## 八、原生能力接入
| 能力 | 是否可直接用 | 说明 |
|---|---|---|
| 相机 / 相册 | ⚠️ 部分 | `<input type="file" accept="image/*">` 可用；`getUserMedia` 需 iOS 14.3+ 与权限授权 |
| 定位 | ⚠️ | 需 `NSLocationWhenInUseUsageDescription`，并实现 `WKUIDelegate` 定位授权回调 |
| 文件下载/上传 | ⚠️ | 上传走 `runOpenPanelWith`；下载需自己接管响应 |
| 弹窗 alert/confirm/prompt | ✅ | 必须实现 `WKUIDelegate`，否则默认无反应 |
| 支付 | ❌ | 走 Bridge 调原生 SDK；网页支付用收银台方案 |
| 推送 | ❌ | App 内 WKWebView **不支持 Web Push**；iOS 16.4 的 Web Push 仅限「添加到主屏幕」的 Web App |
| 蓝牙 / NFC | ❌ | Web Bluetooth 在 WKWebView 不可用，必须 Bridge |
| 剪贴板 / 分享 | ⚠️ | 受用户手势与权限限制，复杂场景走 Bridge |
| 媒体自动播放 | ⚠️ | 默认受限，可配置 `allowsInlineMediaPlayback`、`mediaTypesRequiringUserActionForPlayback` |

## 九、Hybrid 容器与小程序架构
### 1. Cordova / Capacitor
```
Web 页面 → 统一 Bridge → 插件（Plugin）→ 原生 API
```
- Cordova：`config.xml` + 插件注册，历史包袱重，但生态成熟；
- Capacitor：更现代，原生工程是「一等公民」，插件用 Swift/Kotlin 写，Web 侧通过 `Capacitor.Plugins` 调用；
- 二者本质都是「把 Bridge 标准化 + 插件化」，适合把现成 H5 快速包成 App。

### 2. 小程序的双线程模型
```
逻辑层（JSCore / 独立线程）── setData（JSON diff）──> 视图层（WKWebView）
        │                                              │
     业务 JS、API 调用                              渲染 DOM、手势
```
- 逻辑与渲染分离，JS 长任务不会直接卡住渲染线程；
- 代价是 `setData` 的**序列化与跨线程通信成本**，一次传大对象就会掉帧；
- 视图层不是完整浏览器：没有 DOM API、受限的 CSS 选择器、组件由平台提供；
- 这也是为什么小程序「看起来像 Web，跑起来不像 Web」。

### 3. 在 Flutter / RN 里嵌 WebView
- Flutter 用 `webview_flutter` / `flutter_inappwebview`，iOS 侧通过 PlatformView 把 WKWebView 叠到 Flutter 画布上；
- RN 用 `react-native-webview`，同样是原生 View 桥接；
- 注意：PlatformView 有合成开销，圆角裁剪、透明度、滚动嵌套容易出问题，能全屏独立页面就不要嵌在复杂滚动容器里。

## 十、安全清单
1. **Bridge 方法白名单**：只暴露必要方法，禁止「通用 invoke」；
2. **来源校验**：校验 `message.frameInfo.request.url` 的 scheme/host，拒绝非白名单页面调用；
3. **参数校验**：按 schema 校验类型、长度、枚举，防止注入与越权；
4. **禁止 `evaluateJavaScript` 拼接不可信字符串**，优先 `callAsyncJavaScript` 参数传递；
5. **CSP**：限制 `script-src`、`connect-src`，降低 XSS 后提权到原生的风险；
6. **App-Bound Domains**：`limitsNavigationsToAppBoundDomains = true` + `WKAppBoundDomains`，把导航限制在自有域名；
7. **传输安全**：ATS 全量 HTTPS、必要时证书 Pinning；
8. **登录页隔离**：第三方 OAuth 用 `ASWebAuthenticationSession`，不要在可被 JS 读取的 WebView 里输入密码；
9. **本地包校验**：离线包做签名/哈希校验，防止被替换注入恶意脚本；
10. **调试开关**：`isInspectable` 只在 Debug 打开，Release 关闭。

## 十一、调试与线上监控
- **Safari 开发者菜单**：模拟器/真机 → 开发 → 选择页面；iOS 16.4+ 需要 `webView.isInspectable = true`；
- **JS 错误**：注入 `window.onerror` / `unhandledrejection`，通过 Bridge 上报；
- **资源与性能**：`PerformanceObserver` 采集 FCP/LCP/INP、慢资源；
- **Bridge 监控**：调用量、成功率、P95 耗时、超时率、原生错误码；
- **白屏监控**：容器打开 → `didFinish` → 首帧 JS 打点，三段分别计时；
- **进程崩溃**：`webViewWebContentProcessDidTerminate` 上报并统计触发页面。

## 十二、适用边界
✅ 适合：
- 运营活动、落地页、内容详情、帮助中心；
- 表单、审批、配置类后台；
- 需要动态下发、快速试错的页面；
- 小程序 / 超级 App 容器。

⚠️ 谨慎或不适合：
- 复杂手势、实时动画、游戏；
- 超长列表与高频滚动；
- 相机实时处理、音视频编辑；
- 强离线、重交互的核心链路；
- 对启动时间极敏感的首屏。

> 判断标准：**页面以「展示 + 表单」为主 → WebView；以「交互 + 动画」为主 → 原生或 Flutter。**

## 十三、常见误区
1. ❌ WKWebView 就是「更快的 UIWebView」：它是完全不同的多进程架构，调试、Cookie、网络拦截行为都变了；
2. ❌ Cookie 会自动共享：`NSHTTPCookieStorage` 与 `WKHTTPCookieStore` 是两套；
3. ❌ 用 `NSURLProtocol` 给 WKWebView 做网络拦截：跨进程，拦不到；
4. ❌ Bridge 调用越多越实时：每次都是跨进程异步消息，高频调用必然掉帧；
5. ❌ `loadFileURL` 加载本地包没有坑：`file://` 下 fetch、存储、SW 都受限；
6. ❌ 网页里能调用的原生能力越多越好：每多一个方法就多一个攻击面；
7. ❌ 小程序就是 H5：双线程、组件体系、能力 API 都不同，不能直接复用普通 Web 页面。
