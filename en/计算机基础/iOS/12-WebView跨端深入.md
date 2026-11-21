---
title: "WebView cross-terminal in-depth: WKWebView, JSBridge and hybrid containers"
lang: en
translatedFrom: a7134840f4b979c9f5bad20df880199a0584703c0791b3766b289559165ff82f
translatedAt: 2026-11-21
---

# WebView cross-terminal in-depth: WKWebView, JSBridge and hybrid containers
> In a word: **The cross-terminal WebView on iOS essentially treats the browser kernel as a runtime: the page is responsible for the UI, WKWebView is responsible for rendering, and JSBridge is responsible for connecting the "webpage" to the "native capabilities".**
> is suitable for students who are working on Hybrid containers, operation pages, small program hosts, and Flutter/RN embedded H5.

## 1. Technical base of iOS WebView
### 1. UIWebView → WKWebView
| Dimensions | UIWebView (deprecated) | WKWebView (iOS 8+) |
|---|---|---|
| process model | Same process as App | Independent WebContent process + Networking process |
| JS engine | Nitro (JIT) | Nitro (JIT), but **cross-process** |
| JS Context | can be directly intermodulated through `JSContext` | cannot directly take `JSContext`, only message communication |
| crash impact | JS OOM directly crashes App | content process is killed, App can capture and restore |
| Performance | Poor scrolling and memory | Significantly improved scrolling and rendering |
| Status | Obsolete for iOS 12, no longer accepted from 2020 | Current only option |

> Key understanding: WKWebView **is not as simple as a control in the App**. There are three processes behind it: App process, Networking process, and WebContent process. Cross-process brings stability, but also brings about three classic problems: "cannot intercept the network directly", "cookies are not shared" and "memory is not under your control".

### 2. Four direct consequences of the process model
1. **`NSURLProtocol` Unable to block WKWebView request**: The request occurs in the Networking process, and the custom protocol stack is invalid;
2. **Cookie does not automatically share**: `WKHTTPCookieStore` and `NSHTTPCookieStorage` are two sets of storage;
3. **content process may be recycled by the system**: The page must be able to be reconstructed when `webViewWebContentProcessDidTerminate` is received;
4. **JS cannot be synchronously intermodulated with native**: All Bridge calls are naturally asynchronous, and synchronous waiting can only rely on blocking hacks, which cannot be used in production.

## 2. What happens when a page is loaded?
```
loadRequest
  → Networking 进程：DNS / TLS / HTTP 缓存 / Cookie 附加
  → WebContent 进程：HTML 解析 → DOM + CSSOM → Render Tree
  → Layout → Paint → Composite
  → GPU 合成上屏
```
- **HTML parsing is streaming**: DOMContentLoaded only means that the DOM is ready, pictures, fonts, and async scripts may still be incomplete;
- **JS executes** in the WebContent process, which is isolated from the App main thread, but **will block the rendering and event** in the same process;
- `WKNavigationDelegate` and `didFinish` only mean that the main document is loaded, but it does not mean that the first screen is visible;
- WKWebView comes with gestures and scrolling, and the properties of `scrollView` are adjustable, but scrolling occurs in the WebContent process, and the native side cannot get frame-by-frame callbacks.

### The correct indicator for observing the first screen
| indicator | meaning | collection method |
|---|---|---|
| White screen duration | From opening the container to the first frame with content | Native RBI + `didFinish` + JS `first-paint` |
| FCP | First content rendering | PerformanceObserver |
| LCP | Maximum content rendering | PerformanceObserver |
| INP | Interaction to next drawing | PerformanceObserver |
| Bridge success rate/time consumption | Native call reliability | Self-built buried points |

## 3. Fourth generation implementation of JSBridge
### 1. URL Scheme interception (the most original)
```js
// JS 侧：改 location 或插入 iframe
location.href = "myapp://camera?cb=1";
```
 natively intercepts custom schemes in `decidePolicyFor navigationAction`.
Problem: It will interrupt the current page navigation, the parameter length is limited, and continuous calls will lose messages. Now it's just for cover.

### 2. `prompt` interception (synchronous hack)
JS calls `prompt("bridge://...")`, and the parameters are originally obtained in `runJavaScriptTextInputPanel` of `WKUIDelegate` and the result is returned synchronously.
The advantage is that **synchronizes**, but the disadvantage is that the implementation is ugly, blocking the UI, and has been abandoned by most teams.

### 3. `WKScriptMessageHandler` (mainstream)
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
 key points:
