---
title: "Flutter in-depth: engine, rendering and engineering"
lang: en
translatedFrom: 9bf0224f64dd5f7e16e9eba8baacd0b2d8bda26fe7ec10ddafc929e42442e131
translatedAt: 2026-11-21
---

# Flutter in-depth: engine, rendering and engineering
> In one sentence: **Flutter's speed comes from "Dart AOT + self-drawing engine + no bridge"; Flutter's card also comes from the same architecture - once any of the build, layout, and raster links exceed the budget, frames will drop.**
> Preface: basic concepts, directory structure, Add-to-App. For an introduction, see `08-iOS跨端基本要义.md`. This article only talks about the principles and engineering details.

## 1. Layered architecture: Who is drawing this frame
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
 For iOS, Flutter is essentially "a UIViewController that takes over the drawing of the screen": it only provides canvas, events and system capabilities natively, and the UI tree and pixels are all taken care of by the engine itself.

## 2. Threading model: What do the four threads do?
| thread | ownership | responsibility | What happens if | is stuck?
|---|---|---|---|
| **Platform** | iOS main thread | Native UI, life cycle, platform channel, input events | App overall stuck, Watchdog |
| **UI** | Dart main Isolate | Execute Dart code: build, layout, paint, generate Layer Tree | UI frame drop (animation does not move, click delay) |
| **Raster** | Engine | Rasterize the Layer Tree and submit it to the GPU | The screen drops frames but the logic is still running |
| **IO** | Engine | Image decoding, resource loading, fonts | Image loading is slow, the first screen is slow |

Key points:
The - **UI thread is not the iOS main thread**. Dart's `Future` / `Timer` all run on the event loop of the UI thread;
- A time-consuming `build` or synchronous calculation will block the UI thread **but will not directly block the native main thread**;
- Raster has independent threads, so the "UI thread card" and "GPU card" behave differently and must be positioned separately;
The handler of the - Platform channel returns to the Platform thread for execution by default. Time-consuming operations must be cut into the background queue by yourself.

### One frame pipeline
```
VSync → BeginFrame → Animate → Build → Layout → Paint
      → Compositing Bits → Semantics → Finalize Tree
      → Scene 提交 → Raster 线程光栅化 → Metal → 屏幕
```
- 60Hz budget is 16.6ms, 120Hz is only 8.3ms, **UI + Raster each have to be within the budget**;
- frame drops are divided into two categories:
  - **UI jank**: Build/Layout/Paint times out, and long bars appear on the UI track in Timeline;
  - **Raster jank**: Rasterization/GPU timeout, long bars on Raster track.

## 3. Dart runtime
### 1. Isolate and event loop
- Dart is a single-threaded event loop model: within an isolate, the microtask queue takes precedence over the event queue;
**does not share memory** between - Isolate, and can only send messages through `SendPort` (the object will be copied/serialized);
- Therefore, "Dart single thread" does not mean that it cannot be concurrent. CPU-intensive tasks should be placed in independent Isolate:
```dart
final result = await Isolate.run(() => heavyParse(jsonString));
// 或
final result = await compute(heavyParse, jsonString);
```
- `compute` will create a new Isolate every time, and frequent calls will have startup costs; long-term tasks use resident Isolate + `ReceivePort`.

### 2. JIT / AOT and products
| Mode | Compilation method | Purpose | Product |
|---|---|---|---|
| Debug | JIT + Kernel | Development, hot reload | `kernel_blob.bin` |
| Profile | AOT | Real machine performance analysis | `App.framework` |
| Release | AOT | Release | `App.framework` + `Flutter.framework` |

Under - iOS Release, Dart is compiled into ARM64 machine code, **has no interpreter and no JS bridge**;
- hot reloading relies on JIT and Kernel Service: replace the incremental kernel and rebuild the Widget tree; static fields will not be reinitialized, and modifications to `main`, generics, and const usually require hot restart;
- **Release package does not support hot update**. Dynamically issuing code violates App Store rules. Do not expect hot reloading to replace hot update.

### 3. Memory and GC
- Dart GC is divided into new generation (scavenger) and old generation (mark-sweep). There is no compression and long-term operation must prevent fragmentation;
The default upper limit of - image cache `ImageCache` is 1000 images/100MB. If it exceeds the limit, it will be eliminated by LRU;
Common leaks of - : `StreamSubscription` is not cancelled, `ChangeNotifier` is not removedListener, `AnimationController` is not disposed, `GlobalKey` is held for a long time.

