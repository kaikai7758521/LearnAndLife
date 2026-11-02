---
title: "IOS network programming complete overview"
lang: en
translatedFrom: e3a546bb9eb4b27af118e4654b8d037c2ae2091ce42129f4cd6b9db6530446b1
translatedAt: 2026-11-02
---

# IOS network programming complete overview
The essence of iOS network programming: In the iOS process, **completes data sending and receiving with the remote server through the network stack (BSD Socket → CFNetwork → Foundation high-level encapsulation) provided by the operating system, and follows the TCP/IP protocol stack**.
Layering from top to bottom:
`业务层（业务接口、解析）` → `Foundation 网络层（URLSession）` → `CFNetwork` → `BSD Socket` → `系统内核 TCP/IP 栈` → Network card

> is now mainstream in iOS development: **URLSession** (replacing the old NSURLConnection, abandoned after iOS9); only underlying custom protocols and long connections use CFNetwork / BSD Socket.

---

## 1. Basic technical principles
### 1. Protocol basis
- **HTTP/HTTPS**: Application layer protocol, based on TCP. HTTPS = HTTP + TLS encryption, now forcing ATS to require HTTPS by default.
- **TCP**: connection-oriented, reliable, orderly, flow control, congestion control; three-way handshake, four-way wave. Suitable for interface, file upload and download, and IM long connection.
- **UDP**: no connection, unreliable, no order guarantee; low overhead, suitable for live broadcast, real-time voice, and games.
- **WebSocket**: Based on HTTP handshake, later upgraded to full-duplex TCP long connection, suitable for push and real-time messages.

### 2. iOS network stack layering
1. **BSD Socket (C native)**
    The lowest level, standard POSIX socket: socket(), bind(), connect(), send(), recv().
    Features: Cross-platform, the highest degree of freedom; you need to handle packet sticking, sub-packaging, heartbeat, disconnection and reconnection by yourself; OC/Swift can call C API.
    Applicable to: Customized private binary protocol, high-performance long connection.
2. **CFNetwork (CoreFoundation, C interface)**
    Apple's encapsulation of BSD Socket, Runloop driver asynchronous, provides CFHTTPMessage, CFStream, CFSocket.
    Features: Supports streaming, TLS configuration, and proxy; is the underlying dependency of URLSession; can finely control TLS and certificate verification at the underlying level.
    Applicable to: streaming upload and download, custom TLS verification, long connection of old projects.
3. **Foundation High-level: URLSession (Swift/OC, preferred)**
    Object-oriented encapsulation, based on CFNetwork, Runloop asynchronous model, system independent process management network tasks.
    Three major task types:
    - `URLSessionDataTask`: short request, get complete memory data (common interface JSON)
    - `URLSessionDownloadTask`: Download, write data to disk, support background download and breakpoint resume download
    - `URLSessionUploadTask`: Upload, support file stream upload, background upload
    Extra: `URLStreamTask` (iOS15+, replaces CFStream, WebSocket/Streaming)
4. **Third-party packaging (Alamofire, Moya)**
    It is just the upper syntactic sugar of URLSession, does not change the underlying network capabilities, and simplifies parameters, encoding, interceptors, and retries.

### 3. Asynchronous model principle (key points)
URLSession is not directly called back in the current thread:
- Default `URLSession.shared`: Use the system global delegate queue, callback in **sub-thread**! UI updates must be switched back to the main thread `DispatchQueue.main`.
- Session is divided into two modes:
  1. **completionHandler closure mode**: simple, one-time callback data/error at the end of the request; unable to monitor upload and download progress.
  2. **delegate proxy mode**: powerful, can monitor progress, redirection, certificate challenge, streaming reception, background tasks; need to set `delegate` + `delegateQueue`.
> background task (background download/upload) is special: after the App is suspended by the system, the system continues to run as an independent process; after completion, the system wakes up the App and calls the agent callback.

### 4. ATS (App Transport Security) principle
iOS9+ turns on ATS by default: **prohibits plaintext HTTP** and requires server TLS to meet security standards (TLS1.2+, cipher suite compliance).
- can configure the whitelist in Info.plist: `NSAppTransportSecurity`
- production strongly recommends not shutting down `NSAllowsArbitraryLoads` globally and only allowing specific domain names.

