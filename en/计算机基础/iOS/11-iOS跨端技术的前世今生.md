---
title: "IOS cross-terminal technology past and present"
lang: en
translatedFrom: 323f4ed2053bd884cabe15104b26111be634f0200ff97a4d34f0b05e6294b5a2
translatedAt: 2026-11-21
---

# IOS cross-terminal technology past and present
> In one sentence: **iOS cross-terminal history is essentially a history of repeated trade-offs between "dynamism, native experience, and a set of codes"**; each generation of solutions solves the bottlenecks of the previous generation, while also inheriting new costs.
> Note: This article talks about the progress and architecture generations. The engineering details of WebView and Flutter can be found in the following two articles respectively.

## 1. First define: what is "cross-terminal"
Cross-terminal is not just "one set of code running on multiple terminals", it includes at least three layers of reuse:
1. **Code reuse**: Only write one copy of business logic, UI, and resources;
2. **capability reuse**: a set of plug-ins/containers that simultaneously connect to the native capabilities of iOS and Android;
3. **team reuses**: one front-end or client team delivers multiple terminals at the same time, reducing collaboration costs.

Divided by "where the runtime is", there are only five technical routes for cross-end iOS:
| route | runtime | represents | What is the multiplexed |
|---|---|---|---|
| WebView container | Browser kernel | Cordova, Ionic, H5, applet | Page and business logic |
| bridges native controls | JS engine + native View | React Native, Weex | logic + partial UI |
| Self-drawn engine | Built-in rendering engine | Flutter | Logic + All UI |
| Compile to native | Native runtime | Kotlin Multiplatform, Xamarin/MAUI | Business logic (or all) |
| Mini program container | Dual thread + WebView | WeChat/Alipay mini program | Page + Capability API |

All the frameworks following > can be put into these five categories. If you understand "who owns the runtime", you will understand its performance upper limit and pitfalls.

## 2. Timeline: four stages
### Phase 1: The battle between Web App and native (2007–2011)
- When the iPhone was released in 2007, Jobs initially advocated that **use Safari + Web App to replace the native installation package** on the grounds that it was cross-platform and could be updated instantly;
- In 2008, the App Store was launched, the native SDK was opened, Objective-C + UIKit became the de facto standard, and Web Apps were quickly marginalized due to limited performance and capabilities;
- In 2009, **PhoneGap** (later donated to Apache to become **Cordova**) and **Titanium** appeared, using HTML/JS shells to call native capabilities, and the first generation Hybrid was born;
- Consensus at this stage: The advantage of **Web is dynamic release, and the disadvantage is experience**.

### Phase 2: The Golden Age of Hybrid (2011–2014)
- HTML5 boom, jQuery Mobile, Sencha Touch, Ionic (2013) and other frameworks emerged;
- There is only **UIWebView** on the iOS side: single process, Nitro JS engine, you can directly get `JSContext`, but the memory and scrolling performance are poor, and long JS tasks will jam the entire App;
- In 2012, Facebook publicly admitted **"Our biggest mistake was betting on HTML5"**, and the performance ceiling of Hybrid was put on the table;
- iOS 8 launched in 2014 **WKWebView**: independent process, Nitro, JIT, Hybrid performance and stability are greatly improved, UIWebView gradually exits history (iOS 12 marks obsolete, and will no longer be accepted by the App Store in 2020);
- During the same period, **React** (2013) brought declarative UI and virtual DOM, paving the way for the next generation solution.

