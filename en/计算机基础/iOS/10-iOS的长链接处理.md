---
title: "IOS long connection complete solution explanation"
lang: en
translatedFrom: d3debfa0cd8d05eace93f56b78e4db96766cd8e9c309f4ce2ca80004e7dc3e6a
translatedAt: 2026-11-02
---

# IOS long connection complete solution explanation
> Let’s be clear first: The essence of a long connection in iOS is a TCP connection** that continues to survive. It is used for real-time push, IM, device commands, and status synchronization in business.
> optional technology stack:
> 1. **URLSessionWebSocketTask (iOS13+, WSS)**: Websocket, HTTP handshake upgrade, most commonly used in business
> 2. **CFStream / CFSocket (CFNetwork)**: native TCP stream, old solution, strong controllability
> 3. **BSD Socket**: bare socket, with the highest degree of freedom and the most pitfalls. You have to handle all the details yourself.
> 4. **NWConnection (Network.framework iOS12+)**: Apple’s new generation recommended underlying network framework, the first choice for TCP/UDP long connections, supports IPv6, proxy, TLS, graceful disconnection, replaces CFStream

**Key preliminary conclusion: The iOS system is very unfriendly to long connections. After the App exits the background, it will be restricted, suspended, and blocked by the system. The biggest difficulty with long connections is not "establishing a connection", but [keep-alive, reconnection, background policies, system limitations].**

The following points are: selection comparison, core process, keep-alive mechanism, disconnection and reconnection, background processing, TLS/certificate, multiple pitfalls, and best practices.

---

## 1. Select the model first: How to choose in different long connection scenarios
| Scenario | Recommended solution | Description |
|---|---|---|
| IM, real-time business messages, the server provides ws interface | URLSessionWebSocketTask | Simple development, native system, automatically adapts to ATS and agents; Disadvantages: The control granularity is weaker |
| Private binary TCP protocol (self-developed protocol, not websocket) | NWConnection (Network.framework) | ✅ Now officially promoted by Apple, replacing CFStream, API modernization, supporting status monitoring, TLS, graceful shutdown |
| Old project, needs to be compatible with iOS11 and lower | CFStream (CFReadStream / CFWriteStream) | Runloop driver is cumbersome to write, and it is easy to forget to remove it from the runloop, resulting in memory leaks |
| Extremely high performance, custom protocol (rarely used) | BSD Socket | handles sticky packets, heartbeats, signals, and SIGPIPE by itself. **is not recommended for ordinary business**; bare sockets will not automatically go to the system HTTP/HTTPS proxy/VPN, big pit |

> Alamofire is just HTTP short request library, **does not make long connection**. SocketRocket is a third-party WebSocket (based on CFStream). New projects now give priority to the native URLSessionWebSocketTask.

> distinguishes two concepts:
> - WebSocket: It is just the protocol** that **runs on top of TCP, with fixed frame format and handshake;
> - Native TCP long connection: define the binary protocol header (length field + payload) by yourself, subpackage and unpack and handle sticky packets by yourself.

---

## 2. Overall process of long connection standard (general, applicable to WebSocket / NWConnection / CFStream)
1. **Preparation before connection**
    - First use NWPathMonitor to determine the network environment: WiFi / cellular / no network / expensive network (hotspot)
    - When the network is unavailable, the connection is not initiated directly and joins the waiting queue.
    - carries authentication information (token, device ID): handshake packet/WebSocket handshake request header
2. **initiates connection**
    - Set timeout (connection timeout, usually 5~10s)
    - TLS configuration: whether to encrypt, certificate verification, SSL Pinning
3. **successfully connected**
    - tag status: connected
    - starts **heartbeat timer**
    - sends online package (login package, reports device information)
    - starts to receive downlink messages from the server in a loop
4. **sends and receives messages normally**
    - Send: Message is queued and sent serially (to prevent concurrent out-of-order)
    - receiving: parsing the message and throwing it to the business layer; processing the ping actively issued by the server
5. **Heartbeat keep-alive (core!)**
6. **receives a shutdown frame/abnormally disconnected**: enters reconnection logic
7. **proactively closes**: sends a shutdown frame, gracefully closes the connection, and releases resources

