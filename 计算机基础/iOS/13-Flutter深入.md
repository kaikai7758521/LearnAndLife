# Flutter 深入：引擎、渲染与工程化
> 一句话：**Flutter 的快，来自「Dart AOT + 自绘引擎 + 无桥接」；Flutter 的卡，也来自同一套架构——一旦 build、layout、raster 任一环节超预算，就会掉帧。**
> 前置：基础概念、目录结构、Add-to-App 入门见 `08-iOS跨端基本要义.md`，本篇只讲原理与工程细节。

## 一、分层架构：谁在画这一帧
```
┌──────────────── Framework（Dart）────────────────┐
│ Material / Cupertino / Widgets / Rendering        │
│ Animation / Gesture / Painting / Semantics        │
└───────────────────────┬───────────────────────────┘
                        │ dart:ui
┌──────────────── Engine（C++）─────────────────────┐
│ Dart VM · Impeller/Skia · 文本排版 · 平台通道      │
└───────────────────────┬───────────────────────────┘
                        │ Metal / 平台消息
┌──────────────── Embedder（iOS Runner）────────────┐
│ FlutterEngine · FlutterViewController · 生命周期   │
│ 触摸/输入转发 · 渲染 Surface 管理 · 打包签名       │
└───────────────────────────────────────────────────┘
```
对 iOS 来说，Flutter 本质上是「一个接管了画面绘制的 UIViewController」：原生只提供画布、事件与系统能力，UI 树与像素都由引擎自己负责。

## 二、线程模型：四个线程各干什么
| 线程 | 归属 | 职责 | 卡了会怎样 |
|---|---|---|---|
| **Platform** | iOS 主线程 | 原生 UI、生命周期、平台通道、输入事件 | App 整体卡死、Watchdog |
| **UI** | Dart 主 Isolate | 执行 Dart 代码：build、layout、paint、生成 Layer Tree | UI 掉帧（动画不动、点击延迟） |
| **Raster** | 引擎 | 把 Layer Tree 光栅化、提交 GPU | 画面掉帧但逻辑仍在跑 |
| **IO** | 引擎 | 图片解码、资源加载、字体 | 图片加载慢，首屏变慢 |

关键点：
- **UI 线程不是 iOS 主线程**，Dart 的 `Future` / `Timer` 都跑在 UI 线程的 event loop 上；
- 一个耗时的 `build` 或同步计算，会阻塞 UI 线程，**但不会直接卡住原生主线程**；
- Raster 线程独立，所以「UI 线程卡」和「GPU 卡」表现不同，必须分开定位；
- Platform 通道的 handler 默认回到 Platform 线程执行，耗时操作要自己切后台队列。

### 一帧的流水线
```
VSync → BeginFrame → Animate → Build → Layout → Paint
      → Compositing Bits → Semantics → Finalize Tree
      → Scene 提交 → Raster 线程光栅化 → Metal → 屏幕
```
- 60Hz 预算 16.6ms，120Hz 只有 8.3ms，**UI + Raster 各自都要在预算内**；
- 掉帧分两类：
  - **UI jank**：Build/Layout/Paint 超时，Timeline 里 UI 轨道出现长条；
  - **Raster jank**：光栅化/GPU 超时，Raster 轨道出现长条。

## 三、Dart 运行时
### 1. Isolate 与事件循环
- Dart 是单线程事件循环模型：一个 Isolate 内，microtask 队列优先于 event 队列；
- Isolate 之间**不共享内存**，只能通过 `SendPort` 传消息（对象会被复制/序列化）；
- 所以「Dart 单线程」不等于不能并发，CPU 密集任务应放到独立 Isolate：
```dart
final result = await Isolate.run(() => heavyParse(jsonString));
// 或
final result = await compute(heavyParse, jsonString);
```
- `compute` 每次都会新建 Isolate，频繁调用有启动成本；长期任务用常驻 Isolate + `ReceivePort`。

### 2. JIT / AOT 与产物
| 模式 | 编译方式 | 用途 | 产物 |
|---|---|---|---|
| Debug | JIT + Kernel | 开发、热重载 | `kernel_blob.bin` |
| Profile | AOT | 真机性能分析 | `App.framework` |
| Release | AOT | 发布 | `App.framework` + `Flutter.framework` |

