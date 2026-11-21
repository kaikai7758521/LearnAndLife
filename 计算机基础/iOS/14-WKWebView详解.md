# WKWebView 详解：配置、操作与监控
> 一句话：**WKWebView 是 WebKit 在 iOS 上的应用侧入口，由 App 进程、Networking 进程、WebContent 进程协作完成加载、执行与渲染；用好它的关键，是理解进程边界，并围绕边界建立操作规范与监控体系。**
> 与 `12-WebView跨端深入.md` 的分工：12 讲 WebView 在跨端/Hybrid 容器里的角色，本篇聚焦 WKWebView 本身的 API、操作手册、监控与内部机制。

## 一、对象模型：先认清这几个类
```
WKWebView
├── configuration（初始化时复制，之后不可变）
│   ├── preferences                  WKPreferences
│   ├── defaultWebpagePreferences    WKWebpagePreferences
│   ├── userContentController        WKUserContentController
│   │   ├── userScripts              注入脚本
│   │   └── scriptMessageHandlers    JS → Native 通道
│   ├── websiteDataStore             Cookie / 缓存 / localStorage
│   └── processPool                  进程池（实现细节，勿依赖）
├── navigationDelegate（weak）        导航、鉴权、进程终止
├── uiDelegate（weak）                弹窗、上传、新窗口、媒体权限
├── scrollView                       真实 UIScrollView
└── backForwardList                  前进/后退历史
```
| 类 | 作用 | 关键点 |
|---|---|---|
| `WKWebView` | 浏览器视图 | 必须主线程创建与操作 |
| `WKWebViewConfiguration` | 初始化配置 | **init 时复制**，之后再改无效 |
| `WKPreferences` | JS、字体、欺诈网站警告 | `javaScriptEnabled` 已弃用，改用 `WKWebpagePreferences` |
| `WKWebpagePreferences` | 单次导航的 JS / 桌面模式 | iOS 13+，可按导航动态设置 |
| `WKUserContentController` | 脚本注入与消息通道 | 强引用 handler，注意循环引用 |
| `WKWebsiteDataStore` | 存储与缓存 | `default()` 持久化，`nonPersistent()` 内存态 |
| `WKProcessPool` | 进程池 | 不透明，不要用它做安全隔离 |
| `WKContentWorld` | JS 全局对象隔离 | iOS 14+，page / defaultClient / 自定义 |

## 二、初始化：一份可直接用的配置
```swift
import UIKit
import WebKit

final class WebViewController: UIViewController {
    private var webView: WKWebView!
    private var contentController: WKUserContentController!
    private var progressObservation: NSKeyValueObservation?

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()                    // 持久化 Cookie/缓存
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []    // 允许自动播放
        config.allowsPictureInPictureMediaPlayback = true
        config.applicationNameForUserAgent = "MyApp/1.0"        // 追加到默认 UA 末尾

        contentController = WKUserContentController()
        contentController.addUserScript(WKUserScript(
            source: "window.__APP__ = { platform: 'ios' };",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        config.userContentController = contentController

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { webView, _ in
            // 0.0 ~ 1.0，只在主线程回调
            print("progress:", webView.estimatedProgress)
        }
    }

    deinit {
        progressObservation?.invalidate()
        contentController?.removeAllScriptMessageHandlers()
        contentController?.removeAllUserScripts()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
    }
}
```
### 配置阶段最容易踩的三个点
1. **`configuration` 是值拷贝**：`webView.configuration.userContentController.add(...)` 改的是副本，对已创建的 WebView 无效。保留自己创建的 `contentController` 引用；
2. **`websiteDataStore` 必须在 init 前设置**：创建后无法切换持久化/无痕模式；
3. **`limitsNavigationsToAppBoundDomains` 默认关闭**：开启后必须配置 `WKAppBoundDomains`，否则导航直接失败，表现为白屏。

## 三、加载内容：七种方式

| 方式 | API | 场景 | 注意 |
|---|---|---|---|
| 远程 URL | `load(URLRequest)` | 常规 H5 | 可带 method/body/header |
| 本地文件 | `loadFileURL(_:allowingReadAccessTo:)` | 离线包 | `file://` 下 fetch/存储/SW 受限 |
| HTML 字符串 | `loadHTMLString(_:baseURL:)` | 邮件、模板、错误页 | `baseURL` 影响相对路径与同源策略 |
| Data | `load(_:mimeType:characterEncodingName:baseURL:)` | 已解码的二进制 | 编码名要准确 |
| 模拟响应 | `loadSimulatedRequest(_:responseHTMLString:)` | 离线兜底页 | iOS 15+，不发起真实请求 |
| 自定义 Scheme | `WKURLSchemeHandler` | 本地资源映射 | 只能注册非 http/https/file 的 scheme |
| 本地服务 | `127.0.0.1` HTTP Server | 需要完整 Web 能力 | 注意端口冲突与安全 |