- `postMessage` The parameters must be of **JSON serializable** type; functions, Date, and undefined will be lost or errors will be reported;
The - callback must maintain the `callbackId → Promise` mapping and handle timeouts, repeated callbacks, and hanging callbacks after page jumps;
When calling `evaluateJavaScript` in - native callback, pay attention to string escaping, and use `callAsyncJavaScript` first.

### 4. `WKScriptMessageHandlerWithReply` (iOS 14+)
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
 Advantages: **request-response natural pairing**, no need to maintain callbackId yourself; Disadvantages: iOS 14+, and still asynchronous.

### 5. Minimum requirements for designing a reliable Bridge
1. **protocol version handshake**: `bridge.ready` first after the page is loaded, and the version and capability list is returned natively;
2. **message envelope**: `{id, method, params, version}`, schema verification is done on the native side;
3. **queue**: Calls when the Bridge is not ready are queued first, and flush after ready;
4. **Timeout and retry**: Native no response must be rejected to avoid permanent pending page;
5. **Batch merge**: High-frequency small messages (scrolling position, buried points) are merged and sent, one by one `postMessage`;
6. **Thread constraints**: `WKScriptMessageHandler` callback is in the main thread, time-consuming operations must be switched away, and the result is switched back to the main thread `evaluateJavaScript`.

## 4. Script injection and isolation
### 1. Injection timing
```swift
let source = "window.__APP_ENV__ = { platform: 'ios' };"
let script = WKUserScript(source: source,
                          injectionTime: .atDocumentStart,
                          forMainFrameOnly: true)
config.userContentController.addUserScript(script)
```
- `.atDocumentStart`: Executed before DOM construction, suitable for injecting Bridge and environment variables;
- `.atDocumentEnd`: Executed after the DOM is ready, suitable for operation pages;
- `forMainFrameOnly: true` avoids injection into iframe to reduce contamination and security risks.

### 2. `WKContentWorld` (iOS 14+)
The page JS and the injection script share the same global object by default, which is prone to naming conflicts and may also be tampered with by the page script. Bridge. `WKContentWorld` provides a world of isolation:
The variable page in the ```swift
let world = WKContentWorld.world(name: "app_bridge")
webView.evaluateJavaScript(js, in: nil, in: world)
```
 isolated world cannot be seen, so it is suitable for internal Bridge implementation; the price is that the parameters must be passed explicitly when sharing data across worlds.

### 3. Two ways to execute JS
| Method | Version | Features |
|---|---|---|
| `evaluateJavaScript(_:)` | iOS 8 | String splicing, you need to escape it yourself, the return value type is limited |
| `callAsyncJavaScript(_:arguments:in:in:completionHandler:)` | iOS 14 | Parameters are passed in JSON, automatically escaped, and support async/await |

```swift
webView.callAsyncJavaScript(
    "return window.__bridge.resolve(callbackId, payload);",
    arguments: ["callbackId": id, "payload": result],
    in: nil,
    in: .page
) { result in /* 处理错误 */ }
```
> Don’t use string concatenation to stuff user input into JS. This is the most typical entry point for JS injection.

## 5. Cookie, storage and login status
### 1. Two sets of cookie storage
- `NSHTTPCookieStorage`: for `URLSession`;
- `WKHTTPCookieStore`: for WKWebView;
- and **will not automatically synchronize**. After native login, the token must be written to `WKHTTPCookieStore`:
```swift
HTTPCookieStorage.shared.cookies?.forEach { cookie in
    webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
}
```
 reverse synchronization (web login → native) needs to read `getAllCookies` after `didFinish`.

### 2. Storage isolation and ITP
- `WKWebsiteDataStore.default()` is persistent; `.nonPersistent()` is in memory state (traceless) and will be cleared upon exit;
- Multiple WKWebViews under the same `WKWebsiteDataStore` share Cookie / localStorage / IndexedDB;
- Safari's **ITP (intelligent anti-tracking)** also affects WKWebView: sites without user interaction, script-writable storage has a 7-day upper limit; third-party cookies are restricted by default;
- Therefore, "whether the web page login state can be maintained for a long time" cannot only rely on cookies. Important credentials should be handed over to the native Keychain for management through Bridge.

### 3. Login and OAuth
- Third-party login and payment authorization should use **`ASWebAuthenticationSession`** instead of opening the login page in WKWebView within the app: the latter can neither get system-level password auto-filling nor be easily judged as phishing;
- After logging in, use a custom scheme or Universal Link to call back the App, and then inject the credentials into the page through Bridge;
- Do not explicitly transfer long-term tokens in Bridge, at least do a one-time short-term note exchange.