It is recommended that the > long connection module be made into a single instance of **to manage**, with a globally unique connection. Do not create multiple long connections randomly in multiple places.

---

## 3. Heartbeat keep-alive mechanism
TCP itself has **TCP Keepalive (kernel layer keepalive)**, but there are huge limitations on iOS:
> TCP Keepalive is a kernel parameter `SO_KEEPALIVE`: Set `keepalive_time / keepalive_intvl / keepalive_cnt`
> ❗ Question:
> 1. Operator NAT timeout: Under the mobile phone cellular network, the operator's gateway will silently kill the idle TCP flow if it is idle for a period of time (generally ranging from 30s to 5min), and **will not send FIN/RST**. At this time, both ends believe that the connection is still there, but the data cannot be sent out - **dead connection (zombie connection)**
> 2. When iOS is in the background, the kernel keepalive is easily suppressed by the system sleep mechanism and does not take effect.
> 👉 **Conclusion: TCP keepalive can only be used as an auxiliary, and the business layer must implement heartbeat (application layer ping/pong) by itself**

### Standard heartbeat solution (business ping pong)
- The client regularly sends `ping` packets to the server.
- The server will reply `pong` after receiving it.
- client sets a timeout window: if no pong is received after N consecutive pings → it is judged that the connection is dead, it will be actively disconnected, and a reconnection will be triggered.

Recommended parameters (conservative values for cellular networks):
- ping interval: **30s** (WiFi can be relaxed to 45~60s)
- Number of timeouts: 2 consecutive pong not received = judgment invalid
> Do not set it too short (such as 5s): it will consume power and increase the pressure on the server; do not set it too long, it will easily cause the operator's NAT timeout.

> WebSocket comes with standard ping/pong: `webSocketTask.sendPing(pongReceiveHandler:)`. Use native ping first and do not need to encapsulate the business package yourself.
> Note: The server may also actively send ping, and the client must reply with pong, otherwise the server will be disconnected.

> timer pit:
> - Don't use ordinary `Timer`, Timer depends on Runloop; when the App enters the background, Runloop sleeps, and Timer stops!
> - The background heartbeat cannot run stably. This is an underlying limitation of iOS. The background strategy will be discussed separately later.

---

## 4. Disconnection detection & automatic reconnection strategy
### 1. There are several reasons for disconnection, which should be treated differently.
1. **closes normally**: The server issues a shutdown frame and the client actively logs out → **Do not automatically reconnect** (user logs out)
2. **Network switching**: WiFi ↔ Cellular, VPN switch → The old connection directly fails, disconnects immediately, and enters reconnection
3. **Zombie connection**: ping timeout, no callback, no data received → Active close, reconnect
4. **The server is overloaded and kicked offline. The token expires.**: The business package returns a specific error code → Stop reconnection and notify the business layer to log in again to get the token.
5. **The system kills the connection and the App is suspended and wakes up.**: The connection no longer exists and needs to be rebuilt.

### 2. Reconnection algorithm: exponential backoff (must be done to prevent storms)
Prohibited: Immediately after disconnection, there will be an infinite loop of crazy reconnection, and the server will be filled up instantly.
Standard exponential backoff:
- First reconnection delay: 1s
- Second time: 2s
- Third time: 4s
- Fourth time: 8s
- upper limit: maximum 16s / 30s (no further zooming in)
- **Once the network status changes from no network to network, immediately reset the backoff counter and immediately try to reconnect** (NWPathMonitor network recovery event triggers)

Pseudo logic:
```
断开 -> 等待 delay（1,2,4,8...max）-> 尝试连接
连接成功：重置退避计数
连接失败：计数+1
网络恢复：重置计数，立即重试
用户主动登出：停止所有重连
```

### 3. Message sending queue
During the long connection disconnection period, messages sent by the business cannot be discarded directly:
- maintains a **message queue to be sent**
- will be reissued in sequence after the connection is successful.
- increases the maximum queue length and message expiration time (to prevent infinite expansion of the queue and memory explosion)
- Some messages (real-time status) can be designed such that new messages overwrite old messages

---

