---
title: "IOS cross-terminal"
lang: en
translatedFrom: c5f5cb9c95f1859f3dc461b25f117e6ebb3c77fd5b308aa5bb7e9798d12f104a
translatedAt: 2026-11-02
---

# IOS cross-terminal
## 1. Overview of iOS development route
There are generally 4 mainstream solutions for iOS development. Selection comparison:
1. **Native development (Swift/Objective‑C + UIKit/SwiftUI)**
    - advantages: highest performance limit, complete access to Apple system capabilities, official long-term maintenance, and the most stable App Store adaptation;
    - Disadvantages: It can only run iOS, Android needs to be developed separately, and the iteration cost is high.
2. **WebView Mixed (H5)**
    - Advantages: A set of codes with multiple functions; Disadvantages: poor performance, animation lag, troublesome calling of native capabilities, and fragmented experience.
3. **React Native**
    - JS bridges the system's native controls; it relies on the platform View, and version differences are prone to style inconsistencies, and the JS layer communication overhead is high.
4. **Flutter (this time’s focus)**
    - Dart language + self-developed rendering engine, **does not rely on the iOS UIKit control**, and draws every pixel by itself; one code is delivered to iOS, Android, Web, and desktop at the same time; the performance is close to native, and it is the first choice among current cross-platform solutions.

> Summary:
> - New project, simultaneous launch of multiple terminals, many complex UI animations → **gives priority to Flutter**;
> - Existing iOS native App, only doing a few page iterations, heavily relying on Apple's unique hardware API → native or Flutter hybrid (Add-to-App).

## 2. Flutter core features
1. **self-drawn UI, does not rely on platform controls**
Flutter does not use iOS's UIView / Android View, but comes with a set of control libraries (Material Android style, Cupertino iOS style) that draw directly on the canvas; the same set of code **renders highly consistent results on iOS and Android**, and there will be no problem of style differences between the two ends like RN.
2. **Dart dual compilation mode (JIT + AOT)**
    - Debug: JIT (just in time compilation), supports **hot reload Hot Reload**, refreshes the code in seconds, retains the page status, and has extremely high development efficiency;
    - Release: AOT (ahead of time compilation), Dart is directly compiled into ARM native machine code and packaged into iOS ipa. There is no JS bridge, and the startup speed and running performance are close to Swift native.
3. **A set of code multiplexing**
iOS / Android / Web / macOS / Windows / Linux share business code, and the UI only needs to adapt to a few platform differences; the business layer, status management, network, and tool classes can be fully shared.
4. **High-performance rendering pipeline (iOS default Impeller)**
In the early days, Flutter used Skia. On the new version of iOS, the default **Impeller renderer is**. Shader is pre-compiled during compilation to solve Skia’s classic shader jank. The Metal bottom layer is connected to the GPU, and the animation is smooth.
5. **Declarative UI + Three Trees Architecture**
Everything is a Widget, written in a declarative way; three trees of Widget / Element / RenderObject are maintained internally, and only partial updates are done to reduce unnecessary redrawing.
6. **native capability interoperability: Platform Channel**
Dart cannot directly call iOS underlying APIs (Bluetooth, camera, push, HealthKit, etc.), and communicates with Swift/OC through **MethodChannel / BasicMessageChannel / EventChannel** in two-way communication; you can also use PlatformView to embed native UIView (map, player, etc.) in Flutter.
7. **Complete ecology, rich plug-ins**
pub.dev has a large number of mature plug-ins, including ready-made packages for cameras, positioning, payment, push, and Bluetooth; it also supports custom native plug-ins.

> Disadvantages:
> - The App package size is larger than the native one (comes with its own engine);
> - Apple’s new features and controls need to wait for Flutter’s official adaptation;
> - Scenarios that rely heavily on iOS's unique system capabilities require writing a large number of native plug-ins.

## 3. How to use Flutter (iOS scenario)
### 3.1 development environment preparation (Mac)
1. install Flutter SDK and configure environment variables;
2. installs Xcode (iOS compilation, simulator, certificate signing);
3. installs VSCode / Android Studio + Flutter plug-in;
4. Dependency management: Dart pub, similar to iOS CocoaPods.

### 3.2 Two development modes (iOS project)
#### Mode A: New Flutter App (independent project, most commonly used)
```bash
# 创建项目
flutter create my_flutter_ios
cd my_flutter_ios
# 模拟器调试
flutter run
# 打包 iOS 发布包（直接生成 ipa，用于 App Store）
flutter build ipa
```
 directory structure:
```
my_flutter_ios
├── lib/          # Dart 业务代码（核心）
│   └── main.dart # 入口
├── ios/          # Runner iOS 原生壳工程（Xcode 项目）
├── android/
├── pubspec.yaml  # 依赖、资源、版本配置
```
`ios/Runner` is a standard iOS project with the Flutter engine embedded in it; during packaging, Dart AOT is compiled into a library and packaged into ipa.

