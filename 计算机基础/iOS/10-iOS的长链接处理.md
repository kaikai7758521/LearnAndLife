# iOS 长连接完整方案讲解
> 先明确：iOS 里长连接本质就是一条**持续存活的 TCP 连接**，业务上用来做实时推送、IM、设备指令、状态同步。
> 可选技术栈：
> 1. **URLSessionWebSocketTask（iOS13+，WSS）**：Websocket，HTTP 握手升级，业务最常用
> 2. **CFStream / CFSocket（CFNetwork）**：原生 TCP 流，老方案，可控性强
> 3. **BSD Socket**：裸 socket，自由度最高，坑最多，要自己处理所有细节
> 4. **NWConnection（Network.framework iOS12+）**：苹果新一代推荐底层网络框架，TCP/UDP 长连接首选，支持 IPv6、代理、TLS、优雅断连，替代 CFStream

**重点前置结论：iOS 系统对长连接非常不友好，App 退后台之后会被系统限制、挂起、掐连接。长连接最大难点不是“建立连接”，而是【保活、重连、后台策略、系统限制】。**

下面分：选型对比、核心流程、保活机制、断线重连、后台处理、TLS/证书、多坑、最佳实践。

---

## 一、先选型：不同长连接场景怎么选
| 场景 | 推荐方案 | 说明 |
|---|---|---|
| IM、业务实时消息，服务端提供 ws 接口 | URLSessionWebSocketTask | 开发简单，系统原生，自动适配 ATS、代理；缺点：控制粒度弱一点 |
| 私有二进制 TCP 协议（自研协议，不是websocket） | NWConnection（Network.framework） | ✅ 现在苹果官方主推，替代 CFStream，API 现代化，支持状态监听、TLS、优雅关闭 |
| 老项目、需要兼容 iOS11 及更低 | CFStream（CFReadStream / CFWriteStream） | Runloop 驱动，写起来繁琐，容易忘从 runloop 移除导致内存泄漏 |
| 极致高性能、自定义协议（极少用） | BSD Socket | 自己处理粘包、心跳、信号、SIGPIPE，**不推荐普通业务**；裸 socket 不会自动走系统 HTTP/HTTPS 代理/VPN，大坑 |

> Alamofire 只是 HTTP 短请求库，**不做长连接**。SocketRocket 是第三方 WebSocket（基于 CFStream），现在新项目优先原生 URLSessionWebSocketTask。

> 区分两个概念：
> - WebSocket：只是**跑在 TCP 之上的协议**，有固定帧格式、握手；
> - 原生 TCP 长连接：自己定义二进制协议头（长度域 + payload），自己分包解包、处理粘包。

---

## 二、长连接标准整体流程（通用，WebSocket / NWConnection / CFStream 都适用）
1. **连接前准备**
    - 先通过 NWPathMonitor 判断网络环境：WiFi / 蜂窝 / 无网 / 昂贵网络（热点）
    - 网络不可用时，直接不发起连接，加入等待队列
    - 携带鉴权信息（token、设备id）：握手包 / WebSocket 握手请求头里带上
2. **发起连接**
    - 设置超时（连接超时，一般 5~10s）
    - TLS 配置：是否加密、证书校验、SSL Pinning
3. **连接成功**
    - 标记状态：connected
    - 启动**心跳定时器**
    - 发送上线包（login 包，上报设备信息）
    - 开始循环接收服务端下行消息
4. **正常收发消息**
    - 发送：消息入队列，串行发送（防止并发乱序）
    - 接收：解析消息，抛给业务层；处理服务端主动下发的 ping
5. **心跳保活（核心！）**
6. **收到关闭帧 / 异常断开**：进入重连逻辑
7. **主动关闭**：发送关闭帧，优雅关闭连接，释放资源

> 长连接模块建议做成**单例管理**，全局唯一连接，不要多处随便创建多个长连接。

---

## 三、心跳保活机制
TCP 本身有 **TCP Keepalive（内核层保活）**，但是 iOS 上有巨大限制：
> TCP Keepalive 是内核参数 `SO_KEEPALIVE`：设置 `keepalive_time / keepalive_intvl / keepalive_cnt`
> ❗ 问题：
> 1. 运营商 NAT 超时：手机蜂窝网络下，运营商网关空闲一段时间（一般 30s~5min 不等）会静默干掉空闲 TCP 流，**不会发 FIN/RST**。此时两端都认为连接还在，但是数据发不出去——**死连接（僵死连接）**
> 2. iOS 在后台时，内核 keepalive 容易被系统休眠机制抑制，不生效
> 👉 **结论：TCP keepalive 只能作为辅助，业务层必须自己实现心跳（应用层 ping/pong）**

### 标准心跳方案（业务 ping pong）
- 客户端定时向服务端发送 `ping` 包
- 服务端收到后回复 `pong`
- 客户端设置超时窗口：如果连续 N 次 ping 没有收到 pong → 判断连接僵死，主动断开，触发重连