- iOS Release 下 Dart 被编译成 ARM64 机器码，**没有解释器、没有 JS 桥**；
- 热重载依赖 JIT 与 Kernel Service：替换增量 kernel，重建 Widget 树；静态字段不会重新初始化，`main`、泛型、const 的修改通常需要 hot restart；
- **Release 包不支持热更新**，动态下发代码违反 App Store 规则，不要指望热重载替代热更新。

### 3. 内存与 GC
- Dart GC 分新生代（scavenger）与老生代（mark-sweep），没有压缩，长期运行要防碎片；
- 图片缓存 `ImageCache` 默认上限 1000 张 / 100MB，超出按 LRU 淘汰；
- 常见泄漏：`StreamSubscription` 未 cancel、`ChangeNotifier` 未 removeListener、`AnimationController` 未 dispose、`GlobalKey` 长期持有。

## 四、渲染：从 Widget 到像素
### 1. 三棵树的分工
| 树 | 是否可变 | 职责 |
|---|---|---|
| Widget | 不可变 | 配置描述，build 的产物 |
| Element | 可变 | 实例与位置，负责 diff 与生命周期 |
| RenderObject | 可变 | 布局、绘制、命中测试 |

更新链路：`setState` → Element 标脏 → 下一帧重建 Widget → `updateChild` diff → 只更新变化的 RenderObject → layout/paint → 新 Layer Tree。

### 2. Layer 与合成
- RenderObject 的绘制结果进入 `PictureLayer` / `TextureLayer` / `TransformLayer` 等；
- 引擎把 Layer Tree 交给 Raster 线程，按层提交 GPU；
- **RepaintBoundary** 会把子树画到独立 Layer，子树重绘不影响外部，适合频繁动画的局部：
```dart
RepaintBoundary(
  child: AnimatedBuilder(
    animation: controller,
    builder: (_, __) => CustomPaint(painter: MyPainter(controller.value)),
  ),
)
```
- 不要到处套 RepaintBoundary：每层都有合成与显存成本，滥用反而更慢。

### 3. `saveLayer`：最隐蔽的性能杀手
以下操作会让引擎开辟离屏缓冲，把子树先画到纹理再合成：
- `Opacity`（值非 0/1）、`AnimatedOpacity`、`FadeTransition` 的中间态；
- `ClipPath` / `ClipRRect` 且需要抗锯齿时；
- `BackdropFilter`、`ShaderMask`、`ColorFiltered`；
- 阴影、遮罩、部分混合模式。

代价：额外纹理 + 多次读写显存，低端机直接掉帧。优化：
- 静态圆角用 `ClipRRect` 一次即可，不要在动画里反复裁剪；
- 能用 `Container(decoration: BoxDecoration(...))` 画圆角/阴影，就不要叠 `ClipRRect + Opacity`；
- 淡入淡出优先 `FadeTransition`（内部是 opacity layer），但避免多层嵌套；
- 用 DevTools 的「Highlight oversized images」「RenderFlex overflow」之外的 **Performance Overlay** 看 raster 耗时。

### 4. Impeller：为什么要重写渲染后端
Skia 时代的老问题：**Shader 在运行时才编译**，首次出现某类动画时会卡一下（shader compilation jank）。
Impeller 的做法：
- 在**构建期预编译**所有 Shader，运行时不再编译；
- 用**曲面细分（tessellation）** 代替部分路径渲染，减少 CPU 端路径处理；
- 直接面向 Metal / Vulkan，控制整条 GPU 管线；
- iOS 从 Flutter 3.10 起默认启用，可通过 `--no-enable-impeller` 回退 Skia 对比。

> Impeller 解决的是「首次动画卡顿」，**不解决** build 过重、图片过大、PlatformView 合成等其它 jank。

### 5. 文本与图片
- 文本由引擎排版，字体回退链在 `TextStyle.fontFamilyFallback` 配置，中英文混排要显式指定；
- 大图必须按显示尺寸解码：
```dart
Image.asset("bg.png", cacheWidth: 750); // 避免按原图 4000px 解码
```
- 列表图片用 `precacheImage` 预热首屏；`ImageCache` 命中率低时检查 URL/key 是否稳定。

## 五、布局协议：约束向下，尺寸向上
### 1. 核心规则
```
父 → 子：BoxConstraints（min/max width/height）
子 → 父：Size（子在自己的约束内决定大小）
父：根据 Size 决定子位置
```
- `tight` 约束（min == max）→ 子尺寸被固定；
- `loose` 约束（min = 0）→ 子可小于上限；
- `unbounded`（max = infinity）→ 子不能是「尽量大」的组件，否则抛异常。

