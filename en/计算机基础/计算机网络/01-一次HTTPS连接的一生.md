---
title: "A lifetime of an HTTPS connection"
lang: en
translatedFrom: dff4afef04cfcb82d11aac58f4cc4c987d0e7403e0cd0c8b743acb81513bf2fa
translatedAt: 2026-11-25
---

# A lifetime of an HTTPS connection
> In one sentence: **opens a `https://` page, and DNS resolution → TCP three-way handshake → TLS handshake → HTTP request/response → connection reuse or close**; each layer has its own state machine, timeout and failure mode.
> Positioning: It talks about the network protocol itself and does not involve back-end business processing. For the story after the request enters the server, see `后端/基础概念/01-一次HTTP请求的后端旅程.md`.

## 1. Layering and packaging
```
应用层   HTTP/1.1、HTTP/2、HTTP/3
安全层   TLS 1.2 / TLS 1.3（HTTP/3 内置在 QUIC 里）
传输层   TCP（HTTP/1.1、HTTP/2）或 UDP（HTTP/3）
网络层   IP（IPv4 / IPv6）
链路层   以太网、Wi-Fi、蜂窝
```
- A header is added every time the application data goes down a layer. When it reaches the link layer, it is restricted by **MTU** (Ethernet is usually 1500 bytes);
- TCP will be segmented by **MSS** (~1460 for IPv4, ~1440 for IPv6), not by message boundaries;
- Therefore, "TCP reliable" only guarantees that the byte stream arrives in order. It does not guarantee that you will `send` once and the other party will `recv` once (packet sticking problem).

## 2. DNS: First change the domain name into IP
### 1. Analysis process
```
浏览器缓存 → 系统缓存 → hosts → 递归 DNS 服务器
  → 根服务器 → 顶级域（.com）→ 权威服务器 → 返回 A/AAAA
```
- `A` records return IPv4, `AAAA` returns IPv6;
- `CNAME` points one domain name to another domain name, often used in CDN;
- TTL determines how long to cache: if it is too long, failover will be slow, if it is too short, the parsing pressure will be high;
- The recursive server will cache the results, and the authoritative server is only responsible for its own Zone.

### 2. FAQ
| Phenomenon | Possible causes |
|---|---|
| First access is slow, subsequent access is normal | DNS resolution is slow or not cached |
| Part of the network cannot be opened | Local DNS pollution, IPv6 priority but unreachable |
| There is still old traffic after switching IP | TTL has not expired, client/intermediate device caches |
| HTTPS certificate domain name mismatch | Accessing CNAME target or IP |

> Modern solution: DoH (DNS over HTTPS), DoT (DNS over TLS) encrypted analysis; mobile terminals can also use system-level DNS. Use `dig`, `nslookup`, and `scutil --dns` (macOS) for troubleshooting.

## 3. TCP: reliable byte stream
### 1. Three-way handshake
Why is ```
Client                          Server
  │ ── SYN(seq=x) ──────────────▶ │  SYN_SENT → SYN_RCVD
  │ ◀─ SYN+ACK(seq=y, ack=x+1) ── │
  │ ── ACK(ack=y+1) ────────────▶ │  ESTABLISHED
```
 three times: Both parties must confirm "their own sending capabilities" and "the other party's receiving capabilities" and synchronize the initial sequence number (ISN). Twice failed to get the server to confirm that the client had received its SYN.

### 2. Wave four times
```
主动关闭方                     被动关闭方
  FIN ───────────────────────▶  CLOSE_WAIT
  ◀─────────────────────── ACK
  ◀─────────────────────── FIN  LAST_ACK
  ACK ───────────────────────▶  CLOSED
  TIME_WAIT（2MSL）→ CLOSED
```
- The active closing party enters `TIME_WAIT` and waits for 2MSL (about 60 seconds in Linux) to ensure that the last ACK can arrive and old connection packets will not be transmitted to the new connection;
If the - passive close side always stops at `CLOSE_WAIT`, it means that the **application did not call close**, which is a typical signal of code/connection pool leakage;
- `TIME_WAIT` is probably not a bug, but a normal state; port exhaustion is the problem.

