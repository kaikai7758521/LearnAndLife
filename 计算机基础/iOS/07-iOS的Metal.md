# iOS的Metal 
Metal 是 Apple 的**显式、低开销 GPU API**，替代老旧 OpenGL ES，统一图形渲染 + GPU 计算（图形管线、Compute、Blit 拷贝都在一套 API），配套 MSL（Metal Shading Language，类C++着色器语言）。
> 核心特点：**显式控制**，没有GL那种隐式状态机；CPU开销远低于GLES；Apple GPU 是 **TBDR（Tile-Based Deferred Renderer，瓦片延迟渲染）**，这是iOS性能优化一切的根基，和桌面GPU架构完全不一样。

TBDR 一句话理解：
1. **Tiling阶段**：先把视口切成很多小瓦片，遍历所有三角形，做顶点变换、裁剪，把三角形分到对应瓦片；
2. **Rendering阶段**：逐个瓦片，在**片上Tile Memory（极快、低带宽）**里做光栅化、深度测试、片段着色；
3. 瓦片算完，才把结果写回系统显存。
✅ 优势：大幅减少对系统内存带宽读写；
⚠️ 代价：**不要随便打断一个RenderPass**，不要频繁读写同一个纹理、不要跨瓦片大量读写，否则会强制把Tile Memory刷回内存，性能暴跌。

> 对比 OpenGL ES：GL是隐藏状态机，驱动内部做大量同步、缓存、状态校验；Metal 把决定权交给开发者，写不好反而更容易卡。

## 核心对象
1. **MTLDevice**：GPU抽象，一个设备，所有资源从它创建；`MTLCreateSystemDefaultDevice()`
2. **MTLCommandQueue**：命令队列，用来提交CommandBuffer；单队列串行，多队列可以并行提交不同类型工作（图形/计算/blit）
3. **MTLCommandBuffer**：一帧里打包给GPU的一批命令，**一次性提交**，不能中途修改；
4. **Encoder（编码器，3种）**：在CommandBuffer里面写入GPU指令
    - `MTLRenderCommandEncoder`：3D/2D光栅渲染（顶点+片段管线）
    - `MTLComputeCommandEncoder`：通用GPU计算（后处理、粒子、光照集群、物理）
    - `MTLBlitCommandEncoder`：资源拷贝、纹理生成mipmap、资源压缩、纹理格式转换
5. **MTLRenderPipelineState（RPS）**：渲染管线状态（顶点/片元shader、顶点格式、混合、光栅化、多重采样），**重量级对象，预编译，不要每帧新建**
6. **MTLBuffer**：显存缓冲区（顶点、索引、Uniform、实例数据）
7. **MTLTexture**：纹理、RT、深度缓冲
8. **MTLRenderPassDescriptor**：描述一次渲染Pass要输出到哪些纹理、深度模板、load/store动作（TBDR优化关键点）
9. **CAMetalLayer**：和UIView绑定，提供可绘制对象 `drawable`（最终屏幕输出）

**Metal 一帧标准流程**
```
1. 拿到CAMetalLayer的nextDrawable（屏幕后备缓冲）
2. 创建CommandBuffer
3. 创建RenderPassDescriptor，设置colorAttachment、depthAttachment
4. 创建RenderEncoder，设置管线、绑定buffer/texture、draw
5. endEncoding
6. （可选）compute / blit encoder
7. commandBuffer.present(drawable) → 显示同步
8. commandBuffer.commit() → 提交给GPU
9. 等待GPU完成（信号量控制最大飞行帧数）
```

---

# 二、常见渲染操作怎么写
## 1. 绘制静态网格（不透明物体，最常用）
要点：
- 顶点缓冲、索引缓冲**预创建、长期持有**，不要每帧alloc；
- 顶点shader输出位置，片元shader输出颜色；
- 不透明物体**先画**，开启深度测试，利用TBDR硬件HRS（隐藏面剔除），提前丢掉被遮挡像素，减少片元着色开销。
```swift
// 伪代码
let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: rpd)!
encoder.setRenderPipelineState(pipelineState)
encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
encoder.setFragmentTexture(baseColorTex, index: 0)
encoder.drawIndexedPrimitives(type: .triangle, indexCount: indexCount, indexType: .uint16, indexBuffer: indexBuffer, indexBufferOffset: 0)
encoder.endEncoding()
```

## 2. 实例化渲染 Instanced（大量重复物体：草、粒子、广告牌）
`drawIndexedPrimitives(instanceCount:)`，实例数据放另一个vertex buffer；
✅ 极大减少DrawCall，是iOS里性价比最高的优化之一；
⚠️ 实例数据尽量打包成一个buffer，不要多buffer切换。

