---
title: "WKWebView detailed explanation: configuration, operation and monitoring"
lang: en
translatedFrom: ac66b4799359753687ef760aab10ccdef40004f94b24eab325678f74d76754f5
translatedAt: 2026-11-21
---

# WKWebView detailed explanation: configuration, operation and monitoring
> In one sentence: **WKWebView is the application-side entrance of WebKit on iOS. The App process, Networking process, and WebContent process collaborate to complete loading, execution, and rendering; the key to making good use of it is to understand the process boundaries and establish operating specifications and monitoring systems around the boundaries.**
Division of labor between > and `12-WebView跨端深入.md`: 12 talks about the role of WebView in the cross-end/Hybrid container. This article focuses on the API, operation manual, monitoring and internal mechanism of WKWebView itself.

## 1. Object model: first recognize these categories
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
| Class | Function | Key point |
|---|---|---|
| `WKWebView` | Browser view | Must be created and operated on the main thread |
| `WKWebViewConfiguration` | Copy** when initializing the configuration | **init, and then changing it will be invalid |
| `WKPreferences` | JS, fonts, scam site warning | `javaScriptEnabled` Deprecated in favor of `WKWebpagePreferences` |
| `WKWebpagePreferences` | JS / desktop mode for single navigation | iOS 13+, can be dynamically set by navigation |
| `WKUserContentController` | Script injection and message channel | Strong reference handler, pay attention to circular reference |
| `WKWebsiteDataStore` | Storage and cache | `default()` persistence, `nonPersistent()` memory state |
| `WKProcessPool` | Process pool | Opaque, do not use it for security isolation |
| `WKContentWorld` | JS Global Object Isolation | iOS 14+, page/defaultClient/custom |

## 2. Initialization: a configuration that can be used directly
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
### The three easiest points to step on during the configuration phase
1. **`configuration` is the value copy**: `webView.configuration.userContentController.add(...)` is a copy, which is invalid for the created WebView. Keep the `contentController` reference you created;
2. **`websiteDataStore` must be set before init**: persistence/incognito mode cannot be switched after creation;
3. **`limitsNavigationsToAppBoundDomains`** is turned off by default: `WKAppBoundDomains` must be configured after turning it on, otherwise the navigation will fail directly and appear as a white screen.

## 3. Loading content: seven ways

| Method | API | Scenario | Note |
|---|---|---|---|
| Remote URL | `load(URLRequest)` | Regular H5 | Can bring method/body/header |
| local file | `loadFileURL(_:allowingReadAccessTo:)` | offline package | `file://` under fetch/storage/SW restricted |
| HTML string | `loadHTMLString(_:baseURL:)` | Email, template, error page | `baseURL` Affects relative path and same-origin policy |
| Data | `load(_:mimeType:characterEncodingName:baseURL:)` | Decoded binary | The encoding name must be accurate |
| Simulated response | `loadSimulatedRequest(_:responseHTMLString:)` | Offline bottom page | iOS 15+, does not initiate a real request |
| Custom Scheme | `WKURLSchemeHandler` | Local resource mapping | can only register non-http/https/file scheme |
| Local service | `127.0.0.1` HTTP Server | Requires complete web capabilities | Pay attention to port conflicts and security |

### 1. POST and custom header
```swift
var request = URLRequest(url: URL(string: "https://example.com/api")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
request.httpBody = try JSONEncoder().encode(payload)
webView.load(request)
```
> Important limitation: **Custom Header only takes effect** for the main document request, and sub-resources such as XHR, fetch, pictures, scripts, etc. in the page will not be inherited. When unified authentication is required, use cookies, server sessions, or custom scheme handlers; do not expect that changing `URLRequest` will cover all sub-requests.

### 2. Local offline package
```swift
let index = bundleURL.appendingPathComponent("index.html")
webView.loadFileURL(index, allowingReadAccessTo: bundleURL)
```
- `allowingReadAccessTo` must be a directory containing `index.html`, otherwise relative resource 404;
The origin of - `file://` is `null`, CORS, Cookie, Service Worker, and some storage APIs will be invalid;
When - needs to run "like http", give priority to `WKURLSchemeHandler` or local HTTP service.