## 6. Offline and local resources
### 1. `WKURLSchemeHandler` (iOS 11+)
```swift
config.setURLSchemeHandler(LocalHandler(), forURLScheme: "app")
webView.load(URLRequest(url: URL(string: "app://local/index.html")!))
```
- Only **custom scheme** can be registered. Registering `http` / `https` / `file` will directly throw an exception;
- is suitable for mapping H5 offline packages to local resources, eliminating the need for local servers;
- Pay attention to the returned `MIME type`, `Content-Length`, and Range requests, otherwise the video and fonts may fail to load.

### 2. Local file loading
```swift
webView.loadFileURL(indexURL, allowingReadAccessTo: bundleDirectory)
```
 Pit:
Under - `file://`, `fetch`, XHR, Service Worker, and some storage APIs are restricted;
The relative path of - must fall within the `allowingReadAccessTo` directory;
When - needs complete Web capabilities, a more stable approach is to simulate the http source** with **scheme handler, or start a local HTTP service (only listen to 127.0.0.1).

### 3. Service Worker and Caching
- WKWebView has limited support for Service Worker, and is not available under `file://` and custom schemes;
- is an offline-first package. It is recommended to use "local resources + versioned incremental updates" and do not rely too much on SW;
The - HTTP caching strategy is determined by `URLRequest.cachePolicy` and the response header. Offline package updates must handle the version consistency of "old HTML citing old JS".

## 7. Performance optimization
### 1. Start
1. **preheating process**: Create WKWebView in advance to load `about:blank`, reuse `WKProcessPool` / `WKWebsiteDataStore`, and reduce the first white screen;
2. **reuse instance**: list page and activity page share pooled WKWebView to avoid frequent creation and destruction;
3. **First screen resource inline**: key CSS inline, JS delay, image pre-connection;
4. **SSR / Pre-rendered**: The first screen is displayed directly from the server, without waiting for the JS framework to be mounted.

### 2. Scrolling and Rendering
- avoids rearrangement (reading and writing `offsetTop`, changing styles) in the `scroll` event, use `passive: true`;
- Use virtual scrolling for long lists instead of rendering thousands of DOMs at once;
- animation takes priority over `transform` / `opacity` to avoid triggering layout and redrawing;
- Use `position: fixed` and `100vh` with caution: iOS dynamic toolbar will cause jumping, use `dvh` / `svh` instead;
- shadow, rounded corners, `filter`, `backdrop-filter` are all high overhead items in WebView.

### 3. Bridge performance
- single message serialization + cross-process transmission cost is not low, **high-frequency scenarios must merge/downgrade**;
- For large objects (image base64, long list), do not use Bridge, instead pass URL or paging;
- avoids the round-trip storm of "JS is adjusted to native → native is adjusted to JS → JS is adjusted to native again".

### 4. Memory and process recycling
- pictures are large in memory: limit the decoding size, release them in time, and avoid base64 large pictures;
- monitors `webViewWebContentProcessDidTerminate`, records URL and scroll position, and automatically rebuilds;
- Multiple WKWebViews surviving at the same time will enlarge the memory, and non-visible pages should be destroyed or reused.

## 8. Native capability access
| Capability | Can be used directly | Description |
|---|---|---|
| Camera/Album | ⚠️ Some | `<input type="file" accept="image/*">` are available; `getUserMedia` requires iOS 14.3+ and permission authorization |
| positioning | ⚠️ | requires `NSLocationWhenInUseUsageDescription`, and implements `WKUIDelegate` positioning authorization callback |
| file download/upload | ⚠️ | uploads to `runOpenPanelWith`; downloads need to be taken over by yourself to respond |
| pop-up window alert/confirm/prompt | ✅ | must implement `WKUIDelegate`, otherwise there will be no response by default |
| payment | ❌ | uses Bridge to adjust the native SDK; web payment cashier solution |
| Push | ❌ WKWebView in | App **does not support Web Push**; iOS 16.4's Web Push is only available for "Add to Home Screen" Web App |
| Bluetooth / NFC | ❌ | Web Bluetooth is not available in WKWebView, must Bridge |
| Clipboard / Share | ⚠️ | Restricted by user gestures and permissions, complex scenes can be used Bridge |
| Media automatic playback | ⚠️ | is limited by default and can be configured `allowsInlineMediaPlayback`, `mediaTypesRequiringUserActionForPlayback` |

## 9. Hybrid container and applet architecture
### 1. Cordova/Capacitor
```
Web 页面 → 统一 Bridge → 插件（Plugin）→ 原生 API
```
- Cordova: `config.xml` + plug-in registration, with heavy historical baggage, but mature ecology;
- Capacitor: more modern, the native project is a "first-class citizen", the plug-in is written in Swift/Kotlin, and the web side is called through `Capacitor.Plugins`;
- Both are essentially "standardizing Bridge + plug-in", and are suitable for quickly packaging ready-made H5 into apps.