## 3. 半透明物体（透明、粒子、UI）
- **关闭深度写入，保留深度测试**；
- 必须**从后往前排序**；
- 半透明不要放在同一个pass和不透明混排，会废掉HRS；
- 混合模式在PipelineState里配置，不要动态改混合。

## 4. 后处理（Bloom、SSR、TAA、调色）
两种写法：
- 方案A：RenderPass渲染到中间纹理，再一个全屏quad采样；
- 方案B：Compute Shader（更适合全屏后处理，带宽可控）
> TBDR忠告：后处理pass越多，越容易触发Tile flush；能合并的后处理尽量合并到同一个Compute或者同一个RenderPass。

## 5. 阴影贴图 ShadowMap
- 单独一个RenderPass：相机换成光源投影，渲染深度到depth纹理；
- 阴影纹理推荐**2D纹理，采样对比过滤**；
- 不要超大分辨率阴影，A系列GPU带宽敏感；
- 可以用`memoryless`深度，减少内存占用（如果只在本pass内使用）。

## 6. Blit 操作（拷贝、mipmap、纹理上传）
- 纹理从CPU内存上传：优先BlitEncoder，不要CPU直接写纹理；
- mipmap生成：`generateMipmaps`在blit encoder里做；
- 大资源拷贝不要分散多次blit，尽量合并。

## 7. 同步：CPU ↔ GPU
Metal默认**异步**：commit之后CPU继续跑，GPU后台执行。
最经典方案：**计数信号量 + 多帧缓冲轮换（3帧飞行是行业默认）**
```swift
// semaphore初始值 = maxFramesInFlight（一般3）
semaphore.wait()
commandBuffer.addCompletedHandler { _ in semaphore.signal() }
```
⚠️ 禁止：`commandBuffer.waitUntilCompleted()` 在渲染主线程调用，会直接锁死流水线、掉帧。

## 8. Argument Buffer / Bindless（Metal3+，高性能资源绑定）
传统：每drawcall setFragmentTexture、setBuffer，CPU开销高；
Bindless：把一堆texture/buffer索引打包进一个argument buffer，一次绑定；
适合材质很多、大量drawcall的场景，大幅降低CPU绑定开销；配合Heap管理资源，减少跟踪开销。

---

# 三、iOS TBDR 下，流畅度 & 渲染加速核心规则
> 所有优化分成3大类：**CPU侧开销、GPU带宽、GPU片元开销、Pass依赖**，iOS上**带宽通常是第一瓶颈**，不是单纯算力。

## ✅ 第一大类：适配TBDR，减少Tile内存刷新
1. **善用 RenderPassAttachment 的 loadAction / storeAction**
    - `loadAction: .clear`：本pass开始清空；
    - `loadAction: .dontCare`：不要读取上一帧结果（非常省带宽！）
    - `storeAction: .store`：需要把结果写到纹理给后面pass读；
    - `storeAction: .dontCare`：这个附件只在瓦片内使用，pass结束不用保存（**memoryless render target 就是这个思路，不占显存**）
    > 例子：深度缓冲如果只在本pass做遮挡、后面不再读取，storeAction = .dontCare，直接不写回内存，巨大节省带宽。
2. **尽量减少RenderPass数量，合并Pass**
    每新开一个RenderPass，TBDR都要刷Tile Memory；能合并到同一个pass的渲染，尽量合并；
    ❌ 反面教材：画物体→提交pass→画UI→提交pass→画特效→提交pass，多pass连环炸。
3. 同一个RenderPass内，**先全部不透明，再半透明**
    不透明开启深度写入，硬件HRS提前剔除遮挡像素，跳过昂贵片元shader；半透明关闭深度写入放后面。
4. 不要在同一个RenderPass里面，**随机读写同一个纹理**（比如片段shader里读写同一个RT）
    会强制瓦片序列化，TBDR优势直接消失。

## ✅ 第二大类：CPU侧优化（减少主线程耗时，避免CPU瓶颈）
1. **所有管线状态RPS、Sampler、Buffer、Texture全部预创建、缓存，不要每帧新建**
    PipelineState创建是很重的编译操作，绝对不要在render loop里面创建；
    SamplerState也缓存，不要每帧make。
2. **减少DrawCall数量**
    - 静态合批；
    - Instanced实例化；
    - 图集、纹理数组；
    - ArgumentBuffer / Bindless 减少绑定调用；
    - ParallelRenderCommandEncoder：多线程并行编码同一个RenderPass里的draw（适合场景很大、多线程Culling）
3. 编码逻辑放到后台线程，**主线程只负责present、commit、信号量**
    渲染循环：主线程等待drawable，worker线程编码commandBuffer；
    注意：CommandBuffer/Encoder不是线程安全，**一个encoder只能一个线程写**，ParallelRenderEncoder是专门给多线程分块编码用的。
