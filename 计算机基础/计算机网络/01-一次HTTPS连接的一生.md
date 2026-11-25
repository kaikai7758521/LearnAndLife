# 一次 HTTPS 连接的一生
> 一句话：**打开一个 `https://` 页面，背后依次发生 DNS 解析 → TCP 三次握手 → TLS 握手 → HTTP 请求/响应 → 连接复用或关闭**；每一层都有自己的状态机、超时与失败模式。
> 定位：讲网络协议本身，不涉及后端业务处理。请求进入服务端之后的故事，见 `后端/基础概念/01-一次HTTP请求的后端旅程.md`。

## 一、分层与封装
```
应用层   HTTP/1.1、HTTP/2、HTTP/3
安全层   TLS 1.2 / TLS 1.3（HTTP/3 内置在 QUIC 里）
传输层   TCP（HTTP/1.1、HTTP/2）或 UDP（HTTP/3）
网络层   IP（IPv4 / IPv6）
链路层   以太网、Wi-Fi、蜂窝
```
- 应用数据每往下走一层就加一个头部，到了链路层受 **MTU** 限制（以太网通常 1500 字节）；
- TCP 会按 **MSS** 分段（IPv4 约 1460，IPv6 约 1440），不是按消息边界；
- 所以「TCP 可靠」只保证字节流有序到达，不保证你 `send` 一次、对方就 `recv` 一次（粘包问题）。

## 二、DNS：先把域名变成 IP
### 1. 解析过程
```
浏览器缓存 → 系统缓存 → hosts → 递归 DNS 服务器
  → 根服务器 → 顶级域（.com）→ 权威服务器 → 返回 A/AAAA
```
- `A` 记录返回 IPv4，`AAAA` 返回 IPv6；
- `CNAME` 把一个域名指向另一个域名，常用于 CDN；
- TTL 决定缓存多久：太长故障切换慢，太短解析压力大；
- 递归服务器会缓存结果，权威服务器只负责自己的 Zone。

### 2. 常见问题
| 现象 | 可能原因 |
|---|---|
| 首次访问慢、后续正常 | DNS 解析慢或未缓存 |
| 部分网络打不开 | 本地 DNS 污染、IPv6 优先但不可达 |
| 切换 IP 后仍有旧流量 | TTL 未过期、客户端/中间设备缓存 |
| HTTPS 证书域名不匹配 | 访问的是 CNAME 目标或 IP |

> 现代方案：DoH（DNS over HTTPS）、DoT（DNS over TLS）加密解析；移动端还可使用系统级 DNS。排查用 `dig`、`nslookup`、`scutil --dns`（macOS）。

## 三、TCP：可靠字节流
### 1. 三次握手
```
Client                          Server
  │ ── SYN(seq=x) ──────────────▶ │  SYN_SENT → SYN_RCVD
  │ ◀─ SYN+ACK(seq=y, ack=x+1) ── │
  │ ── ACK(ack=y+1) ────────────▶ │  ESTABLISHED
```
为什么是三次：双方都要确认「自己的发送能力」和「对方的接收能力」，并同步初始序列号（ISN）。两次无法让服务端确认客户端已收到自己的 SYN。

### 2. 四次挥手
```
主动关闭方                     被动关闭方
  FIN ───────────────────────▶  CLOSE_WAIT
  ◀─────────────────────── ACK
  ◀─────────────────────── FIN  LAST_ACK
  ACK ───────────────────────▶  CLOSED
  TIME_WAIT（2MSL）→ CLOSED
```
- 主动关闭方进入 `TIME_WAIT`，等待 2MSL（Linux 约 60 秒），确保最后一个 ACK 能到达、旧连接报文不会串到新连接；
- 被动关闭方如果一直停在 `CLOSE_WAIT`，说明**应用没有调用 close**，是代码/连接池泄漏的典型信号；
- `TIME_WAIT` 多不是 bug，是正常状态；端口耗尽才是问题。