## 5. iOS background long connection: the most painful difficulty (system limitations, unavoidable)
> Core Facts: **iOS App After retreating to the background, it will be suspended by the system after a period of time, the thread and runloop will be frozen, and your long connection code will no longer be executed.**
> 👉 After hanging:
> - Heartbeat timer stopped
> - No message callback received
> - TCP connection is likely to be cut off by the operator's NAT/system
>
> ❌ There is no solution that allows the App to run stably in the background and stay online for long periods of time like Android.

### Backend optional solutions (choose one from three, choose according to business)
1. **Plan A: The main recommended plan - long connection only takes effect in the foreground; the backend relies on APNs to push** (most IM products: WeChat and QQ are this set)
    - App in the foreground: take the original growth connection, real-time news
    - App exits the background: actively closes long connections; messages are pushed by the server APNs
    - The user clicks the push button to wake up the App: after waking up, the long connection is re-established and offline messages are synchronized.
    ✅ The most stable and in line with Apple's design specifications, there will be no problems with the review
    > This is the iOS IM industry standard solution, choose this one first! Don't force yourself to stay alive in the background.

2. **Solution B: Background task BGTask (BGProcessingTask / BGAppRefreshTask)**
    - can only get a short background running time of **(ranging from tens of seconds to several minutes, the system is dynamically scheduled and uncontrollable)**
    - can be pulled up in the background for a short period of time to re-establish the connection and pull messages.
    - has great limitations: the triggering time is uncontrollable and cannot be continuously online; it is not suitable for low-latency real-time services
    - needs to register the background mode, Info.plist configuration, and review requires a reasonable use statement

3. **Scenario C: VoIP Push (old) / PushKit (now strictly limited)**
    - PushKit VoIP was originally used to wake up phone apps in real time and wake up the app to establish a long connection.
    - ⚠️ Apple is now extremely strict in auditing: **Non-VoIP call services are not allowed to abuse PushKit for ordinary IM message push, and will be rejected**
    - is only suitable for Internet phone scenarios. Do not touch it for ordinary chatting.

> supplementary background mode: `audio`, `location` background mode can be kept alive, but it is abusive, the review will be directly returned, and consumes a lot of power. It is not recommended for long IM connections.

Summarize the backend strategy in one sentence: **frontend long connection + backend APNs cover the whole story, which is the standard answer to iOS long connection.**

---

## 6. WebSocket native URLSessionWebSocketTask additional points (iOS13+)
```swift
let task = URLSession.shared.webSocketTask(with: url)
task.resume()
```
1. Callback model: `receive()` is a single call. After receiving the message, you must call **recursively again receive** to continuously monitor the data stream.
2. comes with ping: `sendPing`, the system will automatically call back pong; used to detect zombie connections
3. Message type: `.string` / `.data`; binary messages give priority to `.data`
4. shutdown: `sendClose(code:reason:)` graceful shutdown
5. Pitfall: Shared Session's webSocketTask will also become invalid after the App enters the background, and has no background persistence capability.
6. redirection, certificate challenge and ordinary URLSession use the same delegate

> Note: URLSessionWebSocketTask does not support custom TCP binary protocol and can only comply with WebSocket frame format.

---

## 7. NWConnection (Network.framework TCP native growth connection, iOS12+, self-developed TCP protocol recommended)
NWConnection is Apple's new generation network API. It is now the first choice for private TCP long connections. Compared with CFStream, it has huge advantages:
- Based on state machine: ready / waiting / failed / canceled / preparing
- automatically supports system proxy, VPN, IPv6
- has built-in TLS and unified certificate verification callbacks
- does not require manual management of Runloop
- asynchronous callback is based on handler, not delegate
- supports batch reception and streaming reading, and it is very convenient to handle TCP sticky packets.

Core process:
1. Create NWConnection(host, port, using: .tcp) and configure TLS parameters
2. `connection.stateUpdateHandler` monitor connection status
3. `connection.start(queue: queue)`
4. `connection.receive(minimumIncompleteLength: 1, maximumLength: 4096)` cyclically receives byte stream
5. implements its own packetizer (4-byte big-endian length header + payload, solving TCP sticky packets)
6. send(content: ...) sends binary package