### 3. Status quick check
| Status | Meaning |
|---|---|
| `LISTEN` | The server is waiting for connection |
| `SYN_SENT` | The client has sent SYN |
| `SYN_RCVD` | The server receives SYN and is semi-connected |
| `ESTABLISHED` | Connection available |
| `FIN_WAIT_1/2` | Active shutdown |
| `CLOSE_WAIT` | Receive the other party's FIN and wait for the local end to close |
| `LAST_ACK` | Passive shutdown side waits for the final ACK |
| `TIME_WAIT` | Actively close and wait for 2MSL |

### 4. Reliability mechanism
| Mechanism | Function |
|---|---|
| Serial number + ACK | Acknowledgment of receipt, deduplication, and sequence reorganization |
| Retransmission after timeout (RTO) | Resend after packet loss, RTO dynamic estimation |
| Fast retransmission | Retransmit immediately after receiving 3 duplicate ACKs without waiting for timeout |
| SACK | Tells the sender which intervals have been received, reducing retransmissions |
| sliding window | flow control, the receiver limits the sending amount through `rwnd` |
| Congestion control | senses network capacity through `cwnd` to avoid overwhelming the link |

Four stages of congestion control:
1. slow start: `cwnd` exponential growth;
2. Congestion Avoidance: More than `ssthresh` Post linear growth (AIMD);
3. Fast retransmission/fast recovery: reduce the window after packet loss but do not return to the starting point;
4. Modern algorithms: CUBIC (Linux default), BBR (based on bandwidth delay model), the behavior of different algorithms varies greatly.

### 5. Nagle and delayed ACK
- **Nagle**: Merge small packets to reduce the number of small packets in the network;
- **delayed ACK**: The receiver waits for a while before ACKing, hoping to carry the data;
- The superposition of the two may cause "40ms delay": small requests and other ACK, ACK and other data;
- low-latency scenarios can be set to `TCP_NODELAY`, but the number of small packets will increase.

### 6. Keep-Alive
- TCP keepalive defaults to a long idle time before detecting (Linux default is 7200 seconds) and cannot replace application layer heartbeat;
- Connection pools, NAT, and load balancers usually have their own idle timeouts, and the client should be smaller than them to avoid getting connections that have been closed by the peer;
- Long connections must have application layer heartbeat and reconnection.

## 4. TLS: Encrypt the byte stream
### 1. TLS 1.2 and 1.3
| Dimensions | TLS 1.2 | TLS 1.3 |
|---|---|---|
| handshake round trip | 2-RTT | 1-RTT |
| Session recovery | Session ID / Ticket | PSK / 0-RTT |
| Key exchange | RSA / ECDHE | (EC)DHE / PSK, supports forward secrecy |
| Encryption suite | Multiple and complex | Simplified, AEAD-based |
| 0-RTT | None | Yes, but there is a risk of replay |

TLS 1.3 handshake (simplified):
```
ClientHello（支持的版本、套件、key_share、SNI、ALPN）
  → ServerHello + 证书 + 签名 + Finished
  → Client Finished
  → 应用数据
```
- Certificate chain: leaf certificate → intermediate certificate → root certificate, the client uses the system root certificate for verification;
- `SNI` tells the server which domain name to access (default clear text);
- `ALPN` Negotiation application protocol (`h2`, `http/1.1`, `h3`);
- session recovery can reduce handshake overhead, 0-RTT data may be replayed, **is only suitable for idempotent requests**.

### 2. Certificates and common errors
| Error | Cause |
|---|---|
| Certificate expired | Not renewed/rotated |
| Certificate domain name does not match | SAN does not contain the current domain name |
| The certificate chain is incomplete | The server sends less intermediate certificates |
| self-signed certificate | is not trusted by the client and needs to be imported manually |
| TLS version is too low | Server is not enabled 1.2+ |
| Man-in-the-middle interception | Enterprise proxy, rogue Wi-Fi, Pinning failure |

Troubleshooting:
```bash
openssl s_client -connect example.com:443 -servername example.com -alpn h2
curl -vI https://example.com
```

## 5. HTTP: from 1.1 to 3
### 1. HTTP/1.1
- defaults to keep-alive, and one connection handles requests serially;
- Pipelining can theoretically be concurrent, but it is basically abandoned due to head-of-line blocking;
- Common optimizations: multiple domain names, resource merging, sprite images - all circumvent the restriction of "one request at a time per connection".