## 4. Rendering: From Widget to Pixel
### 1. Division of labor at 3TREES
| tree | Whether it is variable | Responsibility |
|---|---|---|
| Widget | Immutable | Configuration description, product of build |
| Element | variable | instance and location, responsible for diff and life cycle |
| RenderObject | Variable | Layout, drawing, hit testing |

Update link: `setState` → Element diff → Rebuild Widget in the next frame → `updateChild` diff → Only update the changed RenderObject → layout/paint → New Layer Tree.

### 2. Layer and synthesis
The drawing results of - RenderObject enter `PictureLayer` / `TextureLayer` / `TransformLayer`, etc.;
The - engine hands the Layer Tree to the Raster thread and submits it to the GPU by layer;
- **RepaintBoundary** will draw the subtree to an independent Layer. Subtree redrawing will not affect the outside and is suitable for parts with frequent animations:
```dart
RepaintBoundary(
  child: AnimatedBuilder(
    animation: controller,
    builder: (_, __) => CustomPaint(painter: MyPainter(controller.value)),
  ),
)
```
- Don’t use RepaintBoundary everywhere: Each layer has composition and memory costs, and misuse will make it slower.

### 3. `saveLayer`: The most hidden performance killer
The following operations will cause the engine to open an off-screen buffer, draw the subtree to the texture first and then synthesize it:
- `Opacity` (value other than 0/1), `AnimatedOpacity`, `FadeTransition` intermediate states;
- `ClipPath` / `ClipRRect` and anti-aliasing is required;
- `BackdropFilter`, `ShaderMask`, `ColorFiltered`;
- Shadow, mask, partial blending modes.

Cost: extra textures + multiple reads and writes to video memory, low-end machines will directly drop frames. Optimization:
- static filleting can be done once with `ClipRRect`. Do not crop repeatedly in the animation;
- can use `Container(decoration: BoxDecoration(...))` to draw fillets/shadows, so don’t overlay `ClipRRect + Opacity`;
- fades in and out first, `FadeTransition` (with opacity layer inside), but avoids multi-layer nesting;
- It is time-consuming to use **Performance Overlay** in addition to the "Highlight oversized images" and "RenderFlex overflow" of DevTools.

### 4. Impeller: Why rewrite the rendering backend
An old problem in the Skia era: **Shader only compiles** at runtime, and it will get stuck (shader compilation jank) when a certain type of animation appears for the first time.
Impeller’s approach:
- pre-compiles all Shaders of** during the construction of **, and will no longer compile during runtime;
- uses **surface subdivision (tessellation)** to replace partial path rendering and reduce CPU-side path processing;
- directly faces Metal / Vulkan and controls the entire GPU pipeline;
- iOS is enabled by default starting from Flutter 3.10, with fallback for Skia comparison via `--no-enable-impeller`.

> Impeller solves the "first animation lag", **does not solve** build is too heavy, the picture is too large, PlatformView synthesis and other jank.

### 5. Text and pictures
- text is typeset by the engine, the font fallback chain is configured in `TextStyle.fontFamilyFallback`, and Chinese and English mixed typesetting must be explicitly specified;
- Large images must be decoded according to the display size:
```dart
Image.asset("bg.png", cacheWidth: 750); // 避免按原图 4000px 解码
```
- Use `precacheImage` to warm up the first screen of the list image; `ImageCache` checks whether the URL/key is stable when the hit rate is low.

## 5. Layout protocol: constraints downward, dimensions upward
### 1. Core rules
```
父 → 子：BoxConstraints（min/max width/height）
子 → 父：Size（子在自己的约束内决定大小）
父：根据 Size 决定子位置
```
- `tight` constraint (min == max) → sub-size is fixed;
- `loose` Constraint (min = 0) → sub can be less than the upper limit;
- `unbounded` (max = infinity) → The child cannot be a "as large as possible" component, otherwise an exception will be thrown.

