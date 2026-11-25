---
title: "IOS network programming complete overview"
lang: en
translatedFrom: f20b778286dab7be52bb66ffcb42accb8fbe2463f8d7341c90891647bb066ec7
translatedAt: 2026-11-25
---

# IOS network programming complete overview
The essence of iOS network programming: In the iOS process, **completes data sending and receiving with the remote server through the network stack (BSD Socket → CFNetwork → Foundation high-level encapsulation) provided by the operating system, and follows the TCP/IP protocol stack**.
Layering from top to bottom:
`业务层（业务接口、解析）` → `Foundation 网络层（URLSession）` → `CFNetwork` → `BSD Socket` → `系统内核 TCP/IP 栈` → Network card

> is now mainstream in iOS development: **URLSession** (replacing the old NSURLConnection, abandoned after iOS9); only underlying custom protocols and long connections use CFNetwork / BSD Socket.

---

## 1. Basic technical principles
### 1. Protocol basis
- **HTTP/HTTPS**: Application layer protocol, based on TCP. HTTPS = HTTP + TLS encryption, now forcing ATS to require HTTPS by default. URLSession will automatically negotiate HTTP/2 through ALPN; when the server supports it, newer systems will also negotiate HTTP/3 (QUIC), and the business code does not need to be changed.
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
    Object-oriented encapsulation, based on CFNetwork, asynchronous callback model, system independent process management network tasks.
    Three major task types:
    - `URLSessionDataTask`: short request, get complete memory data (common interface JSON)
    - `URLSessionDownloadTask`: Download, write data to disk, support background download and breakpoint resume download
    - `URLSessionUploadTask`: Upload, support file stream upload, background upload
    Extra: `URLSessionStreamTask` (iOS 9+) wraps TCP connections into read and write streams, suitable for custom binary protocols; `URLSessionWebSocketTask` (iOS 13+) is responsible for WebSocket full-duplex communication.
4. **Third-party packaging (Alamofire, Moya)**
    It is just the upper syntactic sugar of URLSession, does not change the underlying network capabilities, and simplifies parameters, encoding, interceptors, and retries.

### 3. Asynchronous model principle (key points)
URLSession is not directly called back in the current thread:
- defaults to `URLSession.shared`: completion handler calls back `delegateQueue` (serial queue created by the system) in session, **does not guarantee the main thread**! UI updates must be switched back to the main thread `DispatchQueue.main`.
- Session is divided into two modes:
  1. **completionHandler closure mode**: simple, one-time callback data/error at the end of the request; unable to monitor upload and download progress.
  2. **delegate proxy mode**: powerful, can monitor progress, redirection, certificate challenge, streaming reception, background tasks; need to set `delegate` + `delegateQueue`.
> background task (background download/upload) is special: after the App is suspended by the system, the system continues to run as an independent process; after completion, the system wakes up the App and calls the agent callback.

### 4. ATS (App Transport Security) principle
iOS9+ turns on ATS by default: **prohibits plaintext HTTP** and requires server TLS Meets security standards (TLS1.2+, forward secrecy, compliant cipher suites).
- can configure the exception in Info.plist: `NSAppTransportSecurity`
- production strongly does not recommend shutting down `NSAllowsArbitraryLoads` globally; only configure `NSExceptionDomains` for domain names that cannot be upgraded;
- is available for local development/LAN debugging `NSAllowsLocalNetworking`, do not bring it to production;
- ATS only constrains **URL Loading System (HTTP stack of URLSession/CFNetwork)**; directly using BSD Socket to send original TCP is not subject to ATS inspection, but this does not mean that audit and security requirements can be bypassed.

### 5. Certificate verification and SSL Pinning
HTTPS default logic: client verifies server certificate (one-way authentication);
Two-way authentication: The client also needs to carry the p12/pfx certificate and send it to the server for verification (`NSURLAuthenticationMethodClientCertificate`).

When URLSession encounters a certificate challenge, it will call back `didReceive challenge` of `URLSessionDelegate`:
- does not implement this callback, or use `.performDefaultHandling`: perform system verification;
- implements **certificate pinning (SSL Pinning)**: only trusts the built-in certificate or public key to prevent hijacking by middlemen.