### 2. HTTP/2
- binary framing, multiplexing multiple streams on a TCP connection;
- HPACK compresses headers to reduce repeated Header overhead;
- flow control is divided into two levels: stream and connection;
- Server Push has been basically abandoned;
- **There is still TCP layer head blocking**: One packet is lost and all streams are waiting for retransmission.

### 3. HTTP/3
- is based on QUIC (UDP), TLS 1.3 built-in;
- Each stream is independent, and packet loss only affects its own stream;
- supports 0-RTT and connection migration (continuous connection when changing Wi-Fi);
- header is compressed with QPACK;
- Cost: Some networks are not friendly to UDP and need to fall back to HTTP/2.

| Version | Transport | Multiplexing | Head-of-line blocking | Handshake |
|---|---|---|---|---|
| HTTP/1.1 | TCP | ❌ | Application layer + TCP | TCP + TLS |
| HTTP/2 | TCP | ✅ | TCP layer | TCP + TLS |
| HTTP/3 | QUIC/UDP | ✅ | Basic elimination | QUIC built-in TLS 1.3 |

## 6. Connection reuse and connection pooling
- The client/server will cache the connection to avoid repeated handshakes;
- Connection idle timeout: When the client, load balancing, and server are inconsistent, "the connection has been closed by the peer, and the client is still sending requests" → `connection reset`;
- DNS TTL conflicts with long connections: the domain name has changed IP, and the old connection still points to the old IP, which needs to be removed actively;
- HTTP/2 Usually one connection is enough, there is no need to open many according to the domain name;
- The bigger the connection pool, the better: each connection occupies memory and ports, and the server also has a concurrency limit.

## 7. Troubleshooting toolbox
```bash
dig +trace example.com                 # 逐级看 DNS
curl -v --http2 https://example.com    # 看握手、Header、协议
curl -w "@curl-format.txt" -o /dev/null -s https://example.com
openssl s_client -connect example.com:443 -servername example.com
ss -tan state time-wait                # Linux 看连接状态
netstat -an | grep 443                 # macOS/老系统
tcpdump -i any -nn port 443            # 抓包（需权限）
```
 following indicators:
- DNS resolution takes time;
- TCP connection establishment time and number of retransmissions;
- TLS handshake time, protocol version, certificate chain;
- TTFB (time to first byte);
- connection reuse rate, TIME_WAIT/CLOSE_WAIT quantity.

## 8. Common misunderstandings
1. ❌ HTTPS will hide all information: domain name (SNI), IP, packet size/timing may still be exposed, and ECH has not yet been fully popularized;
2. ❌ HTTP/2 is definitely faster than HTTP/1.1: TCP head-of-line blocking under high packet loss networks will make it slower;
3. ❌ The longer the keep-alive, the better: the intermediate device will actively disconnect, and the timeout must be aligned;
4. ❌ TIME_WAIT is a fault: it is a normal active shutdown state, and optimization is required only when the port is exhausted;
5. ❌ CLOSE_WAIT is mostly normal: it usually means that the application did not close the connection;
6. ❌ TCP is a message protocol: it is a byte stream, and the message boundaries must be demarcated by the application layer protocol itself;
7. ❌ TLS 1.3’s 0-RTT can be used casually: there is a risk of replay, and it is only suitable for idempotent requests;
8. ❌ Enlarging the congestion window/adjusting kernel parameters can solve all slowdowns: first distinguish whether it is DNS, RTT, packet loss, server or client.

## 9. Summary
- An HTTPS connection = **DNS → TCP → TLS → HTTP**, each layer may become a bottleneck;
- TCP is responsible for reliability and ordering, TLS is responsible for confidentiality and identity, and HTTP is responsible for semantics;
- HTTP/2 solves the application layer head-of-line blocking, and HTTP/3 further solves the TCP layer head-of-line blocking;
- is broken down layer by layer when troubleshooting: first look at DNS and connection establishment, then TLS, then TTFB and transmission;
- Connection reuse, timeout, heartbeat, and certificate rotation are necessary parts of the long connection system design.