### 3. Forward, backward and status recovery
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
> `interactionState` only restores the WebKit side state. Unsubmitted sensitive data and native side state in the form still need to be saved by yourself.

## 4. Navigation Agent: Timing and Decision-making
### 1. Callback sequence for a successful load
```
decidePolicyFor navigationAction
  → didStartProvisionalNavigation
  → didReceiveServerRedirectForProvisionalNavigation（可多次）
  → decidePolicyFor navigationResponse
  → didCommit
  → didFinish
```
 failure path:
- Request phase failed → `didFailProvisionalNavigation` (DNS, TLS, disconnection);
- failed after submission → `didFail` (page crash, resource interruption);
- content process was killed → `webViewWebContentProcessDidTerminate`.

### 2. Interception and release
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
### 3. Authentication and certificate
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
### 4. Common error codes

| code | meaning | typical cause |
|---|---|---|
| `-999` | `NSURLErrorCancelled` | Active stop, policy cancel, repeat load |
| `-1001` | Request timeout | Weak network, slow server |
| `-1003` | Host not found | DNS / domain name error |
| `-1004` | Unable to connect to | port, service not started |
| `-1005` | Connection lost | Network switching |
| `-1009` | No network | Offline |
| `-1022` | ATS prohibits plain text | http No exceptions configured |
| `-1200` | SSL handshake failed | Certificate expired, chain is incomplete, Pinning failed |
| `-1202` | Invalid certificate | Self-signed / middleman |

> Do not report `-999` as a fault, otherwise the monitoring noise will drown out the real errors.

## 5. JS Interactive Operation Manual
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
 key points:
- `evaluateJavaScript` is called back in the **main thread**. The return value only supports `String` / `NSNumber` / `NSNull` / array / dictionary and other bridging types;
- Do not use string concatenation to stuff user input into JS, give priority to `arguments` of `callAsyncJavaScript`;
Executing JS will fail when the - page has not been loaded, at least until `didCommit`.

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
- `message.body` only supports JSON serializable types; `Date`, `undefined`, functions will be lost or throw errors;
- `message.frameInfo.isMainFrame` can filter iframe calls;
- `WKUserContentController` **strongly references the** handler. Direct registration of `self` will form a `webView → config → controller → self → webView` loop, which is disconnected with a weak proxy or `removeAllScriptMessageHandlers()`.

### 3. Weak proxy writing method
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
### 4. Message with reply (iOS 14+)
```swift
contentController.addScriptMessageHandler(self, contentWorld: .page, name: "bridge")
// 实现：userContentController(_:didReceive:replyHandler:)
```
JS side `postMessage` will return Promise, which is suitable for the "request-response" model and eliminates the need for handwritten callbackId.

### 5. Content World: Isolate injection environment
```swift
let world = WKContentWorld.world(name: "app_internal")
webView.evaluateJavaScript(js, in: nil, in: world)
```
- `.page`: Share the global object with the page, the page can see and tamper with your variables;
- `.defaultClient`: All injected scripts are shared and the page is invisible;
- `.world(name:)`: Customized isolation world, suitable for internal implementation of Bridge.
> cannot directly read each other's variables across worlds. Data needs to be passed through parameters/return values, or through a shared DOM.

## 6. Cookie and storage operations
### 1. Two sets of cookie storage
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
- `WKHTTPCookieStore` only serves WKWebView; `NSHTTPCookieStorage` serves `URLSession`;
- and **do not automatically synchronize**, and the login state needs to be manually moved:

```swift
// URLSession → WKWebView
HTTPCookieStorage.shared.cookies?.forEach { cookieStore.setCookie($0) }

// WKWebView → URLSession
cookieStore.getAllCookies { cookies in
    cookies.forEach { HTTPCookieStorage.shared.setCookie($0) }
}
```
 - Listen for changes: `cookiesDidChange(in:)` that implements `WKHTTPCookieStoreObserver`.