### 1. POST 与自定义 Header
```swift
var request = URLRequest(url: URL(string: "https://example.com/api")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
request.httpBody = try JSONEncoder().encode(payload)
webView.load(request)
```
> 重要限制：**自定义 Header 只对主文档请求生效**，页面里的 XHR、fetch、图片、脚本等子资源不会继承。需要统一鉴权时，用 Cookie、服务端会话，或自定义 scheme handler；不要指望改 `URLRequest` 能覆盖所有子请求。

### 2. 本地离线包
```swift
let index = bundleURL.appendingPathComponent("index.html")
webView.loadFileURL(index, allowingReadAccessTo: bundleURL)
```
- `allowingReadAccessTo` 必须是包含 `index.html` 的目录，否则相对资源 404；
- `file://` 的 origin 是 `null`，CORS、Cookie、Service Worker、部分存储 API 会失效；
- 需要「像 http 一样」运行时，优先用 `WKURLSchemeHandler` 或本地 HTTP 服务。

### 3. 前进、后退与状态恢复
```swift
webView.goBack()
webView.goForward()
webView.reload()
webView.reloadFromOrigin()   // 忽略缓存
webView.stopLoading()

// iOS 15+：保存/恢复会话（含前进后退栈与页面状态）
let state = webView.interactionState
webView.interactionState = state
```
> `interactionState` 只恢复 WebKit 侧状态，表单里未提交的敏感数据、原生侧状态仍需自己保存。

## 四、导航代理：时序与决策
### 1. 一次成功加载的回调顺序
```
decidePolicyFor navigationAction
  → didStartProvisionalNavigation
  → didReceiveServerRedirectForProvisionalNavigation（可多次）
  → decidePolicyFor navigationResponse
  → didCommit
  → didFinish
```
失败路径：
- 请求阶段失败 → `didFailProvisionalNavigation`（DNS、TLS、断网）；
- 已提交后失败 → `didFail`（页面崩溃、资源中断）；
- 内容进程被杀 → `webViewWebContentProcessDidTerminate`。

### 2. 拦截与放行
```swift
extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // 自定义 scheme 交给原生处理
        if let url = navigationAction.request.url, url.scheme == "myapp" {
            handleDeepLink(url)
            decisionHandler(.cancel)
            return
        }
        // 非用户点击的跳转（如广告）可以拦截
        if navigationAction.navigationType == .other,
           let host = navigationAction.request.url?.host,
           !allowedHosts.contains(host) {
            decisionHandler(.cancel)
            return
        }
        // target="_blank"：默认不处理会「点了没反应」
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // 无法展示的 MIME（zip、dmg、exe 等）转为下载
        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }
}
```
### 3. 鉴权与证书
```swift
func webView(_ webView: WKWebView,
             didReceive challenge: URLAuthenticationChallenge,
             completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
       let trust = challenge.protectionSpace.serverTrust {
        // 生产环境应做证书 Pinning，不要无条件信任
        completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
        completionHandler(.performDefaultHandling, nil)
    }
}
```
### 4. 常见错误码

| code | 含义 | 典型原因 |
|---|---|---|
| `-999` | `NSURLErrorCancelled` | 主动 stop、策略 cancel、重复 load |
| `-1001` | 请求超时 | 弱网、服务端慢 |
| `-1003` | 找不到主机 | DNS / 域名错误 |
| `-1004` | 无法连接 | 端口、服务未启动 |
| `-1005` | 连接丢失 | 网络切换 |
| `-1009` | 无网络 | 离线 |
| `-1022` | ATS 禁止明文 | http 未配置例外 |
| `-1200` | SSL 握手失败 | 证书过期、链不完整、Pinning 失败 |
| `-1202` | 证书无效 | 自签名 / 中间人 |

> 不要把 `-999` 当故障上报，否则监控噪声会淹没真实错误。

## 五、JS 交互操作手册
### 1. Native → JS
```swift
// 简单取值
webView.evaluateJavaScript("document.title") { result, error in
    if let title = result as? String { print(title) }
}

// iOS 14+：参数安全传递，支持 async/await
webView.callAsyncJavaScript(
    "return document.querySelector('#total')?.innerText ?? null;",
    arguments: [:],
    in: nil,              // nil = 主框架
    in: .page             // 页面世界
) { result in
    switch result {
    case .success(let value): print(value ?? "nil")
    case .failure(let error): print(error)
    }
}
```
要点：
- `evaluateJavaScript` 在**主线程**回调，返回值只支持 `String` / `NSNumber` / `NSNull` / 数组 / 字典等可桥接类型；
- 不要用字符串拼接把用户输入塞进 JS，优先 `callAsyncJavaScript` 的 `arguments`；
- 页面还没加载完时执行 JS 会失败，至少等 `didCommit` 之后。