```swift
import CryptoKit

enum PinnedCertificates {
    static let hashes: Set<Data> = [
        // 内置证书的 SHA-256；轮换时至少保留新旧两套
    ]
}

func urlSession(_ session: URLSession,
                didReceive challenge: URLAuthenticationChallenge,
                completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust,
          let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], // iOS 15+，旧系统用 SecTrustGetCertificateAtIndex
          let leaf = chain.first else {
        completionHandler(.performDefaultHandling, nil)
        return
    }

    let certData = SecCertificateCopyData(leaf) as Data
    let hash = Data(SHA256.hash(data: certData))
    if PinnedCertificates.hashes.contains(hash) {
        completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}
```
 key points:
- certificate fixation is simpler than public key fixation, but** must be issued when the **certificate is rotated;
- Fixed public key (SPKI) is more resistant to rotation, but has to deal with multiple sets of public keys and grayscale;
- has at least one built-in backup certificate/public key to avoid single point of failure;
- Fixed failure must be reported, but do not "release it if verification fails" in production;
- Two-way authentication also needs to handle client certificate reading, password, and expiration.

> ⚠️ Certificate fixation pitfalls: Certificates are expired and rotated, and all apps will be disconnected without updating; a rotation must be practiced before going online.

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
    // 解析 JSON；注意回调不保证主线程
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
It is necessary to create a Session** independently configured for **. Shared cannot be used:
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
⚠️ recv is a streaming read, **TCP packet sticking problem must be handled by the protocol header (length field) sub-packet**.
> Swift requires import Darwin to call C Socket.

### 7. Common configuration URLSessionConfiguration
Three types:
- `.default`: Default, persistent cache, cookie
- `.ephemeral`: temporary session, no persistent cache, cookie, memory level, suitable for login state isolation
- `.background(withIdentifier:)`: Background tasks

Common configuration items:
```swift
config.timeoutIntervalForRequest = 15          // 单次请求空闲超时
config.timeoutIntervalForResource = 60         // 整个资源总超时
config.requestCachePolicy = .useProtocolCachePolicy
config.waitsForConnectivity = true             // 无网时等待，而不是立刻失败（iOS 11+）
config.allowsCellularAccess = true
config.allowsExpensiveNetworkAccess = true     // 允许热点/昂贵网络
config.allowsConstrainedNetworkAccess = false  // 低数据模式下是否允许（iOS 13+）
config.httpMaximumConnectionsPerHost = 6       // HTTP/1.1 单域名连接上限
config.httpAdditionalHeaders = ["Accept": "application/json"] // 通用头，别把 token 写死在这里
config.urlCache = URLCache(memoryCapacity: 20 * 1024 * 1024,
                           diskCapacity: 100 * 1024 * 1024)
```
> The global `httpAdditionalHeaders` will apply to all requests for this session; the login token should be placed in the `Authorization` header of the specific request to avoid aliasing and leakage.

### 8. Caching mechanism
HTTP cache is controlled by `Cache-Control`, `ETag`, `Last-Modified`; URLSession built-in cache database.
Caching strategy:
- `.useProtocolCachePolicy`: follow HTTP header (default)
- `.reloadIgnoringLocalCacheData`: Do not use cache
- `.reloadIgnoringLocalAndRemoteCacheData`: Both local and proxy caches are ignored
- `.returnCacheDataElseLoad`: If there is a cache, use the cache first and do not request again.
- `.returnCacheDataDontLoad`: cache only, offline mode

### 9. Task metrics: URLSessionTaskMetrics
URLSession comes with a time-consuming breakdown of each hop, which is very useful for troubleshooting "slow DNS, slow TLS, and slow server":
```swift
final class MetricsDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    didFinishCollecting metrics: URLSessionTaskMetrics) {
        guard let tx = metrics.transactionMetrics.last else { return }
        print("协议:", tx.networkProtocolName ?? "-")
        print("连接复用:", tx.isReusedConnection)
        print("走代理:", tx.isProxyConnection)
        print("DNS:", tx.dnsStartDate as Any, tx.dnsEndDate as Any)
        print("TCP:", tx.connectStartDate, tx.connectEndDate)
        print("TLS:", tx.secureConnectionStartDate as Any, tx.secureConnectionEndDate as Any)
        print("TTFB:", tx.responseStartDate.timeIntervalSince(tx.requestStartDate))
        print("总耗时:", metrics.taskInterval.duration)
    }
}
```
| indicator | corresponding stage | Prioritize troubleshooting when abnormality occurs |
|---|---|---|
| `dnsStartDate/dnsEndDate` | DNS resolution | Too many domain names, DNS service, IPv6 fallback |
| `connectStartDate/connectEndDate` | TCP connection establishment | Network quality, cross-region, connection not reused |
| `secureConnectionStartDate/secureConnectionEndDate` | TLS handshake | Certificate chain, TLS version, Pinning |
| `requestStartDate → responseStartDate` | First byte TTFB | Server processing, gateway queuing |
| `responseEndDate` | Response completed | Response body size, bandwidth |
| `isReusedConnection` | Connection reuse | A large number of false indicates that the connection pool is not in effect |