### 3. 状态速查
| 状态 | 含义 |
|---|---|
| `LISTEN` | 服务端等待连接 |
| `SYN_SENT` | 客户端已发 SYN |
| `SYN_RCVD` | 服务端收到 SYN，半连接 |
| `ESTABLISHED` | 连接可用 |
| `FIN_WAIT_1/2` | 主动关闭中 |
| `CLOSE_WAIT` | 收到对方 FIN，等待本端关闭 |
| `LAST_ACK` | 被动关闭方等待最后 ACK |
| `TIME_WAIT` | 主动关闭方等待 2MSL |

### 4. 可靠性机制
| 机制 | 作用 |
|---|---|
| 序列号 + ACK | 确认收到、去重、按序重组 |
| 超时重传（RTO） | 丢包后重发，RTO 动态估算 |
| 快速重传 | 收到 3 个重复 ACK 立即重传，不等超时 |
| SACK | 告诉发送方哪些区间已收到，减少重传 |
| 滑动窗口 | 流量控制，接收方通过 `rwnd` 限制发送量 |
| 拥塞控制 | 通过 `cwnd` 感知网络容量，避免压垮链路 |

拥塞控制四阶段：
1. 慢启动：`cwnd` 指数增长；
2. 拥塞避免：超过 `ssthresh` 后线性增长（AIMD）；
3. 快速重传/快速恢复：丢包后减窗但不回到起点；
4. 现代算法：CUBIC（Linux 默认）、BBR（基于带宽时延模型），不同算法行为差异很大。

### 5. Nagle 与延迟 ACK
- **Nagle**：把小包合并，减少网络中小报文数量；
- **延迟 ACK**：接收方等一会儿再 ACK，希望捎带数据；
- 两者叠加可能出现「40ms 延迟」：小请求等 ACK、ACK 等数据；
- 低延迟场景可设置 `TCP_NODELAY`，但会增加小包数量。

### 6. Keep-Alive
- TCP keepalive 默认空闲很久才探测（Linux 默认 7200 秒），不能替代应用层心跳；
- 连接池、NAT、负载均衡器通常有自己的空闲超时，客户端应小于它们，避免拿到已被对端关闭的连接；
- 长连接必须有应用层心跳与重连。

## 四、TLS：把字节流加密
### 1. TLS 1.2 与 1.3
| 维度 | TLS 1.2 | TLS 1.3 |
|---|---|---|
| 握手往返 | 2-RTT | 1-RTT |
| 会话恢复 | Session ID / Ticket | PSK / 0-RTT |
| 密钥交换 | RSA / ECDHE | (EC)DHE / PSK，支持前向保密 |
| 加密套件 | 多且复杂 | 精简、AEAD 为主 |
| 0-RTT | 无 | 有，但有重放风险 |

TLS 1.3 握手（简化）：
```
ClientHello（支持的版本、套件、key_share、SNI、ALPN）
  → ServerHello + 证书 + 签名 + Finished
  → Client Finished
  → 应用数据
```
- 证书链：叶子证书 → 中间证书 → 根证书，客户端用系统根证书校验；
- `SNI` 告诉服务器要访问哪个域名（默认明文）；
- `ALPN` 协商应用协议（`h2`、`http/1.1`、`h3`）；
- 会话恢复可减少握手开销，0-RTT 数据可能被重放，**只适合幂等请求**。

### 2. 证书与常见错误
| 错误 | 原因 |
|---|---|
| 证书过期 | 未续期/轮换 |
| 证书域名不匹配 | SAN 不含当前域名 |
| 证书链不完整 | 服务器少发中间证书 |
| 自签名证书 | 客户端不信任，需手动导入 |
| TLS 版本过低 | 服务端未启用 1.2+ |
| 中间人拦截 | 企业代理、恶意 Wi-Fi、Pinning 失败 |

排查：
```bash
openssl s_client -connect example.com:443 -servername example.com -alpn h2
curl -vI https://example.com
```

## 五、HTTP：从 1.1 到 3
### 1. HTTP/1.1
- 默认 keep-alive，一个连接串行处理请求；
- 管线化（pipelining）理论上可并发，但因队头阻塞基本废弃；
- 常见优化：多域名、资源合并、雪碧图——都是绕开「一条连接一次一个请求」的限制。