### 2. Classic error reports and reasons
| Phenomenon | Cause | Solution |
|---|---|---|
| `RenderBox was not laid out` | Take the size if the subcomponent is not laid out | Check whether it is skipped by `Offstage`/conditional branch |
| `Vertical viewport was given unbounded height` | `ListView` Put `Column` without giving the height | `Expanded` / `SizedBox` / `shrinkWrap` |
| `BoxConstraints forces an infinite height` | Use `double.infinity` | in the unbounded direction to specify the size or `Flexible` |
| `RenderFlex overflowed` | Sub-content exceeds available space | `Expanded`, `Flexible`, newline |
| layout twice | uses `IntrinsicHeight/Width` | to avoid intrinsic, change to fixed ratio or `CustomLayout` |

### 3. Layout boundary and Sliver
- `RenderObject` can skip layout (relayout boundary) when the constraints remain unchanged;
- `ListView` / `CustomScrollView` uses **Sliver protocol**: `SliverConstraints` describes the remaining scrollable space, `SliverGeometry` returns the occupied and visible range;
The long list of - must be constructed lazily: `ListView.builder` / `SliverList.builder`, do not generate `children:` in one go;
- gives `itemExtent` / `prototypeItem` when the row height is fixed, and item-by-item measurement can be skipped, making scrolling more stable.

## 6. Element, Key and Status
### 1. Element life cycle
```
createElement → mount → (activate/deactivate)* → update → unmount
```
- `updateChild` first compare `Widget.canUpdate` (runtimeType + key), update if it can be reused, otherwise destroy and rebuild;
- `const` Widget is normalized at compile time, **identical judgment directly skips rebuilding**, which is the cheapest optimization;
- `GlobalKey` allows Element/State to "move" in the tree without losing the state, but is globally unique and will crash if repeated.

### 2. Correct usage of Key
- The order of list items will change and the status needs to be preserved → use `ValueKey(id)`;
- is only used for refresh (such as forced rebuild) → change key;
- Do not use random numbers as keys, they will be rebuilt every time you build;
- `GlobalKey` is only reserved for the scenario of "cross-tree access to State/preserved state migration" and should not be used as a normal key.

### 3. InheritedWidget and state management
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
- Provider is essentially `InheritedWidget` + `ChangeNotifier`;
- Riverpod uses `ProviderScope` to manage containers and life cycles, and does not rely on the `BuildContext` hierarchy;
- Bloc uses `Stream` + `BlocProvider` (also an InheritedWidget);
The selection of - depends on the team, not "who is more advanced"; the key is that the reconstruction range of **can be controlled by**.

> `MediaQuery.of(context)` will cause the component to be rebuilt when the keyboard is popped up and rotated; Flutter 3.10+ uses `MediaQuery.sizeOf` / `paddingOf` / `viewInsetsOf` to subscribe accurately.

## 7. Platform channel and native interoperability
### 1. Three Channels
| Channel | Direction | Scene |
|---|---|---|
| `MethodChannel` | Two-way request-response | Camera adjustment, payment, reading device information |
| `EventChannel` | native → Dart continuous flow | sensor, Bluetooth status, download progress |
| `BasicMessageChannel` | Two-way original message | Custom codec, Pigeon base |

Call chain:
```
Dart invokeMethod
  → BinaryMessenger（StandardMethodCodec 编码）
  → Platform 线程 handler
  → 原生执行
  → reply 回传 → Future 完成
```
 key points:
- **defaults to asynchronous**. Do not do heavy work in the main thread, otherwise the native UI will be stuck;
- parameters must be types supported by codec (null/bool/num/String/List/Map/Uint8List);
For - high-frequency calls, consider batching or switching to FFI;
- background Isolate channel adjustment requires `BackgroundIsolateBinaryMessenger.ensureInitialized(rootIsolateToken)`.

### 2. Pigeon: type safety
Handwritten string method names are prone to misspellings and mismatched parameter types. Pigeon uses Dart to define interfaces and generate Swift/Kotlin and Dart code. Mismatches can be found at compile time:
The bottom layer of ```dart
@HostApi()
abstract class UserApi {
  User? getUser(String id);
}
```
 is still `BasicMessageChannel`, but the handwriting glue and runtime type errors are omitted.

### 3. FFI: directly adjust C
```dart
final lib = DynamicLibrary.process(); // iOS 静态链接符号
final fn = lib.lookupFunction<Int32 Function(Int32), int Function(int)>("my_add");
```
- Suitable for reusing C/C++ libraries (sqlite, ffmpeg, encryption library), without serialization overhead;
- needs to manage its own memory and life cycle, and a crash will directly crash the process;
- On iOS, `DynamicLibrary.open("xxx.dylib")` cannot load unsigned dynamic libraries, usually static link + `process()` is used.