> `URLSession.shared` cannot set a custom delegate; to use indicators, certificate verification, and progress callbacks, you must create your own `URLSession`.
The > indicator can only be turned on in the Debug/sampling environment. Full online collection will increase overhead.

### 10. Waiting network and restricted network
```swift
config.waitsForConnectivity = true
config.timeoutIntervalForResource = 60
config.allowsConstrainedNetworkAccess = false   // 低数据模式下禁止大流量
```
- `waitsForConnectivity = true`: When there is no network, the task enters waiting instead of reporting `notConnectedToInternet` immediately;
- waiting is still limited by `timeoutIntervalForResource` and will not wait indefinitely;
- can implement `urlSession(_:taskIsWaitingForConnectivity:)` to prompt users;
- Low Data Mode is controlled by `allowsConstrainedNetworkAccess`;
- hotspot/billing network is controlled by `allowsExpensiveNetworkAccess`.

### 11. Resumable download and background session
After the ```swift
// 暂停并保存续传数据
downloadTask.cancel(byProducingResumeData: { resumeData in
    if let resumeData {
        try? resumeData.write(to: resumeDataURL)
    }
})

// 恢复下载
let data = try Data(contentsOf: resumeDataURL)
let task = session.downloadTask(withResumeData: data)
task.resume()
```
 background session is recycled by the system, the app must use the same identifier** as **to rebuild the session:
```swift
func application(_ application: UIApplication,
                 handleEventsForBackgroundURLSession identifier: String,
                 completionHandler: @escaping () -> Void) {
    backgroundCompletionHandler = completionHandler
    let config = URLSessionConfiguration.background(withIdentifier: identifier)
    config.sessionSendsLaunchEvents = true
    backgroundSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
}

func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async {
        self.backgroundCompletionHandler?()
        self.backgroundCompletionHandler = nil
    }
}
```
> The background task can handle "system hang/recycle", but **users will not continue** after swiping to kill the app; `completionHandler` must be called, otherwise the system will reduce the priority of subsequent wake-ups.

### 12. WebSocket keep alive
```swift
func startHeartbeat(_ task: URLSessionWebSocketTask, interval: TimeInterval = 20) {
    task.sendPing { [weak task] error in
        guard error == nil, let task else { return }
        DispatchQueue.global().asyncAfter(deadline: .now() + interval) {
            startHeartbeat(task, interval: interval)
        }
    }
}
```
- `URLSessionWebSocketTask` will not automatically reconnect. If disconnected, you must implement exponential backoff and reconnect by yourself;
- The heartbeat interval should be less than the idle timeout of the server/gateway;
- `receive` is "accept one and stop once" and needs to be called in a loop;
- Under weak network, it is necessary to distinguish between "temporarily no message" and "connection is broken", and combine ping/pong and error to judge.

---

## 3. Precautions
### 1. Threading problem (highest frequency)
✅ The callback of URLSession is executed in the `delegateQueue` (system serial queue) of the session by default. **does not guarantee the main thread**;
❌ Do not change the interface directly in the callback;✅ `DispatchQueue.main.async` must be switched to the main thread, or `delegateQueue` must be set as the main queue during initialization.

### 2. Distinguish between two parameters of timeout
- `timeoutIntervalForRequest`: **idle timeout**, timeout after not receiving new data packets for a period of time
- `timeoutIntervalForResource`: **The maximum total duration of the entire resource**, download large files to prevent unlimited lags
Many people are confused and set the request timeout to be very short, and the download of large files will fail directly.

### 3. Memory and circular references
In - delegate mode, URLSession will forcibly hold the delegate, which is easy to reference circularly; remember `session.invalidateAndCancel()` / `finishTasksAndInvalidate()` after use
- The large file dataTask will read all the data into the memory. To download the large file **, you must use DownloadTask**, otherwise the memory will explode and crash.

