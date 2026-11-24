---
title: "The backend journey of an HTTP request"
lang: en
translatedFrom: 0cf9a0264c9d78f993915ad3fe7b1cbeebac4e899cf1d1ad3399180ffdaa6c22
translatedAt: 2026-11-24
---

# The backend journey of an HTTP request
> In one sentence: the time consumption of a request = **access layer + queuing + application processing + storage + serialization**. Timeouts, retries, and lock waits in any period will be amplified into user-visible delays; the essence of back-end optimization is to establish a budget for each period and make failures controllable.
> Perspective: From the client making a request to the response returning to the client, what is each component doing along the way and where will problems occur?

## 1. Panorama
```
Client
  │ DNS / CDN
  ▼
L4 负载均衡（TCP）
  ▼
L7 网关（Nginx / Envoy）
  │ TLS 终止、路由、限流、鉴权
  ▼
应用服务（线程 / 协程 / 事件循环）
  ├─ 中间件：Trace → 日志 → 鉴权 → 限流 → 参数校验
  ├─ 业务逻辑
  ├─ 本地缓存 → Redis
  ├─ 数据库连接池 → MySQL
  ├─ RPC / 消息队列
  └─ 序列化 → 响应
```
| Stage | Typical time consumption (intranet) | Main risks |
|---|---|---|
| DNS / TLS | 10~200ms (first time) | Slow resolution, incomplete certificate chain, handshake failure |
| L4 / L7 forwarding | 0.1~2ms | Connection full, queue accumulation, timeout configuration error |
| Application queuing | 0~hundreds of ms | Thread pool/connection pool exhausted |
| Business processing | 1~100ms | Lock, slow query, synchronization RPC, GC |
| Storage access | 0.2~50ms | Missing index, insufficient connection pool, master-slave delay |
| Serialization/Network | 1~50ms | Large response body, compression overhead, bandwidth |

> delay is not an "average" problem, but a **tail delay** problem: p99 is often determined by queuing, lock waiting, GC, and retry.

## 2. Access layer: Where does the request go first?
### 1. DNS and CDN
- DNS determines which computer room/IP the user is connected to. If the TTL is too long, the failover will be slow, and if the TTL is too short, the resolution pressure will be amplified;
- CDN is responsible for static resources, pictures, and videos. Wrong cache key design will lead to "updates not taking effect" or "low hit rate";
- dynamic requests are generally returned to the gateway. Pay attention to the trust chain of `X-Forwarded-For` and `X-Forwarded-Proto` to avoid forged IPs.

### 2. L4 and L7
| layer | represents | what to see | typical capabilities |
|---|---|---|---|
| L4 | LVS, cloud CLB, F5 | IP/port | Layer 4 forwarding, DSR, connection persistence |
| L7 | Nginx, Envoy, gateway | HTTP header/path | Routing, TLS, current limiting, authentication, grayscale |

L7 gateways are typically responsible for:
- TLS termination (certificate, session reuse, OCSP);
- routing and grayscale (by header, cookie, weight);
- current limit, fuse, WAF;
- request header cleaning, body size limit, compression;
- access log and trace injection.

### 3. Connection multiplexing
- HTTP/1.1 defaults to keep-alive, but **serial** is requested on the same connection, and there is head-of-line blocking;
- HTTP/2 multiplexing solves application layer head-of-line blocking, but TCP layer packet loss will still block all flows;
- HTTP/3 is based on QUIC (UDP), which reduces handshakes and head-of-line blocking, and is suitable for weak networks;
The - gateway to the upstream must be configured with a **connection pool + keep-alive**. Otherwise, each request requires a TCP/TLS handshake, and the delay is directly doubled.

The retry of ```nginx
upstream app_backend {
    server 10.0.0.11:8080;
    server 10.0.0.12:8080;
    keepalive 64;                 # 与上游保持长连接
}

location /api/ {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_connect_timeout 1s;     # 建连超时要短
    proxy_read_timeout 5s;        # 必须小于客户端超时
    proxy_next_upstream error timeout http_502;
    proxy_next_upstream_tries 2;
}
```
> `proxy_next_upstream` is only safe for **idempotent request**; POST retry may cause repeated orders. Retry strategies should be designed together with business idempotence.

## 3. Application layer: how requests are processed
### 1. Processing model
| Model | Represents | Advantages | Costs |
|---|---|---|---|
| Threads per request | Tomcat, Spring MVC | Simple programming, intuitive blocking calls | Threads are expensive, queues will be queued when the pool is full |
| Coroutine | Go, Kotlin Coroutine | Lightweight, high concurrency | requires full link non-blocking |
| Event loop | Node.js, Nginx, Redis | Single-threaded high throughput | A blocking call freezes the entire process |
| Virtual thread | Java 21+ | Blocking writing method + high concurrency | Still need to pay attention to locks and pooled resources |