### 2. 经典报错与原因
| 现象 | 原因 | 解决 |
|---|---|---|
| `RenderBox was not laid out` | 子组件没被布局就取 size | 检查是否被 `Offstage`/条件分支跳过 |
| `Vertical viewport was given unbounded height` | `ListView` 放进 `Column` 且没给高度 | `Expanded` / `SizedBox` / `shrinkWrap` |
| `BoxConstraints forces an infinite height` | 在无界方向用了 `double.infinity` | 给明确尺寸或 `Flexible` |
| `RenderFlex overflowed` | 子内容超出可用空间 | `Expanded`、`Flexible`、换行 |
| 布局两次 | 使用了 `IntrinsicHeight/Width` | 避免 intrinsic，改固定比例或 `CustomLayout` |

### 3. 布局边界与 Sliver
- `RenderObject` 在约束不变时可跳过 layout（relayout boundary）；
- `ListView` / `CustomScrollView` 使用 **Sliver 协议**：`SliverConstraints` 描述剩余可滚动空间，`SliverGeometry` 返回占用与可见范围；
- 长列表必须懒构建：`ListView.builder` / `SliverList.builder`，不要 `children:` 一次性生成；
- 固定行高时给 `itemExtent` / `prototypeItem`，可跳过逐项测量，滚动更稳。

## 六、Element、Key 与状态
### 1. Element 生命周期
```
createElement → mount → (activate/deactivate)* → update → unmount
```
- `updateChild` 先比较 `Widget.canUpdate`（runtimeType + key），能复用就更新，否则销毁重建；
- `const` Widget 在编译期规范化，**identical 判断直接跳过重建**，是最便宜的优化；
- `GlobalKey` 能让 Element/State 在树中「搬家」而不丢失状态，但全局唯一，重复即崩溃。

### 2. Key 的正确用法
- 列表项顺序会变、需要保留状态 → 用 `ValueKey(id)`；
- 仅用于刷新（如强制重建） → 改 key；
- 不要用随机数当 key，每次 build 都会重建；
- `GlobalKey` 只留给「跨树访问 State / 保持状态迁移」的场景，不要当普通 key 用。

### 3. InheritedWidget 与状态管理
```dart
class AppScope extends InheritedWidget {
  const AppScope({required this.user, required super.child});
  final User user;
  @override
  bool updateShouldNotify(AppScope old) => old.user != user;
}
// 读取：建立依赖，值变化时自动重建
final user = context.dependOnInheritedWidgetOfExactType<AppScope>()!.user;
```
- Provider 本质是 `InheritedWidget` + `ChangeNotifier`；
- Riverpod 用 `ProviderScope` 管理容器与生命周期，不依赖 `BuildContext` 层级；
- Bloc 用 `Stream` + `BlocProvider`（也是 InheritedWidget）；
- 选型看团队，不看「谁更先进」；关键是**重建范围可控**。

> `MediaQuery.of(context)` 会让组件在键盘弹出、旋转时重建；Flutter 3.10+ 用 `MediaQuery.sizeOf` / `paddingOf` / `viewInsetsOf` 精确订阅。

## 七、平台通道与原生互操作
### 1. 三种 Channel
| Channel | 方向 | 场景 |
|---|---|---|
| `MethodChannel` | 双向请求-响应 | 调相机、支付、读设备信息 |
| `EventChannel` | 原生 → Dart 持续流 | 传感器、蓝牙状态、下载进度 |
| `BasicMessageChannel` | 双向原始消息 | 自定义编解码、Pigeon 底座 |

调用链：
```
Dart invokeMethod
  → BinaryMessenger（StandardMethodCodec 编码）
  → Platform 线程 handler
  → 原生执行
  → reply 回传 → Future 完成
```
要点：
- **默认异步**，不要在主线程做重活，否则卡原生 UI；
- 参数必须是 codec 支持的类型（null/bool/num/String/List/Map/Uint8List）；
- 高频调用考虑批量或改用 FFI；
- 后台 Isolate 调 Channel 需要 `BackgroundIsolateBinaryMessenger.ensureInitialized(rootIsolateToken)`。

### 2. Pigeon：类型安全
手写字符串方法名容易拼错、参数类型对不上。Pigeon 用 Dart 定义接口，生成 Swift/Kotlin 与 Dart 代码，编译期就能发现不匹配：
```dart
@HostApi()
abstract class UserApi {
  User? getUser(String id);
}
```
底层仍是 `BasicMessageChannel`，但省掉了手写胶水与运行时类型错误。