### 4. Background task restrictions
- The number of background downloads is limited and the system scheduling priority is low;
- background callback recreates session in `handleEventsForBackgroundURLSession` of AppDelegate / SceneDelegate;
- The task can be continued when the system suspends/recycles the app, but **users will not continue after swiping to kill the app**;
- background tasks are not suitable for scenarios with high real-time requirements.

### 5. ATS and certificate pit
1. Try not to turn off ATS globally;
2. SSL Pinning: Certificate pinning must also handle certificate rotation, otherwise the certificate will expire and the Internet will be unable to connect after the release;
3. Self-signed certificate: The default verification fails and must be manually trusted in the challenge callback (test environment only, strictly prohibited in production);
4. Two-way authentication: p12 file password and certificate reading failures are common.

### 6. TCP sticky packet (must read for Socket development)
TCP is a stream of bytes with no message boundaries. There is no correspondence between the number of times `send` and the number of times `recv` has been read.
✅ Standard solution: protocol header + data length (such as 4-byte big-endian length, followed by payload), read enough length and then unpack it.
UDP does not have sticky packets, and a recvfrom gets a complete message.

### 7. Network reachability monitoring
Apple recommends: `NWPathMonitor` (Network framework, iOS12+), which replaces the `SCNetworkReachability` / Reachability package commonly seen in the community.
Can monitor: WiFi/cellular, whether there is a network, whether there is an expensive network (hotspot).
⚠️ Reachability ≠ Able to connect to the server: The mobile phone is connected to WiFi, but the router is disconnected from the external network, but it still shows that there is a network. **can only be used as a prompt and cannot replace** in determining request failure.

### 8. Cookie Management
The default session shares system cookie storage; ephemeral does not persist cookies.
You can manually read and write cookies through `HTTPCookieStorage`; many login states are based on cookies.

### 9. Proxy, redirection, challenge callback
`URLSession(_:task:willPerformHTTPRedirection:newRequest:completionHandler:)`
You can intercept 302/301 redirects and customize whether to follow the jump.

### 10. IPv6 compatible
Apple requires that Apps must support IPv6-only network environments; do not hard-code IPv4 addresses in the code, and give priority to domain names.

### 11. Proxy (system HTTP proxy, VPN)
URLSession **automatically inherits the system HTTP proxy and VPN configuration**, no additional code is required; the underlying BSD Socket will not automatically read the system HTTP proxy, and you need to implement the proxy handshake yourself, or use CFNetwork / Network.framework instead and explicitly configure the proxy. This is a big pitfall in underlying Socket development.

### 12. Error type distinction
`URLError` is a network layer error, which is three different things from HTTP status code and parsing error:

| Error | Meaning | Typical processing |
|---|---|---|
| `.timedOut` | Connection/read timeout | Retryable, exponential backoff |
| `.notConnectedToInternet` | No network | Prompt to check the network and wait for the network to recover |
| `.networkConnectionLost` | The connection is disconnected midway | You can try again, pay attention to idempotence |
| `.cannotConnectToHost` | Unable to connect to host | Service unavailable/port error |
| `.cannotFindHost` | DNS resolution failure | Domain name/DNS problem |
| `.secureConnectionFailed` | TLS handshake failed | Certificate, TLS version, Pinning |
| `.serverCertificateUntrusted` | Certificate is not trusted | Do not bypass | in production
| `.cancelled` | Actively cancel | Normal control flow, no error |
| `.httpTooManyRedirects` | Redirect infinite loop | Check 301/302 configuration |

The > business is divided into three layers: network layer errors (URLError), HTTP errors (4xx/5xx), and data errors (parsing/verification failure). Users are given different prompts and decide whether to retry respectively.

### 13. Concurrency, number of connections and current limit
`httpMaximumConnectionsPerHost` limits the number of **single domain name connections**, not QPS; HTTP/2 will multiplex on one connection, and the actual concurrency capability is stronger.
URLSession does not have built-in QPS current limiting. For a large number of requests in a short period of time, you need to make your own request queue, token bucket or anti-shake, and comply with the server-side `429 + Retry-After`.

### 14. Privacy permissions
iOS 14+ does not require permissions to access the public network itself; `NWPathMonitor` only monitors network status and does not require permissions.
What really requires permission is the **local network**: to access LAN devices, Bonjour, multicast, etc., `NSLocalNetworkUsageDescription` is required, and `NSBonjourServices` is declared in Info.plist (if Bonjour is used).