推荐参数（蜂窝网保守值）：
- ping 间隔：**30s**（WiFi 可以放宽到 45~60s）
- 超时次数：连续 2 次没收到 pong = 判定失效
> 不要设置太短（比如 5s）：耗电、增加服务端压力；不要太长，容易踩运营商 NAT 超时。

> WebSocket 自带标准 ping/pong：`webSocketTask.sendPing(pongReceiveHandler:)`，优先用原生 ping，不用自己封装业务包。
> 注意：服务端也可能主动发 ping，客户端必须回复 pong，否则服务端会断开。

> 定时器坑：
> - 不要用普通 `Timer`，Timer 依赖 Runloop；App 进入后台 Runloop 休眠，Timer 停掉！
> - 后台心跳是无法稳定跑的，这是 iOS 底层限制，后面单独讲后台策略。

---

## 四、断线检测 & 自动重连策略
### 1. 断开的几种原因，要区分对待
1. **正常关闭**：服务端下发关闭帧、客户端主动 logout → **不要自动重连**（用户登出）
2. **网络切换**：WiFi ↔ 蜂窝、VPN 开关 → 旧连接直接失效，立刻断开，进入重连
3. **僵死连接**：ping 超时，无任何回调，收不到数据 → 主动 close，重连
4. **服务端过载踢下线、token 过期**：业务包返回特定错误码 → 停止重连，通知业务层重新登录拿 token
5. **系统杀连接、App 被挂起唤醒后**：连接已经不存在，需要重建

### 2. 重连算法：指数退避（必须做，防止风暴）
禁止：断开之后立刻无限循环疯狂重连，服务端瞬间被打满。
标准指数退避：
- 第一次重连延迟：1s
- 第二次：2s
- 第三次：4s
- 第四次：8s
- 上限封顶：最大 16s / 30s（不再继续放大）
- **一旦网络状态从无网变成有网，立刻重置退避计数器，马上尝试重连**（NWPathMonitor 网络恢复事件触发）

伪逻辑：
```
断开 -> 等待 delay（1,2,4,8...max）-> 尝试连接
连接成功：重置退避计数
连接失败：计数+1
网络恢复：重置计数，立即重试
用户主动登出：停止所有重连
```

### 3. 消息发送队列
长连接断开期间，业务发送的消息不能直接丢弃：
- 维护一个**待发送消息队列**
- 连接成功之后，按顺序补发
- 增加最大队列长度、消息过期时间（防止队列无限膨胀内存爆炸）
- 部分消息（实时状态）可以设计成：新消息覆盖旧消息

---

## 五、iOS 后台长连接：最痛的难点（系统限制，绕不开）
> 核心事实：**iOS App 退到后台之后，一段时间后会被系统 suspend（挂起），线程、Runloop 冻结，你的长连接代码不再执行。**
> 👉 挂起之后：
> - 心跳定时器停止
> - 收不到消息回调
> - TCP 连接大概率被运营商 NAT / 系统掐断
>
> ❌ 不存在一个方案，可以让 App 像安卓一样在后台稳定跑长连接一直在线。

### 后台可选方案（三选一，按业务选）
1. **方案A：主推方案 —— 长连接只在前台生效；后台依赖 APNs 推送**（绝大多数 IM 产品：微信、QQ 都是这套）
    - App 在前台：走原生长连接，实时消息
    - App 退后台：主动关闭长连接；消息由服务端推 APNs
    - 用户点击推送唤醒 App：唤醒之后重新建立长连接，同步离线消息
    ✅ 最稳、符合苹果设计规范，审核不会出问题
    > 这是 iOS IM 行业标准方案，优先选这个！不要硬扛后台保活。

2. **方案B：后台任务 BGTask（BGProcessingTask / BGAppRefreshTask）**
    - 只能拿到**很短的后台运行时间（几十秒到几分钟不等，系统动态调度，不可控）**
    - 可以在后台拉起一小段时间，重建连接、拉取消息
    - 限制极大：触发时机不可控，不能持续在线；不适合低延迟实时业务
    - 需要注册后台模式，Info.plist 配置，审核需要合理用途说明

3. **方案C：VoIP Push（旧） / PushKit（现在严格限制）**
    - PushKit VoIP 原本用来给电话类 App 实时唤醒，唤醒 App 建立长连接
    - ⚠️ 苹果现在审核极严：**非 VoIP 通话类业务不允许滥用 PushKit 做普通 IM 消息推送，会被拒审**
    - 仅适合网络电话场景，普通聊天不要碰

> 补充后台模式：`audio`、`location` 后台模式可以保活，但属于滥用，审核直接打回，耗电巨大，不推荐用来做 IM 长连接。

一句话总结后台策略：**前台长连接 + 后台 APNs 兜底，是 iOS 长连接的标准答案。**

---