### 3. FFI：直接调 C
```dart
final lib = DynamicLibrary.process(); // iOS 静态链接符号
final fn = lib.lookupFunction<Int32 Function(Int32), int Function(int)>("my_add");
```
- 适合复用 C/C++ 库（sqlite、ffmpeg、加密库），没有序列化开销；
- 需要自己管理内存与生命周期，崩溃会直接带崩进程；
- iOS 上不能 `DynamicLibrary.open("xxx.dylib")` 加载未签名动态库，通常用静态链接 + `process()`。

### 4. PlatformView（iOS）
```dart
UiKitView(
  viewType: "native-map",
  creationParams: {"style": "standard"},
  gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{},
)
```
iOS 侧实现 `FlutterPlatformViewFactory`，返回原生 `UIView`。引擎采用**混合合成**：把原生 View 叠加在 Flutter 画布上，再同步位置与裁剪。
坑：
- 圆角、透明度、阴影对 PlatformView 往往不生效，需要原生侧自己处理；
- 手势冲突：原生手势与 Flutter 手势竞技场要显式配置；
- 滚动嵌套、键盘遮挡、页面转场容易错位；
- 每个 PlatformView 都有额外合成开销，列表里大量使用会明显掉帧。

### 5. Add-to-App 与多引擎
- 存量 App 逐步迁移：`FlutterEngine` + `FlutterViewController` 嵌入导航栈；
- **`FlutterEngineGroup`** 让多个引擎共享快照与 Isolate 资源，显著降低内存；
- 引擎可预热（App 启动时 `run()`），首开 Flutter 页面更快；
- 注意 `FlutterViewController` 的生命周期与原生转场动画配合，避免黑屏/白屏。

## 八、iOS 平台适配要点
| 主题 | 做法 |
|---|---|
| 导航与返回手势 | `CupertinoPageRoute` 自带右滑返回；拦截返回用 `PopScope`（`WillPopScope` 已废弃） |
| 安全区 | `SafeArea`、`MediaQuery.paddingOf`；刘海与 Home Indicator 都要考虑 |
| 键盘 | `resizeToAvoidBottomInset`、`MediaQuery.viewInsetsOf`；表单页防遮挡 |
| 状态栏 | `AnnotatedRegion<SystemUiOverlayStyle>` 或 `SystemChrome.setSystemUIOverlayStyle` |
| 生命周期 | `AppLifecycleState.resumed/inactive/hidden/paused/detached` 映射 iOS 通知 |
| 120Hz | Info.plist 加 `CADisableMinimumFrameDurationOnPhone = true`，否则 ProMotion 可能锁 60Hz |
| 权限文案 | 相机、定位、相册、蓝牙的 `Info.plist` 描述缺失会直接崩溃/审核拒绝 |
| 无障碍 | Semantics 树映射 UIAccessibility；用 `Semantics` / `MergeSemantics` / `ExcludeSemantics` |
| 字体缩放 | 用 `MediaQuery.textScalerOf`，避免写死字号导致大字体下溢出 |
| 深色模式 | `ThemeMode.system` + `CupertinoThemeData`，颜色用语义色而非硬编码 |

## 九、性能优化：先测量，再动手
### 1. 测量工具
```bash
flutter run --profile          # 真机 profile，不要用 debug 判断性能
flutter run --trace-startup    # 启动阶段 timeline
flutter build ipa --split-debug-info=build/symbols --obfuscate
```
- DevTools → Performance：看 UI / Raster 轨道、帧耗时；
- `WidgetsBinding.instance.addTimingsCallback`：线上采集 `buildDuration` / `rasterDuration`；
- `debugRepaintRainbowEnabled`：定位频繁重绘区域。

### 2. 高频优化清单
| 层面 | 做法 |
|---|---|
| Build | `const` 构造、拆分大 Widget、避免在 build 里做计算/IO、用 `Selector` 缩小重建范围 |
| Layout | 避免 `IntrinsicHeight`、给列表固定 `itemExtent`、减少嵌套 Flex |
| Paint | `RepaintBoundary` 隔离动画区域、避免 `saveLayer` 组合、阴影用 `BoxShadow` 而非多层叠图 |
| Raster | 图片按尺寸解码、减少 `PlatformView`、避免超大 `BackdropFilter` |
| 启动 | 延迟初始化、引擎预热、首屏骨架、减少首帧同步插件调用 |
| 内存 | `dispose` 控制器、`evict` 大图、`ListView` 不要 `keepAlive` 全部 |