### 5. Certificate verification (TLS two-way authentication)
HTTPS default logic: client verifies server certificate (one-way authentication);
Two-way authentication: the client also needs to carry The p12/pfx certificate is sent to the server for verification.
When URLSession encounters a certificate challenge, it will call back `URLSessionDelegate didReceive challenge`. Here you can:
- uses system default verification
- **Certificate pinning (SSL Pinning)**: The App has a built-in server public key/certificate and only trusts the fixed certificate to prevent hijacking by middlemen.
> ⚠️ Certificate fixation pitfall: certificates expire and rotate, and all apps will be disconnected without updating.

---

## 2. Common usage methods
### 1. URLSession basic GET request (closed version)
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
> All tasks are suspended by default when they are created, and must be resume() before a request is initiated.

### 2. POST JSON request
Key points: Set `httpMethod="POST"`, `Content-Type: application/json`, body encoding JSON data.
```swift
var req = URLRequest(url: URL(string: "https://xxx/api/login")!)
req.httpMethod = "POST"
req.setValue("application/json", forHTTPHeaderField: "Content-Type")
let param: [String:Any] = ["name":"test"]
req.httpBody = try! JSONSerialization.data(withJSONObject: param)
let task = URLSession.shared.dataTask(with: req) { ... }
task.resume()
```

### 3. Proxy mode: monitor upload/download progress
Implement `URLSessionDownloadDelegate` / `URLSessionDataDelegate`
Core callback:
- `urlSession(_:downloadTask:didFinishDownloadingTo:)`: The download is completed and the temporary file URL is given. You need to move it to the sandbox directory yourself.
- `urlSession(_:downloadTask:didWriteData:totalBytesWritten:totalBytesExpectedToWrite:)`: Progress callback

### 4. Background download
It is necessary to create a Session** with independent configuration of **. Shared cannot be used:
Features of ```swift
let config = URLSessionConfiguration.background(withIdentifier: "com.xxx.download")
let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
```
: When the App kills the process, the system continues to download; after the App is restarted, the same identifier can be used to retrieve unfinished tasks.

### 5. WebSocket
Two options:
1. iOS13+ native `URLSessionWebSocketTask` (recommended), based on URLSession
2. underlying CFStream / SocketRocket (old solution)
Native example core:
```swift
let task = URLSession.shared.webSocketTask(with: URL(string:"wss://xxx")!)
task.resume()
task.receive { [weak self] result in
    // 接收消息，循环调用 receive 持续监听
}
task.send(.string("hello")) { error in }
```

### 6. Bottom Socket (C BSD Socket)
Suitable for private TCP binary protocols:
Process: `socket()` → `setsockopt()` (set timeout, keep alive) → `connect()` → loop `send/recv`;
⚠️ recv is a streaming read. **TCP packet sticking problem must be handled by the protocol header (length field) sub-packet**.
> Swift requires import Darwin to call C Socket.

### 7. Common configuration URLSessionConfiguration
Three types:
- `.default`: Default, persistent cache, cookie
- `.ephemeral`: temporary session, no persistent cache, cookie, memory level, suitable for login state isolation
- `.background(withIdentifier:)`: background tasks

Common configuration items:
```swift
config.timeoutIntervalForRequest = 15 // 请求超时
config.timeoutIntervalForResource = 60 // 资源总超时
config.requestCachePolicy = .reloadIgnoringLocalCacheData // 缓存策略
config.httpAdditionalHeaders = ["token":"xxx"] // 全局请求头
config.allowsCellularAccess = true // 是否允许蜂窝
config.allowsExpensiveNetworkAccess = true // 允许热点
```

### 8. Caching mechanism
HTTP cache is controlled by `Cache-Control`, `ETag`, `Last-Modified`; URLSession has a built-in cache database.
Caching strategy:
- `.useProtocolCachePolicy`: follow HTTP header (default)
- `.reloadIgnoringLocalCacheData`: Do not use cache
- `.returnCacheDataElseLoad`: If there is a cache, use the cache first and do not request again.

---

## 3. Precautions
### 1. Threading problem (highest frequency)
✅ The URLSession callback defaults to the **sub-thread**, and it must not directly operate UIKit/SwiftUI;
❌ Do not change the interface directly in the callback;✅ Must `DispatchQueue.main.async` cut the main thread.

### 2. Distinguish between two parameters of timeout
- `timeoutIntervalForRequest`: **idle timeout**, timeout after not receiving new data packets for a period of time
- `timeoutIntervalForResource`: **The maximum total duration of the entire resource is**, download large files to prevent unlimited lags
Many people are confused and set the request timeout to be very short, and the download of large files will fail directly.