#### Mode B: Add-to-App, embedded in existing iOS native projects (stock projects)
Suitable for existing Swift/OC iOS App, only change some pages to Flutter instead of migrating the entire page:
1. Create Flutter Module: `flutter create --template=module flutter_module`
2. introduces the Flutter module into the original iOS Xcode project through Swift Package Manager (recommended for the new version) or CocoaPods;
3. Start `FlutterEngine` in Swift code, and use `FlutterViewController` as the page to push / present to the native navigation stack;
The 4. engine can be preheated and reused to reduce the white screen time when opening the Flutter page;
5. implements Swift ↔ Dart two-way communication through MethodChannel.

Example Swift minimalist call:
```swift
let engine = FlutterEngine(name: "myEngine")
engine.run()
let flutterVC = FlutterViewController(engine: engine, nibName: nil, bundle: nil)
navigationController?.pushViewController(flutterVC, animated: true)
```

### 3.3 basic development process
1. writes Widget: declarative combination UI, `StatelessWidget` (stateless), `StatefulWidget` (stateful);
2. status management: Provider, Riverpod, Bloc, GetX, etc.;
3. network, local storage, routing;
When 4. needs native capabilities: write Platform Channel or introduce third-party plug-ins;
5. iOS exclusive adaptation: Cupertino control, iOS permissions, Info.plist, push, certificate, packaging;
6. debugging: hot reload, DevTools, Flutter Inspector;
7. published: `flutter build ipa`, then Xcode uploaded to App Store Connect.

### 3.4 iOS platform interaction
- MethodChannel: Dart calls Swift methods, passes parameters, and gets return values (synchronous request);
- EventChannel: natively actively and continuously pushes data streams (sensors, Bluetooth status) to Dart;
- PlatformView: Embed native UIView (iOS map, AVPlayer player) in Flutter;
- plug-in development: encapsulate iOS native capabilities and publish to pub for reuse.

## 4. Flutter technical principles (layered architecture + rendering core)


Flutter is divided into three layers as a whole: **Framework (Dart), Engine (C++), Embedder (platform embedding layer)**
### 1. Embedder platform embedding layer (iOS side)
It is the iOS Runner shell, based on UIKit:
- is responsible for creating FlutterEngine and FlutterViewController;
- forwards iOS touch, screen, life cycle, and input events to the Flutter engine;
- manages rendering Surface (Metal canvas);
- packages, signs, and interacts with iOS system.
> Flutter for iOS is essentially a UIViewController, which carries the pictures drawn by Flutter itself.

### 2. Engine engine layer (C++, core)
Contains three major modules:
1. **Dart VM**: Execute Dart code, Debug JIT, Release AOT;
2. **rendering module (Impeller / Skia)**: 2D rendering engine, docking with Metal (iOS), Vulkan; receiving Dart layer drawing instructions, generating GPU instructions and rasterization;
3. **Platform channel, text typesetting, input, animation scheduling**: `dart:ui` is the underlying API exposed by the engine to the Dart Framework.

> Key points: **rendering does not go through the iOS UIKit component tree**. Flutter draws pixels on an independent canvas by itself. This is the biggest difference from RN.

### 3. Framework framework layer (Dart, this layer written by developers)
From top to bottom: Cupertino (iOS style control), Material, Widgets, Rendering, Animation/Gesture, Foundation.
The core: **three trees mechanism**
1. **Widget tree (immutable, description)**
Widget is a configuration description, read-only, and the build function only describes what the UI looks like; Widget will be rebuilt when the state changes;
`StatelessWidget` / `StatefulWidget` all belong to Widget.
2. **Element tree (mutable, instance, location agent)**
Element is an instance of Widget in the tree, holding position and status; the framework performs Diff comparison to determine whether the Widget has changed and decides whether to update it; Element is the bridge connecting Widget and RenderObject.
3. **RenderObject tree (responsible for layout and drawing)**
Really do layout, painting, and layer composition; save size, position, and drawing commands; they are the heaviest objects and should be reconstructed as little as possible.

> update process: status change → rebuild Widget → Element comparison diff → update only changed nodes → RenderObject re-layout drawing → engine submits the canvas to the GPU.

### 4. Complete rendering pipeline (one frame)
User input/animation driver → Build (build Widget) → Layout (layout constraints, calculate size and position) → Paint (generate drawing commands) → Composite (layer merging) → Impeller/Skia rasterization → Metal submit GPU display to screen

### 5. Dart AOT packaging principle on iOS
Release mode:
Dart code (business + framework) is compiled into ARM64 native machine code in advance and packaged into `libapp.so`;
This so library is included in the iOS Runner package; when the App starts, FlutterEngine loads this native library and executes it directly. **has no interpreter and no JS bridge**, so it has high performance.
Debug mode retains JIT and supports hot reloading.

## 5. Summary of applicable boundaries of Flutter iOS development
✅ Suitable for: multi-terminal synchronization, forms, shopping malls, social networking, complex animations, custom UI, B-side business;
⚠️ Caution: It relies heavily on Apple’s unique hardware, ARKit, CallKit, HealthKit, and high frame rate video codecs; Flutter + native hybrid is recommended for this type of scenario.
