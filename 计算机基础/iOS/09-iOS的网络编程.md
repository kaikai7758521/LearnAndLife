# iOS 网络编程完整梳理
iOS 网络编程本质：**在 iOS 进程内，通过操作系统提供的网络栈（BSD Socket → CFNetwork → Foundation 高层封装）完成和远端服务器的数据收发，遵循 TCP/IP 协议栈**。
分层从上到下：
`业务层（业务接口、解析）` → `Foundation 网络层（URLSession）` → `CFNetwork` → `BSD Socket` → `系统内核 TCP/IP 栈` → 网卡

> 现在 iOS 开发主流：**URLSession**（替代旧的 NSURLConnection，iOS9 之后废弃）；底层自定义协议、长连接才会用到 CFNetwork / BSD Socket。

---

## 一、基础技术原理
### 1. 协议基础
- **HTTP/HTTPS**：应用层协议，基于 TCP。HTTPS = HTTP + TLS 加密，现在强制 ATS 要求默认 HTTPS。
- **TCP**：面向连接、可靠、有序、流量控制、拥塞控制；三次握手、四次挥手。适合接口、文件上传下载、IM长连接。
- **UDP**：无连接、不可靠、无有序保证；开销小，适合直播、实时语音、游戏。
- **WebSocket**：基于 HTTP 握手，之后升级为全双工 TCP 长连接，适合推送、实时消息。

### 2. iOS 网络栈分层
1. **BSD Socket（C 原生）**
    最底层，标准 POSIX socket：socket()、bind()、connect()、send()、recv()。
    特点：跨平台，自由度最高；需要自己处理粘包、分包、心跳、断线重连；OC/Swift 都可以调用 C API。
    适用：自定义私有二进制协议、高性能长连接。
2. **CFNetwork（CoreFoundation，C 接口）**
    苹果对 BSD Socket 的封装，Runloop 驱动异步，提供 CFHTTPMessage、CFStream、CFSocket。
    特点：支持流、TLS 配置、代理；是 URLSession 的底层依赖；可以在底层精细控制 TLS、证书校验。
    适用：流式上传下载、自定义 TLS 校验、老项目长连接。
3. **Foundation 高层：URLSession（Swift/OC，首选）**
    面向对象封装，基于 CFNetwork，Runloop 异步模型，系统独立进程管理网络任务。
    三大任务类型：
    - `URLSessionDataTask`：短请求，拿到完整内存数据（普通接口 JSON）
    - `URLSessionDownloadTask`：下载，数据写到磁盘，支持后台下载、断点续传
    - `URLSessionUploadTask`：上传，支持文件流上传，后台上传
    额外：`URLStreamTask`（iOS15+，替代 CFStream，WebSocket/流式）
4. **第三方封装（Alamofire、Moya）**
    只是 URLSession 的上层语法糖，不改变底层网络能力，简化参数、编码、拦截器、重试。

### 3. 异步模型原理（重点）
URLSession 不是在当前线程直接回调：
- 默认 `URLSession.shared`：使用系统全局 delegate queue，回调在**子线程**！UI 更新必须切回主线程 `DispatchQueue.main`。
- Session 分为两种模式：
  1. **completionHandler 闭包模式**：简单，请求结束一次性回调数据/错误；无法监听上传下载进度。
  2. **delegate 代理模式**：强大，可监听进度、重定向、证书挑战、流式接收、后台任务；需要设置 `delegate` + `delegateQueue`。
> 后台任务（后台下载/上传）特殊：App 被系统挂起后，由系统独立进程继续跑；完成后系统唤醒 App，调用代理回调。

### 4. ATS（App Transport Security）原理
iOS9+ 默认开启 ATS：**禁止明文 HTTP**，要求服务器 TLS 满足安全标准（TLS1.2+，加密套件合规）。
- 可以在 Info.plist 配置白名单：`NSAppTransportSecurity`
- 生产强烈不建议全局关闭 `NSAllowsArbitraryLoads`，只给特定域名放行。

### 5. 证书校验（TLS 双向认证）
HTTPS 默认逻辑：客户端校验服务器证书（单向认证）；
双向认证：客户端还要携带 p12/pfx 证书发给服务器校验。
URLSession 遇到证书挑战时，会回调 `URLSessionDelegate didReceive challenge`，在这里可以：
- 使用系统默认校验
- **证书固定（SSL Pinning）**：App 内置服务器公钥/证书，只信任固定证书，防止中间人劫持。
> ⚠️ 证书固定坑：证书到期轮换，App 不更新就全部断网。