### 3. Memory and circular references
- In delegate mode, URLSession will forcibly hold the delegate, which is easy to reference circularly; remember `session.invalidateAndCancel()` / `finishTasksAndInvalidate()` after use
- The large file dataTask will read all the data into the memory. To download the large file **, you must use DownloadTask**, otherwise the memory will explode and crash.

### 4. Background task restrictions
- has a limited number of background downloads and low system scheduling priority;
- background callback recreates session in `handleEventsForBackgroundURLSession` of AppDelegate / SceneDelegate;
- Background tasks are not suitable for scenarios with high real-time requirements.

### 5. ATS and certificate pit
1. Try not to turn off ATS globally;
2. SSL Pinning: Certificate pinning must also handle certificate rotation, otherwise the certificate will expire and the Internet will be unable to connect after the release;
3. Self-signed certificate: The default verification fails and must be manually trusted in the challenge callback (test environment only, strictly prohibited in production);
4. Two-way authentication: p12 file password and certificate reading failures are common.

### 6. TCP sticky packet (must read for Socket development)
TCP is a stream of bytes with no message boundaries. How many times `send` and `recv` There is no correspondence between how many times it is read.
✅ Standard solution: protocol header + data length (such as 4-byte big-endian length, followed by payload), read enough length and then unpack.
UDP does not have sticky packets, and a recvfrom gets a complete message.

### 7. Network reachability monitoring
Apple recommends: `NWPathMonitor` (Network framework, iOS12+), abandon the old `Reachability` (old SCNetworkReachability)
Can monitor: WiFi/cellular, whether there is a network, whether there is an expensive network (hotspot).
⚠️ Reachability ≠ Able to connect to the server: The mobile phone is connected to WiFi, but the router is disconnected from the external network, but it still shows that there is a network. **can only be used as a prompt and cannot replace** in determining request failure.

### 8. Cookie Management
The default session shares system cookie storage; ephemeral does not persist cookies.
Cookies can be read and written manually through `HTTPCookieStorage`; many login states are based on cookies.

### 9. Proxy, redirection, challenge callback
`URLSession(_:task:willPerformHTTPRedirection:newRequest:completionHandler:)`
You can intercept 302/301 redirects and customize whether to follow the jump.

### 10. IPv6 compatible
Apple requires that Apps must support IPv6-only network environments; do not hard-code IPv4 addresses in the code, and give priority to domain names.

### 11. Proxy (system HTTP proxy, VPN)
URLSession **automatically inherits the system proxy configuration**, no additional code is required; the underlying Socket does not automatically use the system proxy by default, and requires CFNetwork or NWFramework to automatically adapt to the proxy. This is a big pitfall for underlying Socket development.

### 12. Error type distinction
`URLError`: URLSession error enumeration
Common:
- `.timedOut`: Timeout
- `.notConnectedToInternet`: No network
- `.cancelled`: Task actively cancels
- `.cannotConnectToHost`: Unable to connect to the host

> In terms of business, it is necessary to distinguish: network layer errors, server returns 4xx/5xx, data parsing errors, and give user-friendly prompts.

### 13. Concurrency, request current limit
URLSession has a default maximum number of concurrent requests, and you can set the maximum concurrent requests for a single domain name through `httpMaximumConnectionsPerHost`;
A large number of concurrent requests in a short period of time are easily throttled by the server, so the client needs to do request queuing and anti-shaking.

### 14. Privacy permissions
iOS 14+ does not require permissions on the network itself; but **NWPathMonitor needs network permissions in some scenarios to monitor network status**; in addition, if a local network (LAN communication) is used, `NSLocalNetworkUsageDescription` is required.

### 15. New writing method of Swift Concurrency (async/await) (iOS15+)
```swift
let (data, resp) = try await URLSession.shared.data(from: url)
```
async/await is syntax sugar for completion. The underlying layer is still URLSession. The code is concise and the model is automatically switched. Now it is used first in new projects.
- async version **does not have progress callback**; progress, certificate verification, and background download still require a delegate.

---

## 4. Technology selection summary table
| Scenario | Recommended Solution |
|---|---|
| Common HTTP/HTTPS interface | URLSession async/await / Alamofire |
| File download, breakpoint, background download | URLSessionDownloadTask (delegate) |
| File upload | URLSessionUploadTask |
| Real-time messaging, WebSocket | URLSessionWebSocketTask (iOS13+) |
| Custom private TCP binary protocol | CFStream / BSD Socket |
| UDP real-time streaming | NWFramework (NWConnection) |
| Network status monitoring | NWPathMonitor |

---