### 15. New writing method of Swift Concurrency (async/await) (iOS15+)
```swift
let (data, response) = try await URLSession.shared.data(from: url)
guard let http = response as? HTTPURLResponse,
      (200..<300).contains(http.statusCode) else {
    throw NetworkError.badStatus
}
```
`data(for:)` / `download(for:)` / `upload(for:from:)` is a modern encapsulation of the completion API, and the bottom layer is still URLSession.

Note:
- **async version will not automatically verify the HTTP status code**, `4xx/5xx` will also return `data` normally, you must make your own judgment;
- async version **does not have progress callback**; progress, certificate verification, and background download still need to use delegate;
- uses `download(for:)` to download large files, and `data(for:)` will read the entire response into memory;
- `URLSession.shared` cannot set delegate. Create your own session when you need custom capabilities.

### 16. Timeout, retry and idempotence
| situation | Whether to retry | Description |
|---|---|---|
| DNS failure, connection failure, timeout | ✅ | exponential backoff + jitter, limited times |
| 5xx | ✅ | Temporary server error, please try again |
| 429 | ⚠️ | must comply with `Retry-After` |
| 400/401/403/404 | ❌ | Retry will not succeed, first repair request or login status |
| Non-idempotent POST | ❌ | Unless idempotent keys are provided, duplicate orders may be placed |
| User actively cancels | ❌ | `URLError.cancelled` is not a fault |

```swift
func retryDelay(attempt: Int) -> TimeInterval {
    let base = min(8.0, pow(2.0, Double(attempt)))   // 1,2,4,8...
    return Double.random(in: 0...base)               // full jitter，避免惊群
}
```
- URLSession **will not automatically retry** (except for a few system-level redirections/connection recovery), you need to implement it yourself or use Alamofire's interceptor;
- Retries are only done at one level: if the gateway retries, the client will not retry at all levels;
- The total client timeout should be slightly larger than the server processing budget so that server errors can be returned; but there must be an upper limit;
- `waitsForConnectivity` means "waiting for the network", not "retry on failure", don't mix them;
- It is recommended that the UUID be generated by the client for the idempotent key, and the unique index on the server be dropped into the database.

### 17. Request cancellation and page life cycle
```swift
private var searchTask: URLSessionDataTask?

func search(_ keyword: String) {
    searchTask?.cancel()                     // 取消上一次搜索
    let task = session.dataTask(with: makeRequest(keyword)) { [weak self] data, _, error in
        guard let self else { return }
        if let error = error as? URLError, error.code == .cancelled { return }
        // 更新结果
    }
    searchTask = task
    task.resume()
}
```
- Cancel unfinished requests when the page disappears/the controller is destroyed to avoid callbacks hitting released objects;
- Search, filter and enter Lenovo to **to cancel the old request** to prevent the old response from overwriting the new results;
- delegate is a strong reference. When the session is used up, `invalidateAndCancel()` (cancel immediately) or `finishTasksAndInvalidate()` (wait to be completed in transit);
- async/await scenario is canceled with `Task` handle, and cooperates with `withTaskCancellationHandler` if necessary;
- Cancellation is a normal control flow, do not treat it as an error pop-up window.

---

## 4. Technology selection summary table
| Scenario | Recommended Solution |
|---|---|
| Common HTTP/HTTPS interface | URLSession async/await / Alamofire |
| requires progress, certificate fixation, and task indicators | Customized `URLSession` + delegate |
| Weak network/subway/elevator scenario | `waitsForConnectivity = true` + timeout budget |
| File download, breakpoint, background download | `URLSessionDownloadTask` (delegate) |
| Large file upload | `URLSessionUploadTask` (`fromFile`, avoid reading into memory) |
| Real-time messaging, WebSocket | `URLSessionWebSocketTask` (iOS 13+) |
| Custom private TCP binary protocol | `URLSessionStreamTask` / CFStream / BSD Socket |
| UDP real-time streaming | Network.framework (`NWConnection`) |
| HTTP/2 / HTTP/3 | URLSession auto-negotiation, no need to change the code |
| Network status monitoring | `NWPathMonitor` |
| Local network permissions | `NSLocalNetworkUsageDescription` + `NSBonjourServices` |

---