---

## 二、常见使用方法
### 1. URLSession 基础 GET 请求（闭包版）
```swift
let url = URL(string: "https://xxx/api/list")!
let task = URLSession.shared.dataTask(with: url) { data, resp, err in
    if let err = err {
        print("错误：\(err)")
        return
    }
    guard let data = data, let httpResp = resp as? HTTPURLResponse, httpResp.statusCode == 200 else { return }
    // 解析 JSON，这里在子线程
    DispatchQueue.main.async {
        // 更新 UI
    }
}
task.resume()
```
> 所有 task 创建出来默认是 suspended，必须 resume() 才会发起请求。

### 2. POST JSON 请求
要点：设置 `httpMethod="POST"`，`Content-Type: application/json`，body 编码 JSON data。
```swift
var req = URLRequest(url: URL(string: "https://xxx/api/login")!)
req.httpMethod = "POST"
req.setValue("application/json", forHTTPHeaderField: "Content-Type")
let param: [String:Any] = ["name":"test"]
req.httpBody = try! JSONSerialization.data(withJSONObject: param)
let task = URLSession.shared.dataTask(with: req) { ... }
task.resume()
```

### 3. 代理模式：监听上传/下载进度
实现 `URLSessionDownloadDelegate` / `URLSessionDataDelegate`
核心回调：
- `urlSession(_:downloadTask:didFinishDownloadingTo:)`：下载完成，给到临时文件URL，需要自己移动到沙盒目录
- `urlSession(_:downloadTask:didWriteData:totalBytesWritten:totalBytesExpectedToWrite:)`：进度回调

### 4. 后台下载
需要创建**独立配置的 Session**，不能用 shared：
```swift
let config = URLSessionConfiguration.background(withIdentifier: "com.xxx.download")
let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
```
特点：App 杀进程，系统依然继续下载；App 重启后，用同一个 identifier 可以找回未完成任务。

### 5. WebSocket
两种方案：
1. iOS13+ 原生 `URLSessionWebSocketTask`（推荐），基于 URLSession
2. 底层 CFStream / SocketRocket（老方案）
原生示例核心：
```swift
let task = URLSession.shared.webSocketTask(with: URL(string:"wss://xxx")!)
task.resume()
task.receive { [weak self] result in
    // 接收消息，循环调用 receive 持续监听
}
task.send(.string("hello")) { error in }
```

### 6. 底层 Socket（C BSD Socket）
适合私有 TCP 二进制协议：
流程：`socket()` → `setsockopt()`（设置超时、保活） → `connect()` → 循环 `send/recv`；
⚠️ recv 是流式读取，**TCP 粘包问题必须自己处理协议头（长度域）分包**。
> Swift 调用 C Socket 需要 import Darwin。

### 7. 常用配置 URLSessionConfiguration
三种类型：
- `.default`：默认，持久化缓存、Cookie
- `.ephemeral`：临时会话，不持久化缓存、cookie，内存级，适合登录态隔离
- `.background(withIdentifier:)`：后台任务

常用配置项：
```swift
config.timeoutIntervalForRequest = 15 // 请求超时
config.timeoutIntervalForResource = 60 // 资源总超时
config.requestCachePolicy = .reloadIgnoringLocalCacheData // 缓存策略
config.httpAdditionalHeaders = ["token":"xxx"] // 全局请求头
config.allowsCellularAccess = true // 是否允许蜂窝
config.allowsExpensiveNetworkAccess = true // 允许热点
```

### 8. 缓存机制
HTTP 缓存由 `Cache-Control`、`ETag`、`Last-Modified` 控制；URLSession 内置缓存数据库。
缓存策略：
- `.useProtocolCachePolicy`：遵循 HTTP header（默认）
- `.reloadIgnoringLocalCacheData`：不走缓存
- `.returnCacheDataElseLoad`：有缓存先用缓存，没有再请求

---

## 三、注意事项 
### 1. 线程问题（最高频）
✅ URLSession 回调默认在**子线程**，绝对不能直接操作 UIKit/SwiftUI；
❌ 不要在回调里直接改界面；✅ 必须 `DispatchQueue.main.async` 切主线程。

### 2. 超时两个参数区分
- `timeoutIntervalForRequest`：**空闲超时**，一段时间没有收到新数据包就超时
- `timeoutIntervalForResource`：**整个资源最大总时长**，下载大文件防止无限卡死
很多人搞混，设置 request 超时很短，大文件下载直接失败。