### 2. JS → Native
```swift
// 注册
contentController.add(self, name: "bridge")

// 处理
extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "bridge",
              let body = message.body as? [String: Any] else { return }
        // 校验来源：只接受主框架、白名单域名
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == "example.com" else { return }
        handleBridge(body)
    }
}
```
```js
window.webkit.messageHandlers.bridge.postMessage({
  method: "getUserInfo",
  params: {},
  callbackId: "cb_1"
});
```
- `message.body` 只支持 JSON 可序列化类型；`Date`、`undefined`、函数会丢失或抛错；
- `message.frameInfo.isMainFrame` 可过滤 iframe 调用；
- `WKUserContentController` **强引用** handler，`self` 直接注册会形成 `webView → config → controller → self → webView` 循环，用弱代理或 `removeAllScriptMessageHandlers()` 断开。

### 3. 弱代理写法
```swift
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
// 注册：contentController.add(WeakScriptHandler(target: self), name: "bridge")
```
### 4. 带回复的消息（iOS 14+）
```swift
contentController.addScriptMessageHandler(self, contentWorld: .page, name: "bridge")
// 实现：userContentController(_:didReceive:replyHandler:)
```
JS 侧 `postMessage` 会返回 Promise，适合「请求-响应」模型，省掉手写 callbackId。

### 5. Content World：隔离注入环境
```swift
let world = WKContentWorld.world(name: "app_internal")
webView.evaluateJavaScript(js, in: nil, in: world)
```
- `.page`：与页面共享全局对象，页面能看到、也能篡改你的变量；
- `.defaultClient`：所有注入脚本共享，页面不可见；
- `.world(name:)`：自定义隔离世界，适合放 Bridge 内部实现。
> 跨世界不能直接读对方变量，需通过参数/返回值，或借助共享的 DOM 传递数据。

## 六、Cookie 与存储操作
### 1. 两套 Cookie 存储
```swift
let cookieStore = webView.configuration.websiteDataStore.httpCookieStore

// 写入
cookieStore.setCookie(cookie) { /* 完成 */ }

// 读取
cookieStore.getAllCookies { cookies in
    cookies.forEach { print($0.name, $0.value) }
}

// 删除
cookieStore.delete(cookie) { /* 完成 */ }
```
- `WKHTTPCookieStore` 只服务 WKWebView；`NSHTTPCookieStorage` 服务 `URLSession`；
- 二者**不自动同步**，登录态需要手动搬运：

```swift
// URLSession → WKWebView
HTTPCookieStorage.shared.cookies?.forEach { cookieStore.setCookie($0) }

// WKWebView → URLSession
cookieStore.getAllCookies { cookies in
    cookies.forEach { HTTPCookieStorage.shared.setCookie($0) }
}
```
- 监听变化：实现 `WKHTTPCookieStoreObserver` 的 `cookiesDidChange(in:)`。

### 2. 清理缓存与站点数据
```swift
let store = webView.configuration.websiteDataStore
let types = WKWebsiteDataStore.allWebsiteDataTypes()
store.removeData(ofTypes: types,
                 modifiedSince: .distantPast) { /* 完成 */ }
```
| 数据类型 | 常量 | 说明 |
|---|---|---|
| Cookie | `WKWebsiteDataTypeCookies` | 登录态 |
| 磁盘缓存 | `WKWebsiteDataTypeDiskCache` | 资源缓存 |
| 内存缓存 | `WKWebsiteDataTypeMemoryCache` | 需重启进程才彻底释放 |
| localStorage | `WKWebsiteDataTypeLocalStorage` | 键值存储 |
| IndexedDB | `WKWebsiteDataTypeIndexedDBDatabases` | 结构化数据 |
| Service Worker | `WKWebsiteDataTypeServiceWorkers` | 离线能力 |
| WebSQL | `WKWebsiteDataTypeWebSQLDatabases` | 已废弃但仍可能存在 |

> 只清缓存别清 Cookie：按类型分开清理，避免把用户踢下线。

### 3. 无痕模式
```swift
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
```
Cookie、localStorage、IndexedDB 都只存在内存，销毁 WebView 即清空；适合隐私页、第三方登录授权页。

### 4. ITP 与第三方 Cookie
- Safari 的 ITP 同样作用于 WKWebView：无用户交互的站点，脚本可写存储有 7 天上限；
- 第三方 Cookie 默认受限，跨域 iframe 登录经常失效；
- 关键凭证交给原生 Keychain 保存，不要只依赖网页存储。

## 七、原生 UI 与媒体控制
### 1. 滚动与外观
```swift
webView.scrollView.bounces = true
webView.scrollView.alwaysBounceVertical = true
webView.scrollView.keyboardDismissMode = .interactive
webView.scrollView.contentInsetAdjustmentBehavior = .never
webView.isOpaque = false
webView.backgroundColor = .clear
webView.underPageBackgroundColor = .systemBackground   // iOS 15+
webView.pageZoom = 1.0                                  // iOS 14+
```
| 属性 | 用途 | 注意 |
|---|---|---|
| `allowsBackForwardNavigationGestures` | 左右滑返回 | 与原生全屏手势可能冲突 |
| `allowsLinkPreview` | 长按链接预览 | 可关闭以减少干扰 |
| `customUserAgent` | 自定义 UA | 设为 nil 恢复默认 |
| `themeColor` | 网页 `theme-color` | iOS 15+，可用于状态栏配色 |
| `isOpaque` / `backgroundColor` | 透明背景 | 透明会带来额外合成成本 |

