# iOS 渲染流程
> 核心一句话：**UIView 只是逻辑容器，真正的渲染载体是 CALayer；App 主线程只负责构建图层树，真正绘制合成由独立 Render Server 进程 + GPU 完成；Apple GPU 是基于瓦片的延迟渲染 TBDR**

## 一、基础原理
### 1. 核心模型：视图-图层模型
UIKit 的 `UIView` = 事件响应 + 布局逻辑；**每个 UIView 底层都绑定一个 CALayer**，图层才是渲染树节点，保存位置、大小、颜色、圆角、阴影、透明度、contents（位图纹理）等渲染属性。
- View 树：开发者日常操作的对象树，负责点击、手势、布局更新
- Layer 树（图层树）：Core Animation 的渲染树，是提交给渲染服务的数据结构
- Presentation 树：动画中间插值树，代表当前屏幕上**正在显示**的实时状态（动画过程中，layer.model 是目标值，presentation 是当前值）

> 重点区分：**隐式动画**：修改 CALayer 大部分属性，CoreAnimation 自动产生动画；UIView 默认关闭隐式动画。

### 2. Apple GPU 底层特性：TBDR（Tile-Based Deferred Renderer，瓦片式延迟渲染）
这是 iOS 所有渲染的硬件根基，和 PC GPU 流水线差异很大：
1. **分块（Tiling）阶段**：GPU 把屏幕拆成很多小瓦片（tile），先收集这个瓦片内所有图元，做可见性判断，把指令打包；
2. **渲染（Rendering）阶段**：逐个瓦片在高速片上 Tile Memory 做光栅化、着色、混合；
3. 瓦片完成后，才把结果写回主显存 Framebuffer。

优势：极大减少显存读写带宽，手机低功耗；代价：**离屏渲染开销会被放大**，因为需要额外开辟独立离屏缓冲区、多次读写显存。

### 3. VSync / 垂直同步 & 渲染环路（Render Loop）
屏幕按固定频率刷新（60/120Hz），VSync 信号是渲染节拍。一帧完整渲染分为三大阶段，跨进程：App 进程 → Render Server（独立系统进程） → GPU → 显示控制器
1. **App 阶段（主线程）**：事件、布局、绘制、图层提交 commit；
2. **Render Server 阶段**：解析图层树、编译成 GPU 指令包；
3. **GPU 执行阶段**：光栅化、着色、图层合成、输出帧缓存，下一次 VSync 送到屏幕。

> 卡顿本质：任意一个环节耗时超过 VSync 间隔（120Hz ≈ 8.3ms，60Hz ≈16.6ms），掉帧。

## 二、iOS 渲染技术栈 & 框架分层（从上到下）
| 框架 | 定位 | 用途 | 渲染方式 |
|---|---|---|---|
| UIKit / SwiftUI | 高层界面组件 | Button、Label、列表、页面布局 | 封装 CoreAnimation，自动构建 Layer 树 |
| Core Animation（QuartzCore） | 图层合成、动画引擎 | 图层管理、属性动画、图层合成、CAMetalLayer | 2D 图层合成，交给 GPU 加速 |
| Core Graphics（Quartz 2D） | 矢量绘制（CPU 绘制） | 路径、文字、渐变、PDF、截图、自定义绘制 drawRect | **CPU 光栅化，生成位图给 layer.contents** |
| Core Image | 图像滤镜处理 | 美颜、模糊、调色、图片后处理 | GPU 滤镜管线，基于 Metal |
| Metal | Apple 底层 GPU API | 3D、高性能 2D、视频渲染、自定义渲染管线、ARKit | 直接编码 GPU 指令，替代废弃 OpenGL ES |
| RealityKit | AR/3D 高层引擎 | AR、3D 模型渲染 | 基于 Metal，封装光照、材质、物理 |

关键认知：
- `drawRect:`：调用时走 CoreGraphics 在 CPU 绘制位图，**属于 CPU 绘制，非常重，尽量避免频繁调用**；
- 绝大多数普通 UI，不需要 drawRect，只需要设置 layer 属性，由 CoreAnimation 在 GPU 合成；
- Metal 是现代首选底层图形 API；OpenGL ES 在新系统已经不再推荐。

## 三、一帧完整渲染流程（标准 Render Loop）
按时间顺序，从用户触摸到屏幕刷新：
1. **事件响应（主线程 RunLoop）**：点击、手势、定时器触发 UI 变更；
2. **布局阶段（Layout）**
   - `layoutSubviews` / SwiftUI layout 计算 frame、约束；
   - 更新 view、layer 的 bounds、position；
3. **绘制阶段（Draw，可选）**
   - 如果重写 `drawRect:`，系统创建画布，调用 CG 接口在 CPU 绘制矢量内容，生成位图，赋值给 `layer.contents`；
   - 无 drawRect 的普通 View：没有这一步，layer 仅保存属性；
4. **提交 Commit（CATransaction）**
   - 所有 layer 修改会被 CATransaction 收集；runloop 结束自动 commit；
   - 把整个图层树序列化，**跨进程发送给 Render Server**；提交之后，App 主线程不再参与这一帧合成；
5. Render Server：准备阶段（Render Prepare）
   - 解析图层树，把图层属性、动画参数编译成 GPU 可执行的渲染指令；
   - 插值动画 presentation 值、标记哪些图层需要离屏渲染；
6. GPU 执行阶段（Render Execute）
   - 按**从后往前**的顺序渲染图层；
   - 光栅化、着色、裁剪、蒙版、混合；遇到需要离屏的效果，先绘制到 Offscreen Buffer；
   - 所有图层合成到最终 Framebuffer；
7. 显示：下一次 VSync 到来，帧缓存送到屏幕驱动，像素点亮。