### 2. Clean cache and site data
```swift
let store = webView.configuration.websiteDataStore
let types = WKWebsiteDataStore.allWebsiteDataTypes()
store.removeData(ofTypes: types,
                 modifiedSince: .distantPast) { /* 完成 */ }
```
| Data type | Constant | Description |
|---|---|---|
| Cookie | `WKWebsiteDataTypeCookies` | Login status |
| Disk cache | `WKWebsiteDataTypeDiskCache` | Resource cache |
| memory cache | `WKWebsiteDataTypeMemoryCache` | The process needs to be restarted to completely release |
| localStorage | `WKWebsiteDataTypeLocalStorage` | key-value storage |
| IndexedDB | `WKWebsiteDataTypeIndexedDBDatabases` | Structured data |
| Service Worker | `WKWebsiteDataTypeServiceWorkers` | Offline capability |
| WebSQL | `WKWebsiteDataTypeWebSQLDatabases` | Deprecated but may still exist |

> Only clear cache, not cookies: clean them separately by type to avoid kicking users offline.

### 3. Incognito mode
```swift
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
```
Cookie, localStorage, and IndexedDB only exist in memory and are destroyed. WebView is cleared; suitable for privacy pages and third-party login authorization pages.

### 4. ITP and third-party cookies
- Safari's ITP also works on WKWebView: a site without user interaction, with a 7-day upper limit for script-writable storage;
- Third-party cookies are restricted by default, and cross-domain iframe login often fails;
- Leave the key credentials to the native Keychain for storage. Do not just rely on web page storage.

## 7. Native UI and media control
### 1. Scroll and appearance
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
| Property | Purpose | Note |
|---|---|---|
| `allowsBackForwardNavigationGestures` | Swipe left or right to return | May conflict with native full-screen gestures |
| `allowsLinkPreview` | Long press link preview | Can be turned off to reduce interference |
| `customUserAgent` | Customize UA | Set to nil Restore default |
| `themeColor` | Web `theme-color` | iOS 15+, can be used for status bar color |
| `isOpaque` / `backgroundColor` | Transparent background | Transparency will bring additional synthesis costs |

### 2. Media playback
```swift
config.allowsInlineMediaPlayback = true
config.mediaTypesRequiringUserActionForPlayback = []
config.allowsPictureInPictureMediaPlayback = true
config.allowsAirPlayForMediaPlayback = true
```
- iOS prohibits automatic playback of videos with sound by default, and `mediaTypesRequiringUserActionForPlayback = []` only allows it;
- full-screen playback is taken over by WebKit. After exiting full-screen, pay attention to restoring the original interface direction;
- background playback requires `audio` configured with `UIBackgroundModes`.

### 3. Search and zoom
```swift
let config = WKFindConfiguration()
config.backwards = false
config.caseSensitive = false
config.wraps = true
webView.find("关键词", configuration: config) { result in
    print(result.matchFound)
}
```
 is suitable for site search highlighting; `pageZoom` is suitable for aging, but it will affect the layout and needs to be tested with the page `viewport`.

## 8. File upload, download and permissions
### 1. File upload
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
- `<input type="file">` must implement this agent, otherwise there will be no response when clicking;
- Select iCloud files to `startAccessingSecurityScopedResource()` first.