### 2. HTTP/2
- 二进制分帧，一条 TCP 连接上多路复用多个 stream；
- HPACK 压缩头部，减少重复 Header 开销；
- 流控按 stream 和 connection 两级；
- 服务端推送（Server Push）已基本废弃；
- **仍有 TCP 层队头阻塞**：一个包丢了，所有 stream 都等重传。

### 3. HTTP/3
- 基于 QUIC（UDP），TLS 1.3 内置；
- 每个 stream 独立，丢包只影响自己的 stream；
- 支持 0-RTT、连接迁移（换 Wi-Fi 不断连）；
- 头部用 QPACK 压缩；
- 代价：部分网络对 UDP 不友好，需要回退到 HTTP/2。

| 版本 | 传输 | 多路复用 | 队头阻塞 | 握手 |
|---|---|---|---|---|
| HTTP/1.1 | TCP | ❌ | 应用层 + TCP | TCP + TLS |
| HTTP/2 | TCP | ✅ | TCP 层 | TCP + TLS |
| HTTP/3 | QUIC/UDP | ✅ | 基本消除 | QUIC 内置 TLS 1.3 |

## 六、连接复用与连接池
- 客户端/服务端都会缓存连接，避免重复握手；
- 连接空闲超时：客户端、负载均衡、服务端三方不一致时，会出现「连接已被对端关闭，客户端还在发请求」→ `connection reset`；
- DNS TTL 与长连接冲突：域名换了 IP，旧连接仍指向旧 IP，需要主动摘除；
- HTTP/2 通常一条连接就够，不必按域名开很多条；
- 连接池不是越大越好：每条连接都占内存与端口，服务端也有并发上限。

## 七、排障工具箱
```bash
dig +trace example.com                 # 逐级看 DNS
curl -v --http2 https://example.com    # 看握手、Header、协议
curl -w "@curl-format.txt" -o /dev/null -s https://example.com
openssl s_client -connect example.com:443 -servername example.com
ss -tan state time-wait                # Linux 看连接状态
netstat -an | grep 443                 # macOS/老系统
tcpdump -i any -nn port 443            # 抓包（需权限）
```
关注指标：
- DNS 解析耗时；
- TCP 建连耗时、重传次数；
- TLS 握手耗时、协议版本、证书链；
- TTFB（首字节时间）；
- 连接复用率、TIME_WAIT/CLOSE_WAIT 数量。

## 八、常见误区
1. ❌ HTTPS 会隐藏所有信息：域名（SNI）、IP、包大小/时序仍可能暴露，ECH 尚未全面普及；
2. ❌ HTTP/2 一定比 HTTP/1.1 快：高丢包网络下 TCP 队头阻塞会让它更慢；
3. ❌ keep-alive 越长越好：中间设备会主动断开，超时必须对齐；
4. ❌ TIME_WAIT 是故障：它是正常的主动关闭状态，端口耗尽才需要优化；
5. ❌ CLOSE_WAIT 多也是正常：通常说明应用没有关闭连接；
6. ❌ TCP 是消息协议：它是字节流，消息边界要靠应用层协议自己划分；
7. ❌ TLS 1.3 的 0-RTT 可以随便用：有重放风险，只适合幂等请求；
8. ❌ 加大拥塞窗口/调内核参数能解决所有慢：先分清是 DNS、RTT、丢包、服务端还是客户端。

## 九、总结
- 一次 HTTPS 连接 = **DNS → TCP → TLS → HTTP**，每层都可能成为瓶颈；
- TCP 负责可靠有序，TLS 负责机密与身份，HTTP 负责语义；
- HTTP/2 解决应用层队头阻塞，HTTP/3 进一步解决 TCP 层队头阻塞；
- 排障时按层拆解：先看 DNS 与建连，再看 TLS，再看 TTFB 与传输；
- 连接复用、超时、心跳、证书轮换，是长连接系统必须设计的部分。