### 2. 媒体播放
```swift
config.allowsInlineMediaPlayback = true
config.mediaTypesRequiringUserActionForPlayback = []
config.allowsPictureInPictureMediaPlayback = true
config.allowsAirPlayForMediaPlayback = true
```
- iOS 默认禁止自动播放带声音的视频，`mediaTypesRequiringUserActionForPlayback = []` 才放开；
- 全屏播放由 WebKit 接管，退出全屏后注意恢复原生界面方向；
- 后台播放需要配置 `UIBackgroundModes` 的 `audio`。

### 3. 查找与缩放
```swift
let config = WKFindConfiguration()
config.backwards = false
config.caseSensitive = false
config.wraps = true
webView.find("关键词", configuration: config) { result in
    print(result.matchFound)
}
```
适合站内搜索高亮；`pageZoom` 适合适老化，但会影响布局，需配合页面 `viewport` 测试。

## 八、文件上传、下载与权限
### 1. 文件上传
```swift
func webView(_ webView: WKWebView,
             runOpenPanelWith parameters: WKOpenPanelParameters,
             initiatedByFrame frame: WKFrameInfo,
             completionHandler: @escaping ([URL]?) -> Void) {
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image, .pdf])
    picker.allowsMultipleSelection = parameters.allowsMultipleSelection
    // present 后，在 delegate 里把选中的 URL 回传
    completionHandler(selectedURLs)
}
```
- `<input type="file">` 必须实现该代理，否则点击无反应；
- 选择 iCloud 文件要先 `startAccessingSecurityScopedResource()`。

### 2. 下载（iOS 14.5+）
```swift
func webView(_ webView: WKWebView,
             navigationAction: WKNavigationAction,
             didBecome download: WKDownload) {
    download.delegate = self
}

func webView(_ webView: WKWebView,
             navigationResponse: WKNavigationResponse,
             didBecome download: WKDownload) {
    download.delegate = self
}

extension WebViewController: WKDownloadDelegate {
    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(suggestedFilename)
        completionHandler(url)
    }
    func downloadDidFinish(_ download: WKDownload) { /* 移动到沙盒/分享 */ }
    func download(_ download: WKDownload,
                  didFailWithError error: Error,
                  resumeData: Data?) { /* 记录失败 */ }
}
```
触发下载的两条路径：
- `navigationAction.shouldPerformDownload == true`（如 `download` 属性）；
- 响应 MIME 无法展示时，在 `decidePolicyFor navigationResponse` 返回 `.download`。

### 3. 相机、麦克风与定位权限
```swift
func webView(_ webView: WKWebView,
             requestMediaCapturePermissionFor origin: WKSecurityOrigin,
             initiatedByFrame frame: WKFrameInfo,
             type: WKMediaCaptureType,
             decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == "example.com" ? .grant : .deny)
}
```
- 还必须在 `Info.plist` 配置 `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`，否则直接崩溃；
- 定位需要 `NSLocationWhenInUseUsageDescription`，并实现 `requestGeolocationPermissionFor`；
- 权限决策应校验 `origin.host`，不要无条件 `.grant`。

### 4. JS 弹窗与新窗口
```swift
// alert / confirm / prompt 必须实现 WKUIDelegate，否则默认无反应
func webView(_ webView: WKWebView,
             runJavaScriptAlertPanelWithMessage message: String,
             initiatedByFrame frame: WKFrameInfo,
             completionHandler: @escaping () -> Void) {
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
    present(alert, animated: true)
}

// target="_blank" / window.open
func webView(_ webView: WKWebView,
             createWebViewWith configuration: WKWebViewConfiguration,
             for navigationAction: WKNavigationAction,
             windowFeatures: WKWindowFeatures) -> WKWebView? {
    webView.load(navigationAction.request)   // 简单方案：当前页打开
    return nil
}
```
> 返回新建的 WKWebView 时，必须把它加入视图层级并持有，否则页面会立刻被释放。

## 九、快照、PDF 与打印
### 1. 截图
```swift
let config = WKSnapshotConfiguration()
config.rect = webView.bounds
config.afterScreenUpdates = true
config.snapshotWidth = NSNumber(value: 750)   // 可选：指定输出宽度
webView.takeSnapshot(with: config) { image, error in
    // image 可用于转场、分享、白屏检测
}
```
- `afterScreenUpdates = true` 会强制等待下一次提交，**有性能成本**，不要高频调用；
- 截长图需要先调整 `scrollView` 或分段截图拼接。