### 2. Download (iOS 14.5+)
Two paths for ```swift
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
 to trigger download:
- `navigationAction.shouldPerformDownload == true` (such as `download` attribute);
When the - response MIME cannot be displayed, `.download` is returned in `decidePolicyFor navigationResponse`.

### 3. Camera, microphone and positioning permissions
```swift
func webView(_ webView: WKWebView,
             requestMediaCapturePermissionFor origin: WKSecurityOrigin,
             initiatedByFrame frame: WKFrameInfo,
             type: WKMediaCaptureType,
             decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == "example.com" ? .grant : .deny)
}
```
- `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` must also be configured in `Info.plist`, otherwise it will crash directly;
- positioning requires `NSLocationWhenInUseUsageDescription` and implements `requestGeolocationPermissionFor`;
- Permission decisions should be verified against `origin.host`, not unconditionally `.grant`.

### 4. JS pop-up window and new window
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
> When returning the newly created WKWebView, it must be added to the view hierarchy and held, otherwise the page will be released immediately.

## 9. Snapshot, PDF and printing
### 1. Screenshot
```swift
let config = WKSnapshotConfiguration()
config.rect = webView.bounds
config.afterScreenUpdates = true
config.snapshotWidth = NSNumber(value: 750)   // 可选：指定输出宽度
webView.takeSnapshot(with: config) { image, error in
    // image 可用于转场、分享、白屏检测
}
```
- `afterScreenUpdates = true` will be forced to wait for the next submission. **has a performance cost of**. Do not call it frequently;
- long screenshots need to be adjusted `scrollView` or segmented screenshots are stitched together.

### 2. Export PDF
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
`createPDF` generates vector PDF, suitable for contracts, bills, and articles; please pay attention to memory for extremely long pages.

### 3. Print
```swift
let info = UIPrintInfo(dictionary: nil)
info.outputType = .general
let controller = UIPrintInteractionController.shared
controller.printInfo = info
controller.printFormatter = webView.viewPrintFormatter()
controller.present(animated: true)
```
> The `@media print` style can be injected before printing to hide navigation, advertisements, and buttons.

## 10. Monitoring system: from “openable” to “observable”
### 1. Monitoring layering
```
┌─ 业务层：打开率、停留、转化、白屏率
├─ Web 层：FCP/LCP、JS 错误、资源失败、路由、Bridge
├─ 原生层：导航耗时、HTTP 状态、TLS、进程终止、内存警告
├─ 进程层：WebContent 崩溃、Jetsam、CPU/内存（Instruments）
└─ 网络层：DNS/TLS/TTFB、CDN、服务端日志
```
> If you only do one of the layers, you will get the monitoring of "it looks like there is data, but the problem cannot be located".

### 2. Native side indicators

| indicator | collection method | value |
|---|---|---|
| Loading progress | KVO `estimatedProgress` | Progress bar, stuck detection |
| loading status | KVO `loading` | Determine whether | is still being requested
| Title/URL | KVO `title` / `url` | Page identification, routing statistics |
| Forward and backward | KVO `canGoBack` / `canGoForward` | Container status |
| Time consumption in each stage of navigation | Timestamp in delegate callback | Positioning DNS/TLS/first byte/slow rendering |
| HTTP status code | `decidePolicyFor navigationResponse` Get `response` | 4xx/5xx monitoring |
| Number of redirections | `didReceiveServerRedirect...` Count | Jump chain exception |
| Error code | `didFail` / `didFailProvisional` | Network and certificate issues |
| Content process terminated | `webViewWebContentProcessDidTerminate` | Core indicators of white screen/flashback |
| Certificate status | `serverTrust` / `hasOnlySecureContent` | Middleman, mixed content |
| Memory warning | `didReceiveMemoryWarning` | Container memory pressure |
| Bridge calls | Self-built count/time consumption/error code | End capability availability |
| crash/stuck | MetricKit + signal capture | App-level security |
| Critical Path | `os_signpost` | Alignment with Instruments |

Example of time-consuming navigation:
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

### 3. Web-side indicators (injected into JS SDK)

| Indicator | API | Description |
|---|---|---|
| Navigation time-consuming | `performance.getEntriesByType("navigation")` | DNS/TCP/TLS/TTFB/DOMReady/load |
| FCP | `PerformanceObserver("paint")` | First content rendering |
| LCP | `PerformanceObserver("largest-contentful-paint")` | Maximum content drawing, requires Safari support version |
| CLS | `PerformanceObserver("layout-shift")` | Some WebKit versions are not supported and need to be downgraded |
| Long Task/INP | Event Timing/rAF interval | Safari has limited support for Long Tasks API, and it needs to be fully implemented |
| Resource consumption | `PerformanceObserver("resource")` | Slow resources and failed resources |
| JS error | `window.onerror` | includes stack and row and column numbers |
| Promise exception | `unhandledrejection` | Asynchronous error |
| Resource loading failed | `window.addEventListener("error", handler, true)` | img/script cannot be obtained until the capture stage |
| CSP violation | `securitypolicyviolation` | Security policy manslaughter |
| FPS | `requestAnimationFrame` sampling | JS side estimation, cannot represent GPU |
| SPA routing | interception `pushState`/`replaceState` + `popstate` | single-page application page-level indicators |
| White screen probe | DOM content + heartbeat | See next section |

### 4. Four methods of white screen detection
1. **JS Heartbeat**: `postMessage` every 5 seconds after the page is loaded, the native timeout is not received → abnormal determination;
2. **DOM probe**: `document.body.innerText.trim().length` or the number of root node child elements;
3. **screenshot sampling**: `takeSnapshot` post-statistical pixel variance/blank ratio (high cost, sampling is used);
4. **Loading timeout**: N seconds have not passed since `didStartProvisional` `didCommit`/`didFinish` → Determination failed.

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
> The white screen judgment must be combined with "text length + number of nodes + first screen screenshot". Just looking at whether `body` is empty will misjudge Canvas/video pages.

### 5. Realistic limitations of network monitoring
- `NSURLProtocol` **cannot block** WKWebView: the request occurs in the Networking process;
- `WKNavigationDelegate` Only the main document can be seen, but the sub-resources cannot be seen;
- `WKURLSchemeHandler` can only handle custom schemes and cannot take over http/https;
- Possible solutions:
  1. JS side packaging `fetch` / `XMLHttpRequest`, records status code, time consumption, and failure reasons;
  2. `PerformanceObserver("resource")` takes time to get the resource level;
  3. Server logs are aligned with CDN logs;
Use local proxy (Charles/Proxyman) or `ios-webkit-debug-proxy` during debugging for   4. .

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

### 6. Monitor SDK injection and reporting
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
 reporting structure suggestions:
1. JS side buffers first and batches `postMessage` to avoid high-frequency cross-process calls;
2. native side disk (SQLite/file), try again according to network status;
3. Each log contains `sessionId`, `pageId`, `url`, `ts`, `appVersion`, `osVersion`;
4. sampling: 10% of high-performance pages, 100% of core pages;
5. Desensitization: Do not collect input box content, cookies, and Authorization;
6. JS stack is restored on the server side through sourcemap.

### 7. Alarm indicator examples

| Indicator | Recommended threshold | Description |
|---|---|---|
| White screen rate | < 0.5% | Statistics by container opening times |
| JS Error Rate | < 1% | Error Sessions / Total Sessions |
| Bridge failure rate | < 0.1% | Contains timeout and native exception |
| LCP P75 | < 2.5s | Bucket by page type |
| Content process termination rate | < 0.1% | View key models individually |
| first screen loading P95 | < 3s | including DNS/TLS |
| 4xx/5xx proportion | < 1% | main document |

### 8. Online debugging
- `isInspectable` **only opens** in Debug/Internal, Release must be closed;

```swift
#if DEBUG
webView.isInspectable = true   // iOS 16.4+
#endif
```
- Internal package can be injected into Eruda/vConsole, and use floating buttons to view console, network, and DOM;
- online problems are located by "log + snapshot + page URL + machine model/system version". Don't expect to debug with a real machine;
- Automated testing can use Appium / WebDriverAgent to switch WebView context.

### 9. Monitoring misunderstandings
1. ❌ View only `didFinish`: It only means that the main document has been loaded, and the first screen may still be white;
2. ❌ Only H5 business points are buried: container-level errors (process killed, TLS failed, Bridge blocked) cannot be collected at all;
3. ❌ Full collection: high frequency `postMessage` itself will slow down the page;
4. ❌ Collecting user input: privacy compliance risk and huge size;
5. ❌ Count WebContent crashes as App crashes: the two recovery strategies are completely different;
6. ❌ Ignore `-999`: Active cancellation pollutes the error rate.

## 11. In-depth: The internal mechanism of WKWebView
### 1. Three-process collaboration
- **UIProcess (App process)**: holds WKWebView, handles touch/keyboard, synthesizes layers, and executes navigation agents;
- **Networking process**: DNS, TLS, HTTP cache, Cookie attachment, multiple WebView sharing;
- **WebContent process**: HTML parsing, DOM/CSSOM, JS execution, layout, and drawing instructions.

WebContent does not directly hand over pixels to the screen: it generates a layer tree, synchronizes it to UIProcess through RemoteLayerTree, and the App process uses CoreAnimation to synthesize the screen. This explains two phenomena:
No DOM elements can be seen in - `webView.subviews`;
- When the native view is superimposed on the WebView, it will compete with the web content for the composition level.

### 2. Process switching (PSON)
During cross-site navigation, WebKit may switch the page to a new WebContent process (Process Swap On Navigation). Therefore:
- Do not assume that pages of the same WKWebView are always in the same process;
- Page-level global state may be lost with process switching;
- Cookie/cache is still managed uniformly by the Networking process and DataStore, and is not affected by process switching.

### 3. JavaScriptCore and JIT
- WKWebView's JS runs in the WebContent process and uses JIT;
- App process cannot directly get `JSContext`, which is the biggest architectural difference with UIWebView;
- All intermodulation must go through message serialization + IPC, which is naturally asynchronous;
- `WKContentWorld` Create multiple global objects in the same JS context to achieve logical isolation instead of process isolation.

### 4. Implementation details of custom Scheme
- `WKURLSchemeHandler` is called on the App side, and the data stream needs to be sent back to WebContent through IPC;
- must implement `webView(_:start:)` and `webView(_:stop:)`, and call `didReceive response` / `didReceive data` / `didFinish` correctly;
- cannot register `http`, `https`, and `file` (`WKWebView.handlesURLScheme("http")` can be used to determine whether a scheme has been taken over by WebKit);
- is suitable for offline packages, encrypted resource decryption, and local database export; it is not suitable for full network proxy (performance and capabilities are limited).

### 5. Memory and Jetsam
- The WebContent process has an independent memory upper limit. If it exceeds the limit, it will be killed by the system. The App will only receive `webViewWebContentProcessDidTerminate`;
- Pictures, Canvas, a large amount of DOM, and JS heap are mainly occupied;
- cannot directly read the WebContent memory from the App side, so you need to use Instruments to attach to the WebContent process for observation;
- recovery strategy: save URL + scroll position + Key form state, rebuild the WebView and prompt the user.

### 6. Background and life cycle
After - App enters the background, WebContent may be suspended and `setTimeout` / `setInterval` may be throttled;
- Businesses that rely on web timers (heartbeats, countdowns) are unreliable in the background, and key logic is placed natively;
- audio background playback requires `UIBackgroundModes: audio`;
- `stopLoading()` before destroying the WebView, and remove the handler to avoid the callback from hitting the released object.

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
- Restrict WebView to only navigate to whitelisted domain names, reducing the risk of phishing and script injection;
After - is turned on, navigation for unlisted domain names will fail (common manifestation: white screen);
- is not a panacea: it still needs to cooperate with CSP, Bridge whitelist, and parameter verification.

### 8. Content Blocker
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
- rules are executed in the WebContent process and can intercept resources, hide elements, and restrict cookies;
The number of - rules has an upper limit (about 150,000), and compilation is costly. It is recommended to compile and cache asynchronously after startup;
- Compared with JS injection, content blocker does not pollute the page global object and is more suitable for advertising/tracking blocking.

### 9. Boundaries of private APIs
- `WKPreferences`’s `_features`, `_setEnabled` and various `_` prefix extension interfaces are private APIs;
- private API will lead to review rejection, and system upgrades will fail at any time;
- When experimental web features are needed, give priority to downgrading through public configuration or server-side switches, and do not bet on private interfaces.

### 10. Version capability quick check

| Capabilities | Minimum version |
|---|---|
| WKWebView | iOS 8 |
| `WKURLSchemeHandler` / `takeSnapshot` / `createPDF` | iOS 11 |
| `WKWebpagePreferences` / Content Mode / Context Menu | iOS 13 |
| `WKContentWorld` / `callAsyncJavaScript` / `WKScriptMessageHandlerWithReply` / `pageZoom` / `find` | iOS 14 |
| Download (`WKDownload`) | iOS 14.5 |
| `interactionState` / `loadSimulatedRequest` / Media capture permissions / Location permissions / `underPageBackgroundColor` | iOS 15 |
| `isInspectable` | iOS 16.4 |

## 12. Performance optimization operation list
1. **Preheating**: Create WKWebView at startup to load `about:blank`, reuse the process and DataStore;
2. **reuses**: list/active page pooling WebView, first `stopLoading` and clear delegate callback status when reusing;
3. **cache**: Rely on HTTP cache header and DataStore, do not `reloadFromOrigin` every time;
4. **First screen**: SSR/pre-rendering, critical CSS inline, `preconnect`, image `srcset` + WebP/AVIF;
5. **scrolling**: virtual list, `passive` event, avoid forced synchronization layout, use less `backdrop-filter`;
6. **Bridge**: batching, frequency reduction, avoiding base64 large objects, timeout and retry;
7. **picture**: decoding according to display size, lazy loading of long lists, and timely release of invisible large pictures;
8. **restore**: The content processing process is terminated, the URL/scroll position is saved, and restored after reconstruction;
9. **transition**: use the current page snapshot to make push animation to avoid white screen flickering;
10. **Memory**: The non-visible WebView is destroyed in time, and the cache and pictures are cleared when the memory is low.

## 13. List of common pitfalls
1. **and then change the configuration after initialization**: What is changed is a copy and must be configured before init;
2. **`webView.configuration` is a copy of**: changing it to `userContentController` is invalid;
3. **handler circular reference**: `userContentController` strong reference handler;
4. **delegate is weak**: the callback will no longer be triggered after the WebView is destroyed, so don’t hang the logic on the delegate life cycle;
5. **Cookie does not share**: `WKHTTPCookieStore` ≠ `NSHTTPCookieStorage`;
6. **`NSURLProtocol` Invalid**: cross-process, cannot be blocked;
7. **Custom Header Only effective for the main document**: sub-resources will not be inherited;
8. **`target="_blank"` No response**: Must implement `createWebViewWith`;
9. **JS Pop-up window does not respond**: `WKUIDelegate` must be implemented;
10. **`loadFileURL` The rear interface is fully connected**: origin and CORS restrictions of `file://`;
11. **`-999` is treated as fault**: active cancellation will pollute the error rate;
12. **`didFailProvisional` and `didFail` are mixed with**: one before submission and one after submission;
13. **`isInspectable` brought to Release**: security risk, online package should not be opened;
14. **The content process is killed and does not recover**: The user sees a permanent white screen;
15. **App-Bound Domains Configure the missing domain name**: Navigation fails directly;
16. **The main thread waits synchronously for Bridge**: WebView and Bridge are both asynchronous models, and synchronous waiting will inevitably get stuck.