4. 资源更新：动态buffer用**环形缓冲区（多副本轮换）**
    比如每帧变化的uniform、骨骼数据，准备3份buffer，帧n用buffer0，帧n+1用buffer1，避免CPU正在写、GPU正在读的冲突，不用等待同步。
5. 减少CommandBuffer数量：**一帧尽量一个CommandBuffer**
    多个小CommandBuffer会增加GPU调度开销；只有真正独立的并行任务（异步计算、独立blit）才拆多个queue。

## ✅ 第三大类：纹理 & 内存带宽优化
1. 纹理一定用**ASTC压缩**（A系列GPU原生最优），不要RGBA8无压缩；
    不要无脑4096x4096，根据距离做LOD；mipmap打开，远处采样自动用小层级，减少采样带宽。
2. 纹理采样器：尽量减少采样器数量，复用sampler；
3. 不要频繁CPU→GPU上传纹理；静态资源初始化一次性上传；动态纹理优先用blit encoder；
4. 用Heap（MTLHeap）批量分配资源，减少单独alloc开销；Metal3+可以用unretained command buffer，关闭自动资源retain，省一点点CPU开销（前提你自己保证资源生命周期）。

## ✅ 第四大类：Shader 优化（MSL）
1. 减少分支！分支会让GPU warp发散，并行效率暴跌；
    优先用**Function Constants（函数常量）**做shader特化，编译期消除分支，代替uber shader里面大量if else；
2. 减少片元shader里面的纹理采样次数；能在顶点shader算的，不要放到片元；
3. 尽量少用discard；discard会破坏TBDR的HRS提前剔除，性能损失很大；
4. 寄存器压力：shader局部变量太多，占用寄存器，GPU并行线程数下降；精简临时变量。
5. 优先用half（16bit浮点数），颜色、法线、uv能用half就不用float，带宽和寄存器压力减半。

## ✅ 第五大类：Compute 后处理、粒子、光照
1. Compute适合独立并行任务，但**不要大量小dispatch**；合并成大的线程组；
2. 注意依赖：如果compute A输出给compute B，会串行；无依赖的compute可以并行在不同queue；
3. 瓦片内存：Tile Shader（Metal 3+）可以在片上内存做本地累加，适合SSAO、集群光照，带宽远低于普通compute。

## ✅ 第六大类：显示、同步、刷新率、卡顿坑
1. `present` 自动和CAMetalLayer的vsync同步；不要自己做额外sleep；
2. 最大飞行帧数不要超过3，太高会增加显存占用、输入延迟；太低（1）会造成CPU等待GPU，流水线空转；
3. 不要在render循环里面做任何昂贵的OC/Swift对象分配、解码、IO；
4. 用Metal System Trace / GPU Counter（Xcode Metal调试器）定位瓶颈：
    - 看是CPU瓶颈（command编码太久），还是GPU带宽瓶颈（memory read/write高），还是片元shader瓶颈（fragment cycles）；
    - 看GPU Timeline，找GPU空洞（idle气泡），代表依赖阻塞、同步等待。

## ❌ 请勿进行的操作
1. 每帧新建PipelineState / Sampler；
2. 一个RenderPass里反复切换大量RPS、大量setTexture；
3. 小物体不做实例化，DrawCall爆炸；
4. 不透明和半透明乱序渲染，HRS失效；
5. 大量小RenderPass，反复刷Tile；
6. 动态buffer单块复用，CPU写和GPU读冲突，加不必要等待；
7. 纹理不用压缩，全部RGBA8，带宽直接跑满；
8. shader大量if、discard、动态分支；
9. 主线程调用waitUntilCompleted，同步阻塞；
10. 忘记信号量，CPU疯狂生产，GPU跟不上，内存暴涨、掉帧。

---

# 四、不同渲染方案在Metal上怎么选
- **简单2D、UI、少量3D**：前向渲染Forward，单Pass，最稳，带宽友好；
- **大量光源**：Forward+（集群前向），比传统延迟渲染更适合TBDR；传统Deferred GBuffer多RT输出，带宽开销巨大，iPhone上慎用来做主渲染；
- **后处理、粒子、流体**：Compute Shader；
- **大量重复物体**：Instanced + Bindless Argument Buffer；
- **阴影、SSAO**：独立Pass，尽量低分辨率、memoryless附件。

---

# 五、快速上手
1. 初始化：创建设备、layer、pipeline、静态buffer/纹理、信号量；
2. 每帧：
    - 等待信号量；
    - 获取drawable；
    - 填充动态buffer（环形缓冲）；
    - 分配commandBuffer，encoder编码draw（先不透明、后透明，合并pass）；
    - present + commit；
    - completedHandler信号量release；
3. 优化方向优先级：**减少Pass数量 → 减少DrawCall（Instanced/Bindless）→ 优化load/store/memoryless → ASTC纹理压缩 → Shader分支精简 → 并行编码**。