### 4. PlatformView (iOS)
```dart
UiKitView(
  viewType: "native-map",
  creationParams: {"style": "standard"},
  gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{},
)
```
iOS side implements `FlutterPlatformViewFactory` and returns the native `UIView`. The engine uses **to mix and synthesize**: superimpose the native View on the Flutter canvas, and then synchronize the position and cropping.
Pit:
- Rounded corners, transparency, and shadows often do not take effect on PlatformView and need to be handled by the native side;
- Gesture conflict: Native gestures and Flutter gesture arena need to be configured explicitly;
- Scroll nesting, keyboard blocking, and page transitions are easily misaligned;
- per PlatformView All have additional compositing overhead, and if used extensively in the list, frames will drop significantly.

### 5. Add-to-App and multi-engine
- stock App is gradually migrated: `FlutterEngine` + `FlutterViewController` is embedded in the navigation stack;
- **`FlutterEngineGroup`** allows multiple engines to share snapshot and isolate resources, significantly reducing memory;
The - engine can be preheated (`run()` when the App starts), making it faster to open the Flutter page for the first time;
- Note that the life cycle of `FlutterViewController` is coordinated with the native transition animation to avoid black/white screens.

## 8. Key points of iOS platform adaptation
| Theme | How to |
|---|---|
| Navigation and return gestures | `CupertinoPageRoute` comes with right swipe to return; use `PopScope` to intercept return (`WillPopScope` has been abandoned) |
| Safe Zone | `SafeArea`, `MediaQuery.paddingOf`; both bangs and Home Indicator should be considered |
| keyboard | `resizeToAvoidBottomInset`, `MediaQuery.viewInsetsOf`; form page anti-blocking |
| status bar | `AnnotatedRegion<SystemUiOverlayStyle>` or `SystemChrome.setSystemUIOverlayStyle` |
| Lifecycle | `AppLifecycleState.resumed/inactive/hidden/paused/detached` Mapping iOS Notification |
| 120Hz | Info.plist Add `CADisableMinimumFrameDurationOnPhone = true`, otherwise ProMotion may lock 60Hz |
| Permission copy | Camera, positioning, photo album, Bluetooth `Info.plist` Missing description will directly crash/reject review |
| Accessibility | Semantics tree mapping UIAccessibility; use `Semantics` / `MergeSemantics` / `ExcludeSemantics` |
| font scaling | Use `MediaQuery.textScalerOf` to avoid overwriting large fonts due to dead font size |
| dark mode | `ThemeMode.system` + `CupertinoThemeData`, the color is semantic color instead of hard coding |

## 9. Performance optimization: measure first, then do it
### 1. Measurement tools
```bash
flutter run --profile          # 真机 profile，不要用 debug 判断性能
flutter run --trace-startup    # 启动阶段 timeline
flutter build ipa --split-debug-info=build/symbols --obfuscate
```
- DevTools → Performance: View UI/Raster track and frame time;
- `WidgetsBinding.instance.addTimingsCallback`: Online collection `buildDuration` / `rasterDuration`;
- `debugRepaintRainbowEnabled`: Locate frequently redrawn areas.

### 2. High frequency optimization list
| Level | Method |
|---|---|
| Build | `const` Construct, split large Widgets, avoid calculation/IO in build, use `Selector` to reduce the scope of reconstruction |
| Layout | Avoid `IntrinsicHeight`, fix the list `itemExtent`, reduce nesting Flex |
| Paint | `RepaintBoundary` Isolate animation areas, avoid `saveLayer` combinations, use `BoxShadow` for shadows instead of multi-layer overlays |
| Raster | Decode images according to size, reduce `PlatformView`, avoid oversized `BackdropFilter` |
| Start | delayed initialization, engine warm-up, first screen skeleton, reduce first frame synchronization plug-in call |
| Memory | `dispose` Controller, `evict` Large Picture, `ListView` Don’t `keepAlive` All |

