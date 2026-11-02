# iOS 跨端
## 一、iOS 开发路线总览
iOS 开发一般有 4 种主流方案，选型对比：
1. **原生开发（Swift / Objective‑C + UIKit / SwiftUI）**
    - 优点：性能上限最高、完整调用苹果系统能力、官方长期维护、App Store 适配最稳；
    - 缺点：只能跑 iOS，Android 需要单独开发，迭代成本高。
2. **WebView 混合（H5）**
    - 优点：一套代码多端；缺点：性能差、动画卡顿、原生能力调用麻烦、体验割裂。
3. **React Native**
    - JS 桥接系统原生控件；依赖平台 View，版本差异容易出现样式不一致，JS 层通信开销大。
4. **Flutter（本次重点）**
    - Dart 语言 + 自研渲染引擎，**不依赖 iOS UIKit 控件**，自己绘制每一个像素；一份代码同时交付 iOS、Android、Web、桌面端；性能接近原生，是现在跨平台方案里的首选。

> 总结：
> - 新项目、多端同步上线、UI 复杂动画多 → **优先 Flutter**；
> - 存量 iOS 原生 App、只做少量页面迭代、重度依赖苹果独有硬件 API → 原生或 Flutter 混编（Add-to-App）。

## 二、Flutter 核心特点
1. **自绘 UI，不依赖平台控件**
Flutter 不使用 iOS 的 UIView / Android View，自带一套控件库（Material 安卓风格、Cupertino iOS 风格），直接在画布上绘制；**同一套代码在 iOS、Android 渲染结果高度一致**，不会出现 RN 那种两端样式差异问题。
2. **Dart 双编译模式（JIT + AOT）**
    - Debug：JIT（即时编译），支持**热重载 Hot Reload**，改代码秒刷新、保留页面状态，开发效率极高；
    - Release：AOT（提前编译），Dart 直接编译为 ARM 原生机器码，打包进 iOS ipa，没有 JS 桥，启动速度、运行性能接近 Swift 原生。
3. **一套代码多端复用**
iOS / Android / Web / macOS / Windows / Linux 共用业务代码，UI 只需要少量适配平台差异；业务层、状态管理、网络、工具类可以完全共享。
4. **高性能渲染管线（iOS 默认 Impeller）**
早期 Flutter 使用 Skia，新版本 iOS 上默认 **Impeller 渲染器**，Shader 在编译期预编译，解决 Skia 经典的 shader 卡顿（jank），Metal 底层对接 GPU，动画流畅度高。
5. **声明式 UI + 三棵树架构**
一切皆 Widget，声明式写法；内部维护 Widget / Element / RenderObject 三棵树，只做局部更新，减少不必要重绘。
6. **原生能力互通：Platform Channel**
Dart 不能直接调用 iOS 底层 API（蓝牙、相机、推送、HealthKit 等），通过 **MethodChannel / BasicMessageChannel / EventChannel** 和 Swift/OC 双向通信；也可以用 PlatformView 在 Flutter 里嵌入原生 UIView（地图、播放器等）。
7. **完整生态、插件丰富**
pub.dev 有大量成熟插件，相机、定位、支付、推送、蓝牙都有现成封装；同时支持自定义原生插件。

> 缺点：
> - App 包体积比原生大（自带引擎）；
> - 苹果新特性、新控件，需要等 Flutter 官方适配；
> - 重度依赖 iOS 独有系统能力的场景，需要写大量原生插件。

## 三、Flutter 使用方法（iOS 场景）
### 3.1 开发环境准备（Mac）
1. 安装 Flutter SDK，配置环境变量；
2. 安装 Xcode（iOS 编译、模拟器、证书签名）；
3. 安装 VSCode / Android Studio + Flutter 插件；
4. 依赖管理：Dart pub，类似 iOS CocoaPods。

### 3.2 两种开发模式（iOS 项目）
#### 模式A：全新 Flutter App（独立项目，最常用）
```bash
# 创建项目
flutter create my_flutter_ios
cd my_flutter_ios
# 模拟器调试
flutter run
# 打包 iOS 发布包（直接生成 ipa，用于 App Store）
flutter build ipa
```
目录结构：
```
my_flutter_ios
├── lib/          # Dart 业务代码（核心）
│   └── main.dart # 入口
├── ios/          # Runner iOS 原生壳工程（Xcode 项目）
├── android/
├── pubspec.yaml  # 依赖、资源、版本配置
```
`ios/Runner` 是一个标准 iOS 项目，里面嵌入 Flutter 引擎；打包时 Dart AOT 编译成库，打包进 ipa。

#### 模式B：Add-to-App，嵌入现有 iOS 原生项目（存量项目）
适合已经有 Swift/OC iOS App，只把部分页面改成 Flutter，而不是全量迁移：
1. 创建 Flutter Module：`flutter create --template=module flutter_module`
2. 在原有 iOS Xcode 工程通过 Swift Package Manager（新版推荐）或者 CocoaPods 引入 Flutter 模块；
3. Swift 代码中启动 `FlutterEngine`，用 `FlutterViewController` 作为页面 push / present 到原生导航栈；
4. 引擎可以预热、复用，减少打开 Flutter 页面白屏时间；
5. 通过 MethodChannel 实现 Swift ↔ Dart 双向通信。