## 六、WebSocket 原生 URLSessionWebSocketTask 额外要点（iOS13+）
```swift
let task = URLSession.shared.webSocketTask(with: url)
task.resume()
```
1. 回调模型：`receive()` 是单次调用，收到消息后必须**递归再次调用 receive** 持续监听数据流
2. 自带 ping：`sendPing`，系统会自动回调 pong；用来检测僵死连接
3. 消息类型：`.string` / `.data`；二进制消息优先用 `.data`
4. 关闭：`sendClose(code:reason:)` 优雅关闭
5. 坑：shared Session 的 webSocketTask 在 App 进入后台之后，同样会失效，没有后台持续能力
6. 重定向、证书挑战和普通 URLSession 走同一个 delegate

> 注意：URLSessionWebSocketTask 不支持自定义 TCP 二进制协议，只能遵守 WebSocket 帧格式。

---

## 七、NWConnection（Network.framework TCP 原生长连接，iOS12+，推荐自研 TCP 协议）
NWConnection 是苹果新一代网络 API，是现在做私有 TCP 长连接首选，对比 CFStream 优势巨大：
- 基于状态机：ready / waiting / failed / cancelled / preparing
- 自动支持系统代理、VPN、IPv6
- 内置 TLS，证书校验回调统一
- 不需要手动管理 Runloop
- 异步回调基于 handler，不是 delegate
- 支持批量接收、流式读，处理 TCP 粘包很方便

核心流程：
1. 创建 NWConnection(host, port, using: .tcp)，配置 TLS 参数
2. `connection.stateUpdateHandler` 监听连接状态
3. `connection.start(queue: queue)`
4. `connection.receive(minimumIncompleteLength: 1, maximumLength: 4096)` 循环接收字节流
5. 自己实现分包器（4字节大端长度头 + payload，解决 TCP 粘包）
6. send(content: ...) 发送二进制包

> 粘包是 TCP 长连接必答题：TCP 是字节流，无边界。固定协议头长度域方案是工业标准。

---

## 八、证书、TLS、ATS、SSL Pinning
1. WebSocket wss:// 本质就是 TLS，受 ATS 管控；ws:// 明文，ATS 默认拦截，生产禁止
2. NWConnection 可以配置 TLS 参数：允许自签名证书、双向认证、证书固定
3. SSL Pinning：在 challenge 回调校验服务端公钥；长连接劫持危害更大，建议接入
4. 坑：证书固定后，证书轮换不发版 → App 全部连不上；要做双证书兜底（内置新旧两张公钥）

---

## 九、最容易出问题的地方
1. **Runloop 问题（CFStream 专属大坑）**
    CFReadStream / CFWriteStream 必须加入 Runloop，不加入就不会回调；退出时必须从 runloop remove，否则内存泄漏、野指针。新项目避开 CFStream。
2. **SIGPIPE 信号（BSD Socket）**
    对方关闭连接后继续 send，会触发 SIGPIPE，直接 crash。需要 `signal(SIGPIPE, SIG_IGN)` 忽略；NWConnection / URLSession 已经帮你处理，裸 socket 才要管。
3. **线程安全**
    长连接收发、状态变更、消息队列全部多线程访问；连接状态变量、发送队列必须加锁（串行队列 / NSLock），防止多线程同时 send、同时重连创建多条连接。
4. **多连接并发**
    重连还没成功的时候，禁止再发起新连接，要加一个 `isConnecting` 锁状态。
5. **网络切换瞬间风暴**
    WiFi切蜂窝，旧连接还没报错，业务立刻发起多条重连；靠状态锁 + NWPathMonitor 统一管控。
6. **耗电**
    心跳不要太频繁；消息队列合并；不要频繁创建销毁连接；频繁唤醒CPU会被用户投诉耗电。
7. **App 唤醒后状态不一致**
    App 从后台唤醒，不要假设长连接还活着；唤醒后主动检查连接状态，发起一次 ping 探测，无效则重建。
8. **蜂窝网络 NAT 超时差异巨大**
    不同运营商、不同地区 NAT idle timeout 不一样，不能写死一个心跳值，最好可以服务端下发心跳配置。
9. **代理/VPN**
    BSD Socket 不会自动走系统代理；NWConnection、URLSessionWebSocketTask 自动跟随系统代理，这是选型一个很关键的点。

---

## 十、架构分层建议（工程化写法）
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
对外暴露极简接口：
- connect()
- disconnect()
- sendMessage()
- 状态回调：onConnected / onDisconnected / onReceiveMessage / onError

业务层不需要关心底层是 WebSocket 还是 TCP，也不用关心重连、心跳细节。

---

## 十一、总结一句话路线图
如果你现在要开发 iOS IM 长连接：
> ✅ 前台：URLSessionWebSocketTask（iOS13+）或者 NWConnection（私有TCP）做长连接 + 应用层ping心跳 + 指数退避重连 + 消息队列
> ✅ 后台：放弃维持长连接，使用 APNs 推送兜底，唤醒 App 后重建连接同步消息
> ✅ 网络状态：NWPathMonitor 监听网络变化，网络恢复时触发重连
> ❌ 不要尝试用裸 BSD Socket 做业务长连接；不要指望后台无限保活；不要无限制快速重连