### 3. Typical jank attribution
1. first frame card: image decoding, font loading, plug-in synchronization initialization;
2. scrolling card: item construction is too heavy, image is not decoded according to size, `saveLayer`;
3. animation card: `setState` reconstructs the whole page per frame, unused `AnimatedBuilder` isolation;
4. transition card: PlatformView, complex shadow, page first frame synchronization request;
5. Occasional card: GC, log/buried point synchronous disk writing, and a large number of `setState` merges failed.

## 10. Testing and CI
| Level | Tool | Description |
|---|---|---|
| unit test | `flutter test` | pure Dart logic, the fastest |
| Widget test | `WidgetTester` | Verify UI and interaction without relying on real machine |
| Golden test | `matchesGoldenFile` | Pixel level regression, pay attention to the difference between fonts and platforms |
| Integration test | `integration_test` + `flutter test integration_test` | Real machine/simulator end-to-end |
| Stability | Patrol, etc. | System pop-ups, permissions, gestures |

CI key points:
```bash
flutter pub get
flutter analyze
flutter test
flutter build ipa --release --flavor prod \
  --dart-define=API_BASE=https://api.example.com \
  --export-method app-store
```
- Use `--dart-define` + `String.fromEnvironment` for environment configuration, do not submit the key;
- iOS signing certificate/description file or App Store Connect API Key;
- reserved dSYM With `--split-debug-info` product, crash restored with `flutter symbolize -i <stack> -d <symbols>`;
- Run the integration test of the core path before the grayscale release.

## 11. Common pitfalls
The component after 1. **`setState` has been destroyed**: `if (!mounted) return;` first in the asynchronous callback;
2. **`BuildContext` Use** across async: the context may be invalid after await, take `Navigator.of(context)` first and then await;
3. **`ListView` set `Column`**: Unbounded height directly reports an error, use `Expanded` or `shrinkWrap` (the latter has poor performance);
4. **`GlobalKey` Duplicate**: If the same key appears in two places, it will crash directly, especially after hot reloading;
5. **`MediaQuery.of` Full subscription**: The keyboard pops up causing the whole page to be rebuilt, use `sizeOf/viewInsetsOf` instead;
6. **hot reloading is not a panacea**: to change `main`, static fields, generics, and enumerations usually require hot restart;
7. **PlatformView rounded corners fail**: The native View is not cropped by Flutter and needs to be processed on the native side;
8. **120Hz is not effective**: Forgot `CADisableMinimumFrameDurationOnPhone`;
9. **Debug performance judgment**: Debug is JIT + assertion, and must be tested with `--profile` real machine;
10. **The package is out of control**: uncompressed pictures, uncropped icons, unopened `--split-debug-info`, first look at `flutter build ipa --analyze-size`.

## 12. Applicable Boundary
✅Suitable for:
- has high consistency requirements for multi-terminal UI (e-commerce, social networking, tools, B-terminal);
- complex custom UI, animation, charts;
The - team is willing to invest in Dart and engine tuning;
- existing apps can be gradually migrated using Add-to-App.

⚠️ Caution:
- relies heavily on iOS unique hardware/framework (ARKit, CallKit, HealthKit, real-time audio and video);
- is extremely sensitive to the package body (ultra-lightweight tool);
- needs to dynamically deliver code (Flutter does not support it, you need to use WebView/mini program);
- System-level control-intensive interface (map, camera, input method in-depth customization).

## 13. Common misunderstandings
1. ❌ Flutter does not need to be native: camera, map, push, and Bluetooth still require plug-ins/PlatformView;
2. ❌ Hot reloading is equal to hot update: Release cannot release Dart code, hot reloading is only a development period capability;
3. ❌ There will be no lags after using Impeller: it only eliminates shader compilation lags, build/layout/raster still needs to be optimized by itself;
4. ❌ Dart is single-threaded so it cannot be concurrent: Isolate can be parallel, but does not share memory;
5. ❌ Widget reconstruction = re-rendering: only the changed RenderObject is updated after Element diff, `const` can also be short-circuited directly;
6. ❌ RepaintBoundary The more the better: each layer has compositing and memory costs, and only isolates areas that are really frequently repainted;
7. ❌ The package body cannot be optimized: image compression, icon cropping, symbol stripping, and on-demand unpacking can all be significantly reduced;
8. ❌ PlatformView has no cost: hybrid synthesis, gesture conflicts, and cropping failures are all real costs.