示例 Swift 极简调用：
```swift
let engine = FlutterEngine(name: "myEngine")
engine.run()
let flutterVC = FlutterViewController(engine: engine, nibName: nil, bundle: nil)
navigationController?.pushViewController(flutterVC, animated: true)
```

### 3.3 基础开发流程
1. 写 Widget：声明式组合 UI，`StatelessWidget`（无状态）、`StatefulWidget`（有状态）；
2. 状态管理：Provider、Riverpod、Bloc、GetX 等；
3. 网络、本地存储、路由；
4. 需要原生能力时：编写 Platform Channel 或者引入第三方插件；
5. iOS 专属适配：Cupertino 控件、iOS 权限、Info.plist、推送、证书、打包；
6. 调试：热重载、DevTools、Flutter Inspector；
7. 发布：`flutter build ipa`，然后 Xcode 上传 App Store Connect。

### 3.4 iOS 平台交互
- MethodChannel：Dart 调用 Swift 方法、传参、拿返回值（同步请求）；
- EventChannel：原生主动持续向 Dart 推送数据流（传感器、蓝牙状态）；
- PlatformView：Flutter 中嵌入原生 UIView（iOS 地图、AVPlayer 播放器）；
- 插件开发：封装 iOS 原生能力，发布到 pub 复用。

## 四、Flutter 技术原理（分层架构 + 渲染核心）


Flutter 整体分为三层：**Framework（Dart）、Engine（C++）、Embedder（平台嵌入层）**
### 1. Embedder 平台嵌入层（iOS 侧）
就是 iOS 的 Runner 壳，基于 UIKit：
- 负责创建 FlutterEngine、FlutterViewController；
- 把 iOS 的触摸、屏幕、生命周期、输入事件转发给 Flutter 引擎；
- 管理渲染 Surface（Metal 画布）；
- 打包、签名、和 iOS 系统交互。
> Flutter 对于 iOS 来说，本质上是一个 UIViewController，里面承载 Flutter 自己绘制的画面。

### 2. Engine 引擎层（C++，核心）
包含三大模块：
1. **Dart VM**：执行 Dart 代码，Debug JIT、Release AOT；
2. **渲染模块（Impeller / Skia）**：2D 渲染引擎，对接 Metal（iOS）、Vulkan；接收 Dart 层绘制指令，生成 GPU 指令、光栅化；
3. **平台通道、文本排版、输入、动画调度**：`dart:ui` 是引擎暴露给 Dart Framework 的底层 API。

> 重点：**渲染不经过 iOS UIKit 组件树**，Flutter 自己在一块独立画布上绘制像素，这是和 RN 最大区别。

### 3. Framework 框架层（Dart，开发者写的这一层）
从上到下：Cupertino（iOS 风格控件）、Material、Widgets、Rendering、Animation/Gesture、Foundation。
最核心：**三棵树机制**
1. **Widget 树（不可变，描述）**
Widget 是配置描述，只读，build 函数只描述UI长什么样；状态变化时会重建 Widget；
`StatelessWidget` / `StatefulWidget` 都属于 Widget。
2. **Element 树（可变，实例、位置代理）**
Element 是 Widget 在树上的实例，持有位置、状态；框架做 Diff 对比，判断 Widget 是否变化，决定是否更新；Element 是连接 Widget 和 RenderObject 的桥梁。
3. **RenderObject 树（负责布局、绘制）**
真正做布局（layout）、绘制（paint）、层合成；保存尺寸、位置、绘制命令；是最重的对象，尽量少重建。

> 更新流程：状态改变 → 重建 Widget → Element 对比 diff → 只更新变化节点 → RenderObject 重新布局绘制 → 引擎提交画布给 GPU。

### 4. 完整渲染流水线（一次帧）
用户输入 / 动画驱动 → Build（构建Widget）→ Layout（布局约束、计算大小位置）→ Paint（生成绘制命令）→ Composite（图层合并）→ Impeller/Skia 光栅化 → Metal 提交 GPU 显示到屏幕

### 5. Dart AOT 在 iOS 的打包原理
Release 模式：
Dart 代码（业务+框架）提前编译为 ARM64 原生机器码，打包成 `libapp.so`；
这个 so 库被打进 iOS Runner 包；App 启动时，FlutterEngine 加载这个原生库，直接执行，**没有解释器、没有JS桥**，所以性能高。
Debug 模式保留 JIT，支持热重载。

## 五、Flutter iOS 开发的适用边界总结
✅ 适合：多端同步、表单、商城、社交、复杂动画、自定义UI、B端业务；
⚠️ 谨慎：重度依赖苹果独有硬件、ARKit、CallKit、HealthKit、高帧率视频编解码；这类场景推荐 Flutter + 原生混编。