## 14. Cheat Sheet

| Requirements | API |
|---|---|
| Load web page | `load(URLRequest)` |
| Load local package | `loadFileURL(_:allowingReadAccessTo:)` |
| Load HTML string | `loadHTMLString(_:baseURL:)` |
| executes JS | `evaluateJavaScript` / `callAsyncJavaScript` |
| injection script | `WKUserScript` + `addUserScript` |
| JS tune native | `WKScriptMessageHandler` / `WithReply` |
| native tune JS | `evaluateJavaScript` / `callAsyncJavaScript` |
| Interception navigation | `decidePolicyFor navigationAction` |
| Interception response/download | `decidePolicyFor navigationResponse` |
| New window | `createWebViewWith` |
| File upload | `runOpenPanelWith` |
| Download | `WKDownloadDelegate` |
| Cookie | `WKHTTPCookieStore` |
| Clear cache | `WKWebsiteDataStore.removeData` |
| Traceless | `WKWebsiteDataStore.nonPersistent()` |
| Screenshot | `takeSnapshot` |
| Export PDF | `createPDF` |
| Print | `viewPrintFormatter` |
| Find | `find(_:configuration:completionHandler:)` |
| Zoom | `pageZoom` |
| Session recovery | `interactionState` |
| Offline bottom page | `loadSimulatedRequest` |
| Debug | `isInspectable` (Debug only) |
| Process terminated | `webViewWebContentProcessDidTerminate` |