### 2. 导出 PDF
```swift
let config = WKPDFConfiguration()
config.rect = webView.bounds   // 不设置则截取可视区域
webView.createPDF(configuration: config) { result in
    switch result {
    case .success(let data): /* 保存/分享 */
    case .failure(let error): print(error)
    }
}
```
`createPDF` 生成的是矢量 PDF，适合合同、票据、文章；超长页面注意内存。

### 3. 打印
```swift
let info = UIPrintInfo(dictionary: nil)
info.outputType = .general
let controller = UIPrintInteractionController.shared
controller.printInfo = info
controller.printFormatter = webView.viewPrintFormatter()
controller.present(animated: true)
```
> 打印前可注入 `@media print` 样式，隐藏导航、广告、按钮。

## 十、监控体系：从「能打开」到「可观测」
### 1. 监控分层
```
┌─ 业务层：打开率、停留、转化、白屏率
├─ Web 层：FCP/LCP、JS 错误、资源失败、路由、Bridge
├─ 原生层：导航耗时、HTTP 状态、TLS、进程终止、内存警告
├─ 进程层：WebContent 崩溃、Jetsam、CPU/内存（Instruments）
└─ 网络层：DNS/TLS/TTFB、CDN、服务端日志
```
> 只做其中一层，都会得到「看起来有数据、但定位不了问题」的监控。

### 2. 原生侧指标

| 指标 | 采集方式 | 价值 |
|---|---|---|
| 加载进度 | KVO `estimatedProgress` | 进度条、卡住检测 |
| 加载状态 | KVO `loading` | 判断是否仍在请求 |
| 标题/URL | KVO `title` / `url` | 页面识别、路由统计 |
| 前进后退 | KVO `canGoBack` / `canGoForward` | 容器状态 |
| 导航各阶段耗时 | 在 delegate 回调里打时间戳 | 定位 DNS/TLS/首字节/渲染慢 |
| HTTP 状态码 | `decidePolicyFor navigationResponse` 取 `response` | 4xx/5xx 监控 |
| 重定向次数 | `didReceiveServerRedirect...` 计数 | 跳转链异常 |
| 错误码 | `didFail` / `didFailProvisional` | 网络与证书问题 |
| 内容进程终止 | `webViewWebContentProcessDidTerminate` | 白屏/闪退的核心指标 |
| 证书状态 | `serverTrust` / `hasOnlySecureContent` | 中间人、混合内容 |
| 内存警告 | `didReceiveMemoryWarning` | 容器内存压力 |
| Bridge 调用 | 自建计数/耗时/错误码 | 端能力可用性 |
| 崩溃/卡顿 | MetricKit + 信号捕获 | App 级兜底 |
| 关键路径 | `os_signpost` | 与 Instruments 对齐 |

导航耗时打点示例：
```swift
private var navStart: CFTimeInterval = 0

func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    navStart = CACurrentMediaTime()
    metrics["start"] = navStart
}
func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    metrics["commit"] = CACurrentMediaTime() - navStart
}
func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    metrics["finish"] = CACurrentMediaTime() - navStart
}
```

### 3. Web 侧指标（注入 JS SDK）

| 指标 | API | 说明 |
|---|---|---|
| 导航耗时 | `performance.getEntriesByType("navigation")` | DNS/TCP/TLS/TTFB/DOMReady/load |
| FCP | `PerformanceObserver("paint")` | 首次内容绘制 |
| LCP | `PerformanceObserver("largest-contentful-paint")` | 最大内容绘制，需 Safari 支持版本 |
| CLS | `PerformanceObserver("layout-shift")` | 部分 WebKit 版本不支持，需降级 |
| 长任务/INP | Event Timing / rAF 间隔 | Safari 对 Long Tasks API 支持有限，需兜底实现 |
| 资源耗时 | `PerformanceObserver("resource")` | 慢资源、失败资源 |
| JS 错误 | `window.onerror` | 含堆栈、行列号 |
| Promise 异常 | `unhandledrejection` | 异步错误 |
| 资源加载失败 | `window.addEventListener("error", handler, true)` | 捕获阶段才能拿到 img/script 失败 |
| CSP 违规 | `securitypolicyviolation` | 安全策略误杀 |
| FPS | `requestAnimationFrame` 采样 | JS 侧估算，不能代表 GPU |
| SPA 路由 | 拦截 `pushState`/`replaceState` + `popstate` | 单页应用页面级指标 |
| 白屏探针 | DOM 内容 + 心跳 | 见下一节 |

### 4. 白屏检测的四种手段
1. **JS 心跳**：页面加载后每 5 秒 `postMessage`，原生超时未收到 → 判定异常；
2. **DOM 探针**：`document.body.innerText.trim().length` 或根节点子元素数量；
3. **截图取样**：`takeSnapshot` 后统计像素方差/空白比例（成本高，抽样使用）；
4. **加载超时**：`didStartProvisional` 后 N 秒仍未 `didCommit`/`didFinish` → 判定失败。