No matter which model, **thread/coroutine pool is a limited resource**: Once the downstream slows down, requests will be piled up in the pool queue, manifested as "CPU Not high but delayed surge."

### 2. Middleware sequence
Recommended order (the earlier, the cheaper and more global):
```
Trace/RequestId → 访问日志 → 鉴权 → 限流 → 参数校验 → 业务 → 响应包装
```
- Trace must be injected first to ensure that all subsequent logs, RPC, and SQL can carry traceId;
- Whether authentication is placed before or after current limiting depends on cost: JWT verification is cheap and can be placed in front, while database check authentication should be placed in the rear;
- parameter verification should limit the body size, array length, and paging size to prevent memory and slow query attacks.

### 3. Request context
A request should carry:
- `traceId` / `spanId`: full link tracking;
- `userId` / `tenantId`: permissions and multi-tenant isolation;
- `deadline`: The remaining available time is passed to the downstream;
- `idempotencyKey`: Write request to prevent duplication.

> 's stateless service puts the session in Redis or JWT, but **does not put large objects into JWT**. Each request must be transmitted and parsed.

## 4. Business processing: the most likely place for trouble
### 1. Transaction boundaries
Correct approach to ```java
// 错误：事务里做 RPC / 发消息 / 等锁
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);
    inventoryClient.deduct(order.getSkuId());  // 远程调用可能超时
    mqProducer.send("order-created", order);   // 消息可能成功、事务可能回滚
}
```
:
- transactions only cover database write operations, keeping them short;
- cross-service consistency uses **local message table / Outbox** or transaction message;
- Remote call failures must be compensated, and "sure success" cannot be assumed.

### 2. Concurrency control
| Solution | Applicable | Note |
|---|---|---|
| Optimistic locking (version/CAS) | Update with few conflicts | If failed, retry is required, the number of retries is limited |
| Pessimistic lock (`SELECT ... FOR UPDATE`) | High conflict, strong consistency | Lock range should be small to avoid deadlock |
| Distributed lock | Cross-instance mutual exclusion | There are lease and renewal issues and cannot replace database constraints |
| unique index | idempotent, anti-duplication | most reliable, capture and handle conflicts |

### 3. Idempotent
The writing interface must at least achieve "the same request arrives repeatedly and the result is consistent":
- The client generates `idempotencyKey`, and the server’s unique index is dropped into the database;
The - state machine only allows legal transitions (to be paid → paid, not reversed);
- message consumption uses "business unique key + deduplication table";
- updates use "set target status" instead of "incremental accumulation" to avoid repeated inventory additions.

## 5. Storage access: the focus of latency and concurrency
### 1. Connection pool
The bigger the connection pool, the better:
```
pool_size ≈ CPU 核数 × 2 ~ 4（SSD 场景）
```
- The pool is too large → Database thread context switching and lock competition intensify;
- pool is too small → request queuing, `connection timeout`;
- The waiting time of the connection pool needs to be monitored separately. It and slow query are two types of problems.

### 2. Query
- Look at the execution plan first, then the index, and finally consider the cache;
- Avoid N+1: batch query related data on list page;
- uses cursor (`WHERE id > ? ORDER BY id LIMIT ?`) for deep paging, not `LIMIT 100000, 20`;
- Large transactions will hold undo, locks, and connections, so try to split them into smaller ones;
- requires master-slave delay for read-write separation and strong consistency in reading the master library.

### 3. Cache
- It only makes sense if the cache hit rate is high. Test the hit rate first and then cache;
For the processing methods of - cache penetration, breakdown, and avalanche, see the cache topic;
- **The cache is not the data source**, the database is the ultimate fact.

## 6. Response: the last mile
- serialization: JSON is universal but large in size, internal RPC is available with Protobuf/Thrift;
- compression: gzip/br saves bandwidth but consumes CPU, small response is not worth the compression;
- paging: return `hasMore`/`nextCursor`, do not return the total number and cause the full table count;
The - status code semantics must be correct:

| Status code | Meaning | Common misuse |
|---|---|---|
| 200 | Successful | Returns 200 | even if the service fails
| 201 | Created | Create interface returns 200 |
| 204 | No content | Returns empty JSON |
| 400 | Parameter error | Use 500 to indicate parameter error |
| 401/403 | Unauthenticated/no authority | Mix both |
| 409 | conflict | Repeated creation returns 500 |
| 429 | current limit | current limit return 503 |
| 502/503/504 | Gateway/unavailable/timeout | All general reports 500 |

- error response does not include stack, SQL, and internal IP; use stable error codes externally.