### 3. 典型 jank 归因
1. 首帧卡：图片解码、字体加载、插件同步初始化；
2. 滚动卡：item 构建过重、图片未按尺寸解码、`saveLayer`；
3. 动画卡：每帧 `setState` 重建整页、未用 `AnimatedBuilder` 隔离；
4. 转场卡：PlatformView、复杂阴影、页面首帧同步请求；
5. 偶发卡：GC、日志/埋点同步写盘、大量 `setState` 合并失败。

## 十、测试与 CI
| 层级 | 工具 | 说明 |
|---|---|---|
| 单元测试 | `flutter test` | 纯 Dart 逻辑，最快 |
| Widget 测试 | `WidgetTester` | 验证 UI 与交互，不依赖真机 |
| Golden 测试 | `matchesGoldenFile` | 像素级回归，注意字体与平台差异 |
| 集成测试 | `integration_test` + `flutter test integration_test` | 真机/模拟器端到端 |
| 稳定性 | Patrol 等 | 系统弹窗、权限、手势 |

CI 关键点：
```bash
flutter pub get
flutter analyze
flutter test
flutter build ipa --release --flavor prod \
  --dart-define=API_BASE=https://api.example.com \
  --export-method app-store
```
- 环境配置用 `--dart-define` + `String.fromEnvironment`，不要提交密钥；
- iOS 签名用证书/描述文件或 App Store Connect API Key；
- 保留 dSYM 与 `--split-debug-info` 产物，崩溃用 `flutter symbolize -i <stack> -d <symbols>` 还原；
- 灰度发布前跑一遍核心路径的集成测试。

## 十一、常见坑
1. **`setState` 后组件已销毁**：异步回调里先 `if (!mounted) return;`；
2. **`BuildContext` 跨 async 使用**：await 之后 context 可能失效，先取 `Navigator.of(context)` 再 await；
3. **`ListView` 套 `Column`**：无界高度直接报错，用 `Expanded` 或 `shrinkWrap`（后者性能差）；
4. **`GlobalKey` 重复**：同一 key 出现在两处会直接崩，热重载后尤其常见；
5. **`MediaQuery.of` 全量订阅**：键盘弹出导致整页重建，改用 `sizeOf/viewInsetsOf`；
6. **热重载不是万能的**：改 `main`、静态字段、泛型、枚举通常要 hot restart；
7. **PlatformView 圆角失效**：原生 View 不受 Flutter 裁剪，需原生侧处理；
8. **120Hz 没生效**：忘了 `CADisableMinimumFrameDurationOnPhone`；
9. **Debug 下性能判断**：Debug 是 JIT + 断言，必须用 `--profile` 真机测；
10. **包体失控**：未压缩图片、未裁剪图标、未开 `--split-debug-info`，先看 `flutter build ipa --analyze-size`。

## 十二、适用边界
✅ 适合：
- 多端 UI 一致性要求高（电商、社交、工具、B 端）；
- 复杂自定义 UI、动画、图表；
- 团队愿意投入 Dart 与引擎调优；
- 存量 App 用 Add-to-App 渐进迁移。

⚠️ 谨慎：
- 重度依赖 iOS 独有硬件/框架（ARKit、CallKit、HealthKit、实时音视频）；
- 对包体极敏感（超轻量工具）；
- 需要动态下发代码（Flutter 不支持，需走 WebView/小程序）；
- 系统级控件密集的界面（地图、相机、输入法深度定制）。

## 十三、常见误区
1. ❌ Flutter 不需要原生：相机、地图、推送、蓝牙仍要插件/PlatformView；
2. ❌ 热重载等于热更新：Release 不能下发 Dart 代码，热重载只是开发期能力；
3. ❌ 上了 Impeller 就不会卡：它只消除 shader 编译卡顿，build/layout/raster 仍要自己优化；
4. ❌ Dart 单线程所以不能并发：Isolate 可以并行，只是不共享内存；
5. ❌ Widget 重建 = 重新渲染：Element diff 后只更新变化的 RenderObject，`const` 还能直接短路；
6. ❌ RepaintBoundary 越多越好：每层都有合成与显存成本，只隔离真正频繁重绘的区域；
7. ❌ 包体无法优化：图片压缩、图标裁剪、符号剥离、按需拆包都能显著减小；
8. ❌ PlatformView 没有成本：混合合成、手势冲突、裁剪失效，都是实打实的代价。