### Phase 3: Bridging native and self-drawn engines (2015–2020)
- 2015 **React Native** Open source: JS writing business, rendering and mapping to real native controls, asynchronous communication through Bridge. It proves that "writing native apps with JS" is feasible, and also makes "big front-end" an independent type of work;
- In 2016, Alibaba **Weex**, Microsoft **Xamarin** (C#), NativeScript, etc. followed up, and the routes diverged;
- **Flutter** released alpha in 2017, 1.0 in 2018: no bridging, directly **comes with Skia Rendering engine**, Dart AOT compilation, bypassing native controls and JS bridge;
- In 2018, the RN team announced **New Architecture** (JSI/Fabric/TurboModules), with the goal of dismantling Bridge;
- **SwiftUI** was released in 2019. Apple responded to Flutter’s writing style impact with declarative UI (but still limited to single-ended).

### Phase 4: De-bridging, compile-time reuse and containerization (2021–present)
- Flutter 2 supports the official Web/desktop version in 2021; Jetpack Compose is released, and declarative UI becomes the consensus of both ends;
- In 2023, Flutter **Impeller turns on** by default on iOS, using precompiled Shader to solve the old problem in the Skia era "first animation lag";
- In 2023, **Kotlin Multiplatform (KMP)** is stable, and the idea turns to "sharing business logic and writing UI separately" without making a new runtime;
- 2024 RN **0.76 enables the new architecture** by default, JSI direct connection, Fabric renderer are implemented, and Bridge is officially relegated to the compatibility layer;
- 2025 **Compose Multiplatform for iOS** stable, byte-sized **Lynx** open source (dual thread + native rendering), cross-terminal to enter "multi-line coexistence" instead of "one size fits all";
Since its launch on WeChat in 2017, the - mini program container has become the de facto standard cross-terminal form of domestic super apps.

> Timeline quick check:
> `Web 套壳(2009) → Hybrid(2011) → WKWebView(2014) → RN(2015) → Flutter(2018) → 新架构(2024) → KMP/Compose/Lynx(2023–2025)`

The essential differences between the third and fourth generation architectures of ## 
### 1. First generation: WebView container
```
HTML/JS/CSS → WKWebView（浏览器内核）→ 页面渲染 → JSBridge → 原生能力
```
- **Advantages**: dynamic delivery, hot update compliance, direct reuse of front-end ecology;
- **Disadvantages**: Rendering and gestures are constrained by the browser, complex animations, long lists, and camera real-time processing are difficult; capabilities are all exposed by Bridge;
- **is suitable for**: "content-heavy, interaction-light" scenarios such as operational activities, content pages, forms, help centers, and payment checkout counters.
The > applet is the evolutionary form of this generation: "page + capability API + audit release" is made into a platform-level container (see WebView for details).

### 2. Second generation: bridge native control (RN/Weex)
```
JS 线程（业务）──Bridge（异步 JSON）──> 原生线程（UIKit / Android View）
```
- **Advantages**: The rendering result is a true native control, with natural and consistent scrolling, input, and accessibility; the front-end team can reuse it;
- **Disadvantages**: Bridge is a serial asynchronous queue, and high-frequency communication (scrolling, gestures, animation) is easy to drop frames; cross-version control differences must be smoothed out by yourself;
- **evolves into**: JSI allows JS to directly hold C++ HostObject, Fabric changes rendering to C++ synchronization tree, and TurboModules lazily loads native modules. Essentially, **bridges**.

### 3. Third generation: self-drawing engine (Flutter)
```
Dart（AOT）→ Framework → Engine（C++）→ Impeller/Skia → Metal → GPU
```
- **Advantages**: Does not rely on platform controls, pixel levels are consistent at both ends; no bridging, animation and scrolling performance are close to native; hot reload development efficiency is high;
- **Disadvantages**: The built-in engine causes the package body to increase; new platform features must wait for adaptation; system-level controls (camera, map, input method) still require PlatformView / Channel;
- **Essence**: **changes the "cross-terminal" problem from "control mapping" to "rendering self-sustainment"**.

### 4. Fourth generation: compile-time reuse (KMP/MAUI)
```
共享 Kotlin/C# 业务层 → 编译成 iOS 原生二进制 → 原生 UI（SwiftUI / UIKit）
```
- **Advantages**: No additional runtime, no bridging, performance consistent with native; can be progressively connected to existing projects;
- **Disadvantages**: The UI still needs to be written by each end (KMP + Compose is working on this); the team must understand both Kotlin and Swift;
- **The essence of**: Do not pursue "a set of UI", only pursue a "set of logic", reduce the reuse rate from 90% to 60%, and gain certainty.

## 4. Why are there so many solutions: It is impossible to satisfy all three at the same time
| Target | WebView | RN | Flutter | KMP |
|---|---|---|---|---|
| dynamic release / hot update | ✅ The strongest | ⚠️ Restricted by review | ❌ Need to go to the store | ❌ Need to go to the store |
| Native experience | ❌ | ⚠️ Close to | ✅ Close to | ✅ Native |
| A set of codes | ✅ | ✅ | ✅ | ⚠️ Logic only |
| package cost | ✅ Minimum | ⚠️ Medium | ❌ Maximum | ✅ Small |
New capabilities of | platform | ⚠️ etc. Bridge | ⚠️ etc. Plugins | ⚠️ etc. Engine/plug-in | ✅ Directly available |

You can think of it as an "impossible triangle":
- If you want **to be dynamic**, you must accept the experience limit of WebView;
- If you want the native experience of **+ a set of UI**, you have to use a self-drawing engine and pay the cost of inclusion and adaptation;
If - wants **to have zero extra runtime and**, it can only share logic and write its own UI.

> There is no optimal solution, only "what cost the current team and business are willing to pay."

## 5. Several turning points that really changed the landscape
1. **In 2012, Facebook abandoned HTML5**: it proved that the "WebView shell" could not carry complex interactions, which directly gave birth to RN;
2. **2014 WKWebView**: Multi-process + JIT, which makes Hybrid change from "usable" to "available", and also lays the foundation for today's small program containers;
3. **Flutter 1.0** in 2018: For the first time, it achieved "cross-end UI pixel level consistency" and pulled the competition dimension from "control mapping" to "rendering engine";
4. **2018 RN new architecture**: Acknowledge that Bridge is the bottleneck, use JSI/Fabric to change communication from asynchronous JSON to synchronous C++ calls;
5. **Impeller defaults to** in 2023: Solving Skia’s Shader compilation lag and making Flutter’s “first animation frame drop” history;
6. **2023–2025 KMP / Compose Multiplatform**: Cross-end switching from "runtime replacement" to "compile-time sharing" is no longer antagonistic to native;
7. **2025 Lynx**: Making "dual-threading + native rendering" a new paradigm shows that the web technology stack is still evolving, rather than being eliminated.

## 6. Today’s landscape (2026)
| Solution | Typical users | Most suitable for | Main risks |
|---|---|---|---|
| WebView / H5 | Operation, content, e-commerce activity page | Fast online, dynamic configuration | Experience limit, Bridge security |
| Mini program container | WeChat, Alipay, Douyin ecology | Customer acquisition and light application within the platform | Subject to platform rules |
| React Native | Large front-end team, stock App | Native experience + JS reuse | New architecture migration, native dependency fragmentation |
| Flutter | Multi-terminal consistent, complex UI product | One set of UI delivered to multiple terminals | Package and platform adaptation lag |
| KMP | Already have a dual-end native team | Shared business logic | Learning cost, UI still double written |
| MAUI / Xamarin | .NET technology stack team | Internal application of the enterprise | Ecology and narrow recruitment |

There is also a special reality in China: **super App embedded H5 / small program** is often more important than independent App, which makes the WebView route always have an irreplaceable position in the "distribution" dimension.

## 7. Selection principles that can be learned from history
1. **Let’s first look at the interaction complexity**: mainly content display and forms → WebView; mainly animation, gestures, and long lists → self-drawn or native;
2. **Another look at the release rhythm**: Need to bypass review for dynamic operations → WebView/mini program capabilities must be retained, even if the main framework is Flutter;
3. **Another look at the team structure**: Front-end-based → RN/WebView; Dart can be invested → Flutter; already dual-end native → KMP;
4. **Finally look at the life cycle**: One-time activity pages are not worth introducing heavy frameworks; only long-term products are worth bearing the engine and migration costs;
5. **No all-in Single technology**: Mature products are almost all a mixture of "native shell + Flutter/RN page + WebView activity page".

## 8. Trend judgment
1. **bridge continues to disappear**: JSI, FFI, Pigeon, static interop, cross-language calls are getting closer to ordinary function calls;
2. **Rendering rights continue to be delegated to**: Impeller, Lynx’s native rendering, Compose’s Skia backend, everyone is competing for “how to draw one frame”;
3. **The reuse granularity has been moved up to**: from "reuse page" to "reuse logic", KMP and Swift Package allow shared code to no longer be bound to the UI framework;
4. **AI Change the cost structure**: Code generation reduces the labor cost of "writing once for each terminal", and the value of the cross-terminal framework will shift from "labor saving" to "consistency, dynamics, and controllability";
5. **WebView will not disappear**: As long as there are operations, content, and third-party pages, the browser kernel is the most flexible runtime.

## 9. Common misunderstandings
1. ❌ Cross-end = 100% one set of code: Mature projects usually reuse 60%~90%, and platform differences, native capabilities, and performance hot spots still need to be dealt with separately;
2. ❌ Cross-end = poor performance: Flutter’s self-drawing and RN’s new architecture are both close to native, but the difference lies in “specific scenarios” rather than the overall performance;
3. ❌ WebView is outdated: small programs, activity pages, rich text, and payment checkout still rely heavily on it;
4. ❌ Flutter does not need to be native at all: camera, map, Bluetooth, push, and health data still require plug-ins or PlatformView;
5. ❌ KMP will replace Flutter: the two do not solve the same layer of problems, KMP shares logic, Flutter shares UI, and can coexist;
6. ❌ The new framework must be better: New architecture means new pitfalls, and the cost of migrating existing teams is often higher than the benefits.

## 10. Summary
- cross-terminal technology history = **WebView → bridge native → self-drawing engine → compile-time reuse The continuous evolution of**;
Every time - makes progress, the "runtime overhead" or "mapping loss" is pushed down one level;
- When choosing a plan, first answer three questions: **How complex is the interaction, how frequent is the release, and what** will the team do;
There are almost no pure solutions for - project implementation. **hybrid architecture** is the norm.