```js
// 页面侧：首屏探针
function reportBlankCheck() {
  const text = (document.body?.innerText || "").trim();
  const nodes = document.querySelector("#app")?.children.length || 0;
  window.webkit?.messageHandlers?.monitor?.postMessage({
    type: "blank_check",
    payload: { textLength: text.length, nodeCount: nodes, readyState: document.readyState }
  });
}
setTimeout(reportBlankCheck, 3000);
```
> 白屏判定要结合「文本长度 + 节点数 + 首屏截图」，单看 `body` 是否为空会误判 Canvas/视频类页面。

### 5. 网络监控的现实限制
- `NSURLProtocol` **拦不到** WKWebView：请求发生在 Networking 进程；
- `WKNavigationDelegate` 只能看到主文档，看不到子资源；
- `WKURLSchemeHandler` 只能处理自定义 scheme，不能接管 http/https；
- 可行方案：
  1. JS 侧包装 `fetch` / `XMLHttpRequest`，记录状态码、耗时、失败原因；
  2. `PerformanceObserver("resource")` 拿资源级耗时；
  3. 服务端日志与 CDN 日志对齐；
  4. 调试期用本地代理（Charles/Proxyman）或 `ios-webkit-debug-proxy`。

```js
// fetch 包装（示意）
const report = (type, payload) => {
  try {
    window.webkit.messageHandlers.monitor.postMessage({ type, payload, ts: Date.now() });
  } catch (e) {}
};
const rawFetch = window.fetch;
window.fetch = async function (...args) {
  const start = performance.now();
  try {
    const res = await rawFetch.apply(this, args);
    report("fetch", { url: String(args[0]), status: res.status, cost: performance.now() - start });
    return res;
  } catch (e) {
    report("fetch_error", { url: String(args[0]), message: String(e), cost: performance.now() - start });
    throw e;
  }
};
```

### 6. 监控 SDK 的注入与上报
```swift
let monitorJS = """
(function () {
  if (window.__monitorInstalled) return;
  window.__monitorInstalled = true;
  const send = (type, payload) => {
    try {
      window.webkit.messageHandlers.monitor.postMessage({ type, payload, ts: Date.now() });
    } catch (e) {}
  };
  window.addEventListener("error", (e) => {
    if (e.target && e.target !== window) {
      return send("resource_error", { url: e.target.src || e.target.href, tag: e.target.tagName });
    }
    send("js_error", { message: e.message, stack: e.error && e.error.stack,
                       source: e.filename, line: e.lineno, col: e.colno });
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    send("promise_rejection", { reason: String(e.reason), stack: e.reason && e.reason.stack });
  });
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav) send("navigation_timing", {
    ttfb: nav.responseStart, domReady: nav.domContentLoadedEventEnd, load: nav.loadEventEnd
  });
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.name === "first-contentful-paint") send("fcp", { value: entry.startTime });
      });
    }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) send("lcp", { value: last.startTime, element: last.element && last.element.tagName });
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {}
  setInterval(() => send("heartbeat", { url: location.href, ready: document.readyState }), 5000);
})();
"""
contentController.addUserScript(WKUserScript(
    source: monitorJS,
    injectionTime: .atDocumentStart,
    forMainFrameOnly: true,
    in: .defaultClient      // 与页面隔离，避免被业务脚本覆盖
))
contentController.add(self, name: "monitor")
```
上报架构建议：
1. JS 侧先缓冲，批量 `postMessage`，避免高频跨进程调用；
2. 原生侧落盘（SQLite/文件），按网络状态重试；
3. 每条日志带 `sessionId`、`pageId`、`url`、`ts`、`appVersion`、`osVersion`；
4. 采样：高性能页面 10%，核心页面 100%；
5. 脱敏：不采集输入框内容、Cookie、Authorization；
6. JS 堆栈通过 sourcemap 在服务端还原。

### 7. 告警指标示例

| 指标 | 建议阈值 | 说明 |
|---|---|---|
| 白屏率 | < 0.5% | 按容器打开次数统计 |
| JS 错误率 | < 1% | 错误会话 / 总会话 |
| Bridge 失败率 | < 0.1% | 含超时、原生异常 |
| LCP P75 | < 2.5s | 按页面类型分桶 |
| 内容进程终止率 | < 0.1% | 重点机型单独看 |
| 首屏加载 P95 | < 3s | 含 DNS/TLS |
| 4xx/5xx 占比 | < 1% | 主文档 |

### 8. 线上调试
- `isInspectable` **只在 Debug/Internal 打开**，Release 必须关闭；

```swift
#if DEBUG
webView.isInspectable = true   // iOS 16.4+
#endif
```
- 内部包可注入 Eruda / vConsole，用悬浮按钮看 console、网络、DOM；
- 线上问题靠「日志 + 快照 + 页面 URL + 机型/系统版本」定位，不要指望连真机调试；
- 自动化测试可用 Appium / WebDriverAgent 切换 WebView 上下文。