> 两个容易混淆的点：
> - Commit 只是提交描述，**不是绘制**；绘制发生在 Render Server + GPU；
> - 主线程阻塞，只会影响【布局、绘制、提交】，不会阻塞 GPU 正在渲染的帧。

## 四、渲染过程中常见操作
### 1. 光栅化（Rasterization）
矢量图形（路径、文字、形状）转像素位图。
- CoreGraphics：CPU 光栅化；
- Metal / CoreAnimation：GPU 光栅化；
- `shouldRasterize = YES`：把这个 layer + 子图层合成一张位图缓存；适合静态复杂图层；**动态变化图层打开会频繁重绘，性能爆炸**。

### 2. 裁剪（Clipping / Mask）
- `masksToBounds`：基于 layer bounds 裁剪子图层；搭配 cornerRadius 是经典离屏触发条件；
- `mask`：自定义蒙版图层（CALayer 作为遮罩），强制离屏渲染；
- scissor 裁剪：GPU 视口裁剪，低成本，不会触发离屏。

### 3. 混合（Compositing / Blending）
半透明图层叠加：GPU 需要读取下层已经渲染好的像素，按 alpha 公式混合。
- 完全不透明图层（opaque = YES）：直接覆盖，不需要读下层，速度最快；
- 半透明、groupOpacity：需要混合；groupOpacity 会强制一组图层先离屏合成再统一透明。

### 4. 离屏渲染 Offscreen Render（重中之重）
定义：GPU 不能直接渲染到屏幕主帧缓存，必须先渲染到一块独立临时缓冲区（Offscreen Buffer），完成效果之后，再把结果拷贝回主帧缓存合成。
✅ 触发离屏渲染常见条件：
1. `cornerRadius + masksToBounds`（圆角裁剪）；
2. `layer.shadowColor / shadowOffset / shadowRadius`（阴影，除非指定 shadowPath 优化）；
3. `layer.mask` 蒙版；
4. `allowsGroupOpacity` 组透明；
5. `shouldRasterize = true`；
6. 自定义 CoreImage 链式滤镜；

⚠️ 代价：额外开辟 buffer、多次读写显存，TBDR 架构下开销显著；大量离屏会直接掉帧。
✅ 优化思路：预切圆角图、shadowPath、用 CAShapeLayer 代替 mask、减少叠加离屏层数。

### 5. 抗锯齿 Anti-Aliasing
CoreGraphics 绘制默认开启抗锯齿；Metal 可配置 MSAA 多重采样抗锯齿，MSAA 本身也会增加显存开销。

### 6. 纹理上传 & contents 渲染
`layer.contents` 设置图片（CGImage）：本质是把图片上传为 GPU 纹理；图片过大、尺寸不对（非 2 的幂、超过屏幕）会占用显存；图片解压缩在主线程是常见卡顿点。

### 7. 动画插值
CoreAnimation 动画在 Render Server 做插值计算，不需要主线程逐帧回调；这也是属性动画流畅的根本原因。

## 五、iOS 渲染常见应用场景
### 场景1：常规 App UI（列表、页面、按钮、图文）
- 方案：UIKit / SwiftUI + CoreAnimation；
- 渲染特点：尽量只用 layer 属性，避免 drawRect、避免叠加离屏；图片预解码；
- 性能目标：60/120Hz 稳定滚动，减少主线程布局、图片解码压力。

### 场景2：自定义矢量绘制（图表、手绘白板、PDF 预览）
- 方案：CoreGraphics（CPU）或者 Metal/CAShapeLayer（GPU）；
- CoreGraphics 适合静态、低频绘制；高频手绘、实时轨迹推荐 Metal。

### 场景3：图片滤镜、图像处理（相机、美颜、修图）
- 方案：CoreImage；底层跑 Metal 滤镜链；
- 适合：高斯模糊、调色、 lut 滤镜；复杂滤镜链会多次离屏。

### 场景4：短视频、直播、相机预览
- 方案：Metal + CAMetalLayer；接收 CMSampleBuffer，YUV 转 RGB、美颜、水印叠加、渲染输出；
- 典型：抖音、快手相机链路，不使用 CoreGraphics。

### 场景5：3D / AR 渲染（游戏、AR 测量、虚拟模型）
- 方案：Metal 自研管线，或者高层 RealityKit；老项目 SceneKit（已逐步废弃）；ARKit 提供相机帧、姿态信息交给渲染层。

### 场景6：截图、生成海报、导出图片
- 方案：
  - `UIGraphicsImageRenderer`（CoreGraphics）截图；
  - Metal 读取 renderPass 纹理导出；
  - 注意：普通截图操作会触发图层树的绘制与合成，是 CPU+GPU 双重开销。

### 场景7：高性能动画、粒子特效
- 简单：CoreAnimation CAKeyframeAnimation；
- 大量粒子、流体：Metal 计算着色器 + 渲染管线。

## 六、排查工具
1. Xcode Debug → Color Offscreen-Rendered Yellow：黄色标记离屏渲染图层；
2. Color Copied Images：标记图片拷贝；
3. Core Animation Instrument：查看 GPU 耗时、离屏次数、光栅化；
4. Metal Debugger：捕获 GPU 指令，看 render pass、纹理、瓦片渲染情况。

## 七、总结
1. UIView 不是渲染单元，CALayer 才是；
2. drawRect 是 CPU 绘制，能不用就不用；
3. 阴影、圆角裁剪、蒙版是离屏大户，优先优化；
4. Apple GPU 是瓦片延迟渲染，和 PC GPU 优化思路不一样；
5. 动画流畅的核心：把动画交给 Render Server，不要在主线程逐帧刷新布局；
6. 半透明图层多，混合开销上升；能 opaque 尽量 opaque。