### 3. 内存与循环引用
- delegate 模式下，URLSession 会强持有 delegate，容易循环引用；用完记得 `session.invalidateAndCancel()` / `finishTasksAndInvalidate()`
- 大文件 dataTask 会把全部数据读进内存，大文件下载**必须用 DownloadTask**，否则内存暴涨 Crash。

### 4. 后台任务限制
- 后台下载有数量限制、系统调度优先级低；
- 后台回调在 AppDelegate / SceneDelegate 的 `handleEventsForBackgroundURLSession` 里重建 session；
- 后台任务不适合实时性要求高的场景。

### 5. ATS 和证书坑
1. 尽量不要全局关闭 ATS；
2. SSL Pinning：证书固定要同时处理证书轮换兜底，否则发版后证书过期全部无法联网；
3. 自签名证书：默认校验失败，必须在 challenge 回调手动信任（仅测试环境，生产严禁）；
4. 双向认证：p12 文件密码、证书读取失败很常见。

### 6. TCP 粘包（Socket 开发必看）
TCP 是字节流，没有消息边界。`send` 多少次和 `recv` 读到多少次没有对应关系。
✅ 标准方案：协议头 + 数据长度（比如 4字节大端长度，后面跟 payload），读到足够长度再解包。
UDP 不存在粘包，一个 recvfrom 拿到一个完整报文。

### 7. 网络可达性监听
苹果推荐：`NWPathMonitor`（Network framework，iOS12+），废弃老的 `Reachability`（老 SCNetworkReachability）
可以监听：WiFi/蜂窝、是否有网、是否昂贵网络（热点）。
⚠️ 可达性 ≠ 能连通服务器：手机连上 WiFi，但路由器断外网，依然显示有网络。**只能做提示，不能代替请求失败判断**。

### 8. Cookie 管理
默认 session 共享系统 Cookie 存储；ephemeral 不会持久化 Cookie。
可以手动通过 `HTTPCookieStorage` 读写 Cookie；登录态很多基于 Cookie。

### 9. 代理、重定向、挑战回调
`URLSession(_:task:willPerformHTTPRedirection:newRequest:completionHandler:)`
可以拦截 302/301 重定向，自定义是否跟随跳转。

### 10. IPv6 兼容
苹果要求 App 必须支持 IPv6-only 网络环境；不要硬编码 IPv4 地址写死在代码里，优先域名。

### 11. 代理（系统 HTTP 代理、VPN）
URLSession **自动继承系统代理配置**，不需要额外代码；底层 Socket 默认不自动走系统代理，需要用 CFNetwork 或者 NWFramework 才会自动适配代理。这是底层 Socket 开发一个大坑。

### 12. 错误类型区分
`URLError`：URLSession 错误枚举
常见：
- `.timedOut`：超时
- `.notConnectedToInternet`：无网络
- `.cancelled`：任务主动 cancel
- `.cannotConnectToHost`：连不上主机

> 业务上要区分：网络层错误、服务器返回 4xx/5xx、数据解析错误，给到用户友好提示。

### 13. 并发、请求限流
URLSession 有默认最大并发数，可以通过 `httpMaximumConnectionsPerHost` 设置单域名最大并发请求；
短时间大量并发请求容易被服务器限流，客户端要做请求队列、防抖。

### 14. 隐私权限
iOS 14+ 网络本身不需要权限；但 **NWPathMonitor 监听网络状态在某些场景需要网络权限说明**；另外如果用本地网络（局域网通信），需要 `NSLocalNetworkUsageDescription`。

### 15. Swift Concurrency（async/await）新写法（iOS15+）
```swift
let (data, resp) = try await URLSession.shared.data(from: url)
```
async/await 是对 completion 的语法糖，底层还是 URLSession，代码简洁，自动切换模型，现在新项目优先用。
- async 版本**没有进度回调**；进度、证书校验、后台下载依然需要 delegate。

---

## 四、技术选型总结表
| 场景 | 推荐方案 |
|---|---|
| 普通 HTTP/HTTPS 接口 | URLSession async/await / Alamofire |
| 文件下载、断点、后台下载 | URLSessionDownloadTask（delegate） |
| 文件上传 | URLSessionUploadTask |
| 实时消息、WebSocket | URLSessionWebSocketTask (iOS13+) |
| 自定义私有 TCP 二进制协议 | CFStream / BSD Socket |
| UDP 实时流 | NWFramework（NWConnection） |
| 网络状态监听 | NWPathMonitor |

---