### 9. 监控误区
1. ❌ 只看 `didFinish`：它只代表主文档加载完，首屏可能仍是白屏；
2. ❌ 只埋 H5 业务点：容器级错误（进程被杀、TLS 失败、Bridge 不通）根本采不到；
3. ❌ 全量采集：高频 `postMessage` 本身就会拖慢页面；
4. ❌ 采集用户输入：隐私合规风险，且体积巨大；
5. ❌ 把 WebContent 崩溃算成 App 崩溃：两者恢复策略完全不同；
6. ❌ 忽略 `-999`：主动取消会污染错误率。

## 十一、深入：WKWebView 的内部机制
### 1. 三进程协作
- **UIProcess（App 进程）**：持有 WKWebView、处理触摸/键盘、合成图层、执行导航代理；
- **Networking 进程**：DNS、TLS、HTTP 缓存、Cookie 附加，多个 WebView 共享；
- **WebContent 进程**：HTML 解析、DOM/CSSOM、JS 执行、布局、绘制指令。

WebContent 不直接把像素交给屏幕：它生成图层树，通过 RemoteLayerTree 同步给 UIProcess，由 App 进程用 CoreAnimation 合成上屏。这解释了两个现象：
- `webView.subviews` 里看不到 DOM 元素；
- 原生视图叠加在 WebView 上时，会与网页内容争抢合成层级。

### 2. 进程交换（PSON）
跨站导航时，WebKit 可能把页面切到新的 WebContent 进程（Process Swap On Navigation）。因此：
- 不要假设同一个 WKWebView 的页面始终在同一个进程；
- 页面级全局状态可能随进程切换丢失；
- Cookie/缓存仍由 Networking 进程与 DataStore 统一管理，不受进程切换影响。

### 3. JavaScriptCore 与 JIT
- WKWebView 的 JS 在 WebContent 进程运行，使用 JIT；
- App 进程无法直接拿到 `JSContext`，这是与 UIWebView 最大的架构差异；
- 所有互调必须经过消息序列化 + IPC，天然异步；
- `WKContentWorld` 在同一个 JS 上下文里创建多个全局对象，实现逻辑隔离，而不是进程隔离。

### 4. 自定义 Scheme 的实现细节
- `WKURLSchemeHandler` 在 App 侧被调用，需要把数据流通过 IPC 送回 WebContent；
- 必须实现 `webView(_:start:)` 与 `webView(_:stop:)`，并正确调用 `didReceive response` / `didReceive data` / `didFinish`；
- 不能注册 `http`、`https`、`file`（可用 `WKWebView.handlesURLScheme("http")` 判断某个 scheme 是否已被 WebKit 接管）；
- 适合离线包、加密资源解密、本地数据库导出；不适合做全量网络代理（性能与能力都受限）。

### 5. 内存与 Jetsam
- WebContent 进程有独立的内存上限，超限会被系统杀掉，App 只会收到 `webViewWebContentProcessDidTerminate`；
- 图片、Canvas、大量 DOM、JS 堆是主要占用；
- 无法从 App 侧直接读取 WebContent 内存，需用 Instruments 附加到 WebContent 进程观察；
- 恢复策略：保存 URL + 滚动位置 + 关键表单状态，重建 WebView 并提示用户。

### 6. 后台与生命周期
- App 进入后台后，WebContent 可能被挂起，`setTimeout` / `setInterval` 被节流；
- 依赖网页定时器的业务（心跳、倒计时）在后台不可靠，关键逻辑放原生；
- 音频后台播放需要 `UIBackgroundModes: audio`；
- WebView 销毁前先 `stopLoading()`，并移除 handler，避免回调打到已释放对象。

### 7. App-Bound Domains
```xml
<!-- Info.plist -->
<key>WKAppBoundDomains</key>
<array>
  <string>example.com</string>
  <string>cdn.example.com</string>
</array>
```
```swift
config.limitsNavigationsToAppBoundDomains = true
```
- 限制 WebView 只能导航到白名单域名，降低钓鱼与脚本注入风险；
- 开启后未列入的域名会导航失败（常见表现：白屏）；
- 不是万能的：仍要配合 CSP、Bridge 白名单、参数校验。

### 8. 内容拦截器
```swift
let rules = """
[{"trigger":{"url-filter":".*\\\\.gif"},"action":{"type":"block"}},
 {"trigger":{"url-filter":".*"},"action":{"type":"css-display-none","selector":".ad"}}]
"""
WKContentRuleListStore.default()?.compileContentRuleList(
    forIdentifier: "basic",
    encodedContentRuleList: rules
) { list, error in
    if let list { self.contentController.add(list) }
}
```
- 规则在 WebContent 进程执行，能拦截资源、隐藏元素、限制 Cookie；
- 规则数量有上限（约 15 万条），编译有成本，建议启动后异步编译并缓存；
- 与 JS 注入相比，内容拦截器不污染页面全局对象，更适合广告/追踪拦截。