## 7. Observability: How to know where the slowness is
| Signal | Key Content | Tool |
|---|---|---|
| Trace | Time consumption, status, downstream of each span | OpenTelemetry, Jaeger, SkyWalking |
| Metrics | QPS, error rate, p50/p95/p99, saturation | Prometheus, Grafana |
| Logs | structured, traceId, error context | ELK, Loki |
| Profile | CPU, memory, lock, GC | pprof, async-profiler, Arthas |

Check order:
1. Check whether the entrance QPS and error rate change suddenly;
2. Look at p99 and downstream span to determine whether it is application, DB, cache or RPC;
3. Look at the thread pool/connection pool queue, GC, CPU, lock wait;
4. Only look at a single slow SQL or code last.

## 8. Delay budget: set an upper limit for each segment
Assuming interface target p99 < 800ms:

| Link | Budget |
|---|---|
| Gateway | 30ms |
| Application Queuing + Processing | 100ms |
| cache | 10ms |
| database (2 times) | 80ms |
| 下游 RPC | 200ms |
| Serialization + Network | 80ms |
| Margin | 300ms |

Principles:
- **Outer layer timeout > Inner layer timeout**, otherwise the outer layer has given up and the inner layer is still working in vain;
- timeout is not "the bigger, the more stable", the larger the timeout, the more failures will accumulate;
- passes the deadline to the downstream and fails quickly when the remaining time is insufficient;
- retry budget is calculated separately to avoid "timeout × number of retries" from amplifying faults.

## 9. Common fault comparison table
| Phenomenon | Possible causes | Check | first
|---|---|---|
| 502 Bad Gateway | Upstream crash, port blocked, protocol error | Upstream process, health check, Nginx error log |
| 504 Gateway Timeout | Upstream processing timeout | Gateway read timeout, application p99, slow SQL |
| 499 (Nginx) | The client actively disconnects | The client times out and the first screen is too slow |
| 429 Too Many Requests | Trigger current limiting | Current limiting threshold, burst traffic, hotspot key |
| 413 Payload Too Large | body exceeds limit | Gateway/framework body limit |
| Connection Reset | service restart, TIME_WAIT, kernel parameters | release record, `ss -s`, backlog |
| Thread pool exhausted | Downstream slowdown, synchronization blocking | Pool queue length, downstream RT |
| Connection pool timeout | Slow query, transaction is too long, pool is too small | `SHOW PROCESSLIST`, pool indicator |
| Deadlock | Inconsistent locking sequence | `SHOW ENGINE INNODB STATUS` |
| CPU 100% | Infinite loop, serialization, GC | Flame graph, GC log |
| Memory continues to increase | leaks, unlimited cache, large objects | heap dump, cache statistics |

## 10. Optimization sequence
1. **measures**: first use trace/metrics to locate the bottleneck without guessing;
2. **Database**: index, N+1, slow query, transaction range;
3. **Cache**: hotspot data, hit rate, invalidation strategy;
4. **Asynchronous**: non-core links use MQ, shortening the main link;
5. **Resource pool**: thread pool, connection pool, queue capacity;
6. **horizontal expansion**: stateless service plus instance, with load balancing;
7. **code and algorithm**: Micro-optimization is done at the end.

80% of > ’s backend performance problems come from “unindexed queries + synchronous remote calls + unlimited pools/queues”.

## 11. Common misunderstandings
1. ❌ If the average delay is normal, it will be fine: the user perceives p99, and the average will cover up the long tail;
2. ❌ Setting the timeout to a larger value is more stable: more requests will accumulate during a failure and recovery will be slower;
3. ❌ Retry if failed: Retrying for non-idempotent writes will place orders repeatedly, and retrying will amplify the fault;
4. ❌ The bigger the connection pool/thread pool, the better: after exceeding the carrying capacity of the database and CPU, it will only become slower;
5. ❌ It will be faster if you add cache: low hit rate, serialization overhead, and cache penetration will all come back;
6. ❌ HTTP/2 is definitely faster than HTTP/1.1: There is not much difference in single connection and small concurrency scenarios. TCP will still block when packets are lost in a weak network;
7. ❌ Stateless does not require sessions: login state, idempotent keys, and current limit counting still require shared storage;
8. ❌ Monitoring only looks at the CPU: connection pools, queues, GC, and downstream delays are the earlier fault signals.

## 12. Summary
- A request passes through four layers: access, application, storage, and asynchronous. Each layer has independent capacity and failure mode;
- stable backend = **explicit timeout budget + bounded queue + idempotent + observable**;
- The optimization sequence is always "measure first, then move the database, and finally add the machine";
- records every fault into a comparison table and alarm, so that the system will run more steadily.