### 2. Dual-thread model of small program
```
逻辑层（JSCore / 独立线程）── setData（JSON diff）──> 视图层（WKWebView）
        │                                              │
     业务 JS、API 调用                              渲染 DOM、手势
```
- Logic and rendering are separated, long JS tasks will not directly block the rendering thread;
The cost of - is the **serialization and cross-thread communication cost of `setData`,**. Once a large object is transmitted, frames will be dropped;
- View layer is not a full browser: no DOM API, restricted CSS selectors, components provided by the platform;
- This is why mini programs "look like the Web, but don't run like the Web."

### 3. Embed WebView in Flutter / RN
- Flutter uses `webview_flutter` / `flutter_inappwebview`, and the iOS side uses PlatformView to stack WKWebView on the Flutter canvas;
- RN uses `react-native-webview`, which is also a native View bridge;
- Note: PlatformView has composition overhead, and rounded corner cropping, transparency, and scrolling nesting are prone to problems. If the page can be a full-screen independent page, do not embed it in a complex scrolling container.

## 10. Safety Checklist
1. **Bridge method whitelist**: only expose necessary methods and prohibit "general invoke";
2. **source verification**: Verify the scheme/host of `message.frameInfo.request.url` and reject non-whitelist page calls;
3. **parameter verification**: Verify type, length, and enumeration according to schema to prevent injection and unauthorized access;
4. **prohibits `evaluateJavaScript` from splicing untrusted string**, giving priority to `callAsyncJavaScript` parameter transmission;
5. **CSP**: Limit `script-src` and `connect-src` to reduce the risk of elevating rights to native after XSS;
6. **App-Bound Domains**: `limitsNavigationsToAppBoundDomains = true` + `WKAppBoundDomains`, restrict navigation to own domain names;
7. **Transmission security**: ATS full HTTPS, certificate Pinning when necessary;
8. **Login page isolation**: Use `ASWebAuthenticationSession` for third-party OAuth. Do not enter the password in the WebView that can be read by JS;
9. **Local package verification**: Signature/hash verification is performed on offline packages to prevent them from being replaced and injected with malicious scripts;
10. **Debug switch**: `isInspectable` is only turned on in Debug and turned off in Release.

## 11. Debugging and online monitoring
- **Safari Developer Menu**: Simulator/Real Device → Development → Selection Page; iOS 16.4+ requires `webView.isInspectable = true`;
- **JS Error**: Inject `window.onerror` / `unhandledrejection`, reported through Bridge;
- **Resources and Performance**: `PerformanceObserver` collects FCP/LCP/INP and slow resources;
- **Bridge monitors**: call volume, success rate, P95 time consumption, timeout rate, native error code;
- **white screen monitoring**: container open → `didFinish` → first frame JS dotting, three segments are timed separately;
- **process crashes**: `webViewWebContentProcessDidTerminate` reports and counts the trigger page.

## 12. Applicable Boundary
✅Suitable for:
- operation activities, landing page, content details, help center;
- form, approval, configuration backend;
- Pages that require dynamic delivery and quick trial and error;
- Mini Program/Super App Container.

⚠️ Cautious or unsuitable for:
- Complex gestures, real-time animation, games;
- ultra-long list and high-frequency scrolling;
- camera real-time processing, audio and video editing;
- is a core link with strong offline and heavy interaction;
- First screen that is extremely sensitive to startup time.

> Judgment Criteria: The **page is mainly based on "display + form" → WebView; it is mainly based on "interaction + animation" → native or Flutter.**

## 13. Common misunderstandings
1. ❌ WKWebView is "faster UIWebView": it is a completely different multi-process architecture, and debugging, cookie, and network interception behaviors have all changed;
2. ❌ Cookies will be automatically shared: `NSHTTPCookieStorage` and `WKHTTPCookieStore` are two sets;
3. ❌ Use `NSURLProtocol` to do network interception for WKWebView: cross-process, cannot be blocked;
4. ❌ The more Bridge calls, the more real-time it is: each time it is a cross-process asynchronous message, high-frequency calls will inevitably drop frames;
5. ❌ `loadFileURL` has no pitfalls in loading local packages: fetch, storage, and SW are all limited under `file://`;
6. ❌ The more native capabilities that can be called in the web page, the better: every additional method means an additional attack surface;
7. ❌ The mini program is H5: dual threads, component systems, and capability APIs are all different, and ordinary web pages cannot be directly reused.