### 9. 私有 API 的边界
- `WKPreferences` 的 `_features`、`_setEnabled` 以及各类 `_` 前缀扩展接口均为私有 API；
- 私有 API 会导致审核拒绝，且系统升级随时失效；
- 需要实验性 Web 特性时，优先通过公开配置或服务端开关降级，不要赌私有接口。

### 10. 版本能力速查

| 能力 | 最低版本 |
|---|---|
| WKWebView | iOS 8 |
| `WKURLSchemeHandler` / `takeSnapshot` / `createPDF` | iOS 11 |
| `WKWebpagePreferences` / 内容模式 / 上下文菜单 | iOS 13 |
| `WKContentWorld` / `callAsyncJavaScript` / `WKScriptMessageHandlerWithReply` / `pageZoom` / `find` | iOS 14 |
| 下载（`WKDownload`） | iOS 14.5 |
| `interactionState` / `loadSimulatedRequest` / 媒体捕获权限 / 定位权限 / `underPageBackgroundColor` | iOS 15 |
| `isInspectable` | iOS 16.4 |

## 十二、性能优化操作清单
1. **预热**：启动时创建 WKWebView 加载 `about:blank`，复用进程与 DataStore；
2. **复用**：列表/活动页池化 WebView，复用时先 `stopLoading`、清空 delegate 回调状态；
3. **缓存**：依赖 HTTP 缓存头与 DataStore，不要每次都 `reloadFromOrigin`；
4. **首屏**：SSR/预渲染、关键 CSS 内联、`preconnect`、图片 `srcset` + WebP/AVIF；
5. **滚动**：虚拟列表、`passive` 事件、避免强制同步布局、少用 `backdrop-filter`；
6. **Bridge**：批量、降频、避免 base64 大对象、超时与重试；
7. **图片**：按显示尺寸解码，长列表懒加载，及时释放不可见大图；
8. **恢复**：处理内容进程终止，保存 URL/滚动位置，重建后恢复；
9. **转场**：用当前页快照做 push 动画，避免白屏闪烁；
10. **内存**：非可见 WebView 及时销毁，低内存时清缓存与图片。

## 十三、常见坑清单
1. **初始化后再改 configuration**：改的是副本，必须 init 前配置；
2. **`webView.configuration` 是副本**：通过它改 `userContentController` 无效；
3. **handler 循环引用**：`userContentController` 强引用 handler；
4. **delegate 是 weak**：WebView 销毁后回调不再触发，别把逻辑挂在 delegate 生命周期上；
5. **Cookie 不共享**：`WKHTTPCookieStore` ≠ `NSHTTPCookieStorage`；
6. **`NSURLProtocol` 无效**：跨进程，拦不到；
7. **自定义 Header 只对主文档生效**：子资源不会继承；
8. **`target="_blank"` 无反应**：必须实现 `createWebViewWith`；
9. **JS 弹窗无反应**：必须实现 `WKUIDelegate`；
10. **`loadFileURL` 后接口全挂**：`file://` 的 origin 与 CORS 限制；
11. **`-999` 被当故障**：主动取消会污染错误率；
12. **`didFailProvisional` 与 `didFail` 混用**：一个在提交前，一个在提交后；
13. **`isInspectable` 带到 Release**：安全风险，线上包不应开启；
14. **内容进程被杀不恢复**：用户看到永久白屏；
15. **App-Bound Domains 配漏域名**：导航直接失败；
16. **主线程同步等待 Bridge**：WebView 与 Bridge 都是异步模型，同步等待必然卡死。

## 十四、速查表

| 需求 | API |
|---|---|
| 加载网页 | `load(URLRequest)` |
| 加载本地包 | `loadFileURL(_:allowingReadAccessTo:)` |
| 加载 HTML 字符串 | `loadHTMLString(_:baseURL:)` |
| 执行 JS | `evaluateJavaScript` / `callAsyncJavaScript` |
| 注入脚本 | `WKUserScript` + `addUserScript` |
| JS 调原生 | `WKScriptMessageHandler` / `WithReply` |
| 原生调 JS | `evaluateJavaScript` / `callAsyncJavaScript` |
| 拦截导航 | `decidePolicyFor navigationAction` |
| 拦截响应/下载 | `decidePolicyFor navigationResponse` |
| 新窗口 | `createWebViewWith` |
| 文件上传 | `runOpenPanelWith` |
| 下载 | `WKDownloadDelegate` |
| Cookie | `WKHTTPCookieStore` |
| 清缓存 | `WKWebsiteDataStore.removeData` |
| 无痕 | `WKWebsiteDataStore.nonPersistent()` |
| 截图 | `takeSnapshot` |
| 导出 PDF | `createPDF` |
| 打印 | `viewPrintFormatter` |
| 查找 | `find(_:configuration:completionHandler:)` |
| 缩放 | `pageZoom` |
| 会话恢复 | `interactionState` |
| 离线兜底页 | `loadSimulatedRequest` |
| 调试 | `isInspectable`（仅 Debug） |
| 进程终止 | `webViewWebContentProcessDidTerminate` |