> Sticky packets are a must-answer question for TCP long connections: TCP is a byte stream without boundaries. The fixed header length field scheme is the industry standard.

---

## 8. Certificate, TLS, ATS, SSL Pinning
1. WebSocket wss:// is essentially TLS and is controlled by ATS; ws:// is plain text, ATS intercepts it by default, and production is prohibited.
2. NWConnection can configure TLS parameters: allow self-signed certificates, two-way authentication, certificate pinning
3. SSL Pinning: Verify the server public key in the challenge callback; long connection hijacking is more harmful, it is recommended to access
4. Pitfall: After the certificate is fixed, the certificate is rotated and not released → all apps cannot be connected; double certificates are required (new and old public keys are built-in)

---

## 9. The most likely place to go wrong
1. **Runloop problem (CFStream exclusive pit)**
    CFReadStream / CFWriteStream must be added to the Runloop, otherwise there will be no callback; it must be removed from the runloop when exiting, otherwise memory leaks and wild pointers will occur. New projects avoid CFStream.
2. **SIGPIPE signal (BSD Socket)**
    If the other party continues to send after closing the connection, SIGPIPE will be triggered and it will crash directly. Need to be ignored by `signal(SIGPIPE, SIG_IGN)`; NWConnection / URLSession has been handled for you, only the bare socket needs to be managed.
3. **Thread-safe**
    Long connection sending and receiving, status changes, and message queues are all accessed by multiple threads; connection status variables and sending queues must be locked (serial queue/NSLock) to prevent multiple threads from sending at the same time and reconnecting at the same time to create multiple connections.
4. **Multiple connections concurrently**
    When the reconnection is not successful, it is forbidden to initiate new connections and a `isConnecting` lock status must be added.
5. **Network switching instant storm**
    When WiFi switches to cellular, no error is reported for the old connection, and the service immediately initiates multiple reconnections; it relies on status lock + NWPathMonitor for unified control.
6. **Power consumption**
    Don’t have too frequent heartbeats; merge message queues; don’t frequently create and destroy connections; frequently waking up the CPU will cause users to complain about power consumption.
7. **App The status is inconsistent after waking up**
    When the app wakes up from the background, do not assume that the long connection is still alive; after waking up, it actively checks the connection status and initiates a ping probe. If it is invalid, it will be reestablished.
8. **Cellular network NAT timeout difference is huge**
    Different operators and different regions have different NAT idle timeouts. You cannot hard-code a heartbeat value. It is best to issue heartbeat configurations from the server.
9. **agent/VPN**
    BSD Socket will not automatically follow the system proxy; NWConnection and URLSessionWebSocketTask will automatically follow the system proxy, which is a key point in selection.

---

## 10. Architecture layering suggestions (engineering writing method)
```
业务层（IM聊天、设备指令）
    ↓
LongConnectManager（单例长连接管理器）
    - 连接状态管理：idle / connecting / connected / disconnecting
    - 心跳管理
    - 重连退避控制器
    - 消息发送队列
    - 网络监听 NWPathMonitor
    ↓
底层通道层（NWConnection / URLSessionWebSocketTask）
    - 收发原始字节/帧
    - TLS、证书回调
    ↓
协议编解码器
    - WebSocket帧解析 / 私有TCP分包解包（处理粘包）
```
 exposes a minimalist interface:
- connect()
- disconnect()
- sendMessage()
- status callback: onConnected / onDisconnected / onReceiveMessage / onError

The business layer does not need to care about whether the underlying layer is WebSocket or TCP, nor does it need to care about reconnection or heartbeat details.

---

## 11. Summarize the roadmap in one sentence
If you want to develop iOS IM long connection now:
> ✅ Front desk: URLSessionWebSocketTask (iOS13+) or NWConnection (private TCP) for long connection + application layer ping heartbeat + exponential backoff reconnect + message queue
> ✅Backend: Give up maintaining long connections, use APNs to push the bottom line, wake up the App and reestablish the connection to synchronize messages
> ✅ Network status: NWPathMonitor monitors network changes and triggers reconnection when the network recovers.
> ❌ Do not try to use bare BSD Socket for long-term business connections; do not expect infinite keep-alive in the background; do not limit fast reconnection
