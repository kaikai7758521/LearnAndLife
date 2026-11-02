---
title: "Metal for iOS"
lang: en
translatedFrom: ec14fd0b50881e03b0a21bd1534845f92e1903416cea2ca269630c9674535ffa
translatedAt: 2026-11-02
---

# Metal for iOS
Metal is Apple's **explicit, low-overhead GPU API**, which replaces the old OpenGL ES, unifies graphics rendering + GPU computing (graphics pipeline, Compute, and Blit copy are all in one set of APIs), and is supported by MSL (Metal Shading Language, C++-like shader language).
> core features: **explicitly controls**, without the implicit state machine of GL; CPU overhead is much lower than GLES; Apple GPU is **TBDR (Tile-Based Deferred Renderer, tile deferred rendering)**, which is the basis for all iOS performance optimization, and is completely different from the desktop GPU architecture.

TBDR can be understood in one sentence:
1. **Tiling stage**: First cut the viewport into many small tiles, traverse all triangles, perform vertex transformation and cropping, and divide the triangles into corresponding tiles;
2. **Rendering stage**: Tile by tile, do rasterization, depth testing, and fragment coloring in **on-chip Tile Memory (extremely fast, low bandwidth)**;
3. After the tiles are calculated, the results are written back to the system memory.
✅ Advantages: Significantly reduce reading and writing of system memory bandwidth;
⚠️ Cost: **Do not interrupt a RenderPass** at will, do not frequently read and write the same texture, and do not read and write a large number of across tiles, otherwise the Tile Memory will be forced to be flushed back to the memory, and the performance will plummet.

> Comparison with OpenGL ES: GL is a hidden state machine, and the driver does a lot of synchronization, caching, and state verification inside the driver; Metal leaves the decision-making power to the developer, and it is easier to get stuck if it is not written well.

## Core object
1. **MTLDevice**: GPU abstraction, a device from which all resources are created; `MTLCreateSystemDefaultDevice()`
2. **MTLCommandQueue**: Command queue, used to submit CommandBuffer; single queue serial, multiple queues can submit different types of work in parallel (graphics/computing/blit)
3. **MTLCommandBuffer**: A batch of commands packaged to the GPU in one frame. **submits** at once and cannot be modified midway;
4. **Encoder (encoder, 3 types)**: Write GPU instructions in CommandBuffer
    - `MTLRenderCommandEncoder`: 3D/2D raster rendering (vertex + fragment pipeline)
    - `MTLComputeCommandEncoder`: General GPU computing (post-processing, particles, lighting clusters, physics)
    - `MTLBlitCommandEncoder`: resource copy, texture generation mipmap, resource compression, texture format conversion
5. **MTLRenderPipelineState (RPS)**: rendering pipeline state (vertex/fragment shader, vertex format, mixing, rasterization, multisampling), **heavyweight object, pre-compiled, do not create a new** for each frame
6. **MTLBuffer**: video memory buffer (vertex, index, uniform, instance data)
7. **MTLTexture**: texture, RT, depth buffer
8. **MTLRenderPassDescriptor**: Describes which textures, depth templates, and load/store actions are to be output to a rendering pass (key points of TBDR optimization)
9. **CAMetalLayer**: Bind to UIView to provide drawable objects `drawable` (final screen output)

**Metal One frame standard process**
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

# 2. How to write common rendering operations
## 1. Draw static mesh (opaque objects, most commonly used)
Key points:
- vertex buffer, index buffer **pre-created, long-term holding**, do not alloc every frame;
- vertex shader output position, fragment shader output color;
- opaque object **first draws**, turns on the depth test, and uses TBDR hardware HRS (hidden surface culling) to discard occluded pixels in advance to reduce fragment shading overhead.
```swift
// 伪代码
let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: rpd)!
encoder.setRenderPipelineState(pipelineState)
encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
encoder.setFragmentTexture(baseColorTex, index: 0)
encoder.drawIndexedPrimitives(type: .triangle, indexCount: indexCount, indexType: .uint16, indexBuffer: indexBuffer, indexBufferOffset: 0)
encoder.endEncoding()
```

## 2. Instanced rendering (a large number of repeated objects: grass, particles, billboards)
`drawIndexedPrimitives(instanceCount:)`, the instance data is placed in another vertex buffer;
✅ Greatly reduces DrawCall, which is one of the most cost-effective optimizations in iOS;
⚠️ Try to pack the instance data into one buffer and do not switch between multiple buffers.

## 3. Translucent objects (transparent, particles, UI)
- **turns off depth writing and retains depth testing**;
- must be sorted **from back to front**;
- Do not mix translucent and opaque in the same pass, as it will destroy HRS;
- The mixing mode is configured in PipelineState, do not change the mixing dynamically.

## 4. Post-processing (Bloom, SSR, TAA, color correction)
Two ways of writing:
- Solution A: RenderPass renders to the intermediate texture, and then samples a full-screen quad;
- Solution B: Compute Shader (more suitable for full-screen post-processing, with controllable bandwidth)
> TBDR advice: The more post-processing passes there are, the easier it is to trigger Tile flush; post-processing that can be merged should be merged into the same Compute or the same RenderPass as much as possible.

## 5. Shadow map ShadowMap
- A single RenderPass: the camera is replaced by light source projection, and the depth is rendered to the depth texture;
- shadow texture recommends **2D texture, sampling contrast filter**;
- Do not use super large resolution shadows, A series GPUs are bandwidth sensitive;
- can use `memoryless` depth to reduce memory usage (if only used within this pass).

## 6. Blit operations (copy, mipmap, texture upload)
- texture is uploaded from CPU memory: give priority to BlitEncoder, do not write the texture directly to the CPU;
- mipmap generation: `generateMipmaps` is done in blit encoder;
- Large resource copies should not be scattered and blit multiple times, and should be merged as much as possible.

## 7. Synchronization: CPU ↔ GPU
Metal defaults to **and asynchronous**: the CPU continues to run after commit and the GPU executes in the background.
The most classic solution: **counting semaphore + multi-frame buffer rotation (3 frames flying is the industry default)**
```swift
// semaphore初始值 = maxFramesInFlight（一般3）
semaphore.wait()
commandBuffer.addCompletedHandler { _ in semaphore.signal() }
```
⚠️ Prohibited: When `commandBuffer.waitUntilCompleted()` is called on the main rendering thread, it will directly lock the pipeline and drop frames.

## 8. Argument Buffer / Bindless (Metal3+, high-performance resource binding)
Traditional: setFragmentTexture, setBuffer for each drawcall, high CPU overhead;
Bindless: Pack a bunch of texture/buffer indexes into an argument buffer and bind them once;
It is suitable for scenes with many materials and a large number of drawcalls, which greatly reduces CPU binding overhead; it cooperates with Heap management resources to reduce tracking overhead.

---

# 3. Fluency & rendering acceleration core rules under iOS TBDR
> All optimizations are divided into three major categories: **CPU side overhead, GPU bandwidth, GPU fragment overhead, and Pass dependency**. **bandwidth on iOS is usually the first bottleneck**, not just computing power.

## ✅ The first category: adapting TBDR to reduce Tile memory refresh
1. **Make good use of RenderPassAttachment's loadAction / storeAction**
    - `loadAction: .clear`: This pass starts to be cleared;
    - `loadAction: .dontCare`: Do not read the previous frame result (very bandwidth-saving!)
    - `storeAction: .store`: The result needs to be written to the texture for later pass reading;
    - `storeAction: .dontCare`: This attachment is only used within the tile, and does not need to be saved after the pass is completed (**memoryless render target is the idea, and does not occupy video memory**)
    > Example: If the depth buffer is only blocked in this pass and no longer read later, storeAction = .dontCare, it will not be written back to the memory directly, which greatly saves bandwidth.
2. **Reduce the number of RenderPass as much as possible and merge Pass**
    Every time a new RenderPass is opened, TBDR must refresh the Tile Memory; renders that can be merged into the same pass should be merged as much as possible;
    ❌ Negative teaching materials: draw objects → submit pass → draw UI → submit pass → draw special effects → submit pass, multiple passes will explode.
3. In the same RenderPass, **is first completely opaque, and then semi-transparent**
    Opaque turns on depth writing, hardware HRS removes occluded pixels in advance, and skips expensive fragment shaders; translucency turns off depth writing and puts it later.
4. should not be in the same RenderPass, **randomly reads and writes the same texture** (for example, the same RT is read and written in the fragment shader)
    It will force tile serialization, and the advantages of TBDR will disappear directly.

## ✅ The second category: CPU side optimization (reduce the main thread time-consuming and avoid CPU bottlenecks)
1. **All pipeline status RPS, Sampler, Buffer, and Texture are all pre-created and cached. Do not create a new** for each frame
    Creating PipelineState is a very heavy compilation operation and should never be created in the render loop;
    SamplerState is also cached, don't make it every frame.
2. **Reduce the number of DrawCalls**
    - static batching;
    - Instanced instantiation;
    - atlas, texture array;
    - ArgumentBuffer / Bindless reduces binding calls;
    - ParallelRenderCommandEncoder: Multi-threaded parallel encoding of draw in the same RenderPass (suitable for large scenes and multi-threaded Culling)
3. coding logic is placed in the background thread, **main thread is only responsible for present, commit, and semaphore**
    Rendering loop: main thread waits for drawable, worker thread encodes commandBuffer;
    Note: CommandBuffer/Encoder is not thread-safe. One encoder of **can only write** with one thread. ParallelRenderEncoder is specially used for multi-threaded block encoding.
4. resource update: dynamic buffer uses **ring buffer (multi-copy rotation)**
    For example, for the uniform and skeletal data that changes in each frame, prepare three buffers. Use buffer0 for frame n and buffer1 for frame n+1 to avoid conflicts when the CPU is writing and the GPU is reading, and there is no need to wait for synchronization.
5. Reduce the number of CommandBuffers: **Try to have one CommandBuffer per frame**
    Multiple small CommandBuffers will increase GPU scheduling overhead; only truly independent parallel tasks (asynchronous computing, independent blit) can split multiple queues.

## ✅ The third category: Texture & Memory Bandwidth Optimization
1. texture must use **ASTC to compress** (A series GPU native optimal), do not use RGBA8 without compression;
    Don’t be stupid with 4096x4096, do LOD based on distance; turn on mipmap, and automatically use small levels for distant sampling to reduce sampling bandwidth.
2. texture sampler: minimize the number of samplers and reuse samplers;
3. Do not frequently upload textures from CPU to GPU; initialize static resources and upload them once; use blit encoder first for dynamic textures;
4. uses Heap (MTLHeap) to allocate resources in batches to reduce individual alloc overhead; Metal3+ can use unretained command buffer to turn off automatic resource retention, saving a little bit of CPU overhead (provided that you ensure the resource life cycle yourself).

## ✅ The fourth category: Shader optimization (MSL)
1. Reduce branches! Branching will cause the GPU warp to diverge and parallel efficiency to plummet;
    Prioritize using **Function Constants (function constants)** for shader specialization, eliminating branches during compilation, and replacing a large number of if elses in the uber shader;
2. Reduce the number of texture samples in the fragment shader; if it can be calculated in the vertex shader, do not put it in the fragment;
3. Try to use discard as little as possible; discard will destroy the HRS of TBDR and eliminate it in advance, causing a huge performance loss;
4. Register pressure: There are too many shader local variables, occupying registers, and the number of GPU parallel threads decreases; streamline temporary variables.
5. gives priority to using half (16-bit floating point number). Color, normal, and UV can use half instead of float, and the bandwidth and register pressure are halved.

## ✅ The fifth category: Compute post-processing, particles, lighting
1. Compute is suitable for independent parallel tasks, but **does not require a large number of small dispatch**; merge into a large thread group;
2. Pay attention to dependencies: if compute A outputs to compute B, it will be serialized; computes without dependencies can be run in different queues in parallel;
3. Tile memory: Tile Shader (Metal 3+) can perform local accumulation in the on-chip memory, which is suitable for SSAO and cluster lighting, and the bandwidth is much lower than that of ordinary compute.

## ✅ The sixth category: display, synchronization, refresh rate, lag pit
1. `present` automatically synchronizes with CAMetalLayer's vsync; do not do extra sleep yourself;
The maximum number of flying frames for 2. should not exceed 3. If it is too high, it will increase the memory usage and input delay; if it is too low (1), it will cause the CPU to wait for the GPU and the pipeline to idle;
3. Do not do any expensive OC/Swift object allocation, decoding, or IO in the render loop;
4. Use Metal System Trace / GPU Counter (Xcode Metal debugger) to locate bottlenecks:
    - Check whether it is a CPU bottleneck (command encoding takes too long), a GPU bandwidth bottleneck (memory read/write is high), or a fragment shader bottleneck (fragment cycles);
    - Look at the GPU Timeline and look for GPU holes (idle bubbles), which represent dependent blocking and synchronization waiting.

## ❌ Operations not to be performed
1. Create new PipelineState / Sampler for each frame;
2. Repeatedly switch a large number of RPS and a large number of setTextures in one RenderPass;
3. Small objects are not instantiated and DrawCall explodes;
4. Opaque and translucent rendering occurs out of order, and HRS fails;
5. A large number of small RenderPass, repeatedly brushing Tile;
6. dynamic buffer single block multiplexing, CPU writing and GPU reading conflict, causing unnecessary waiting;
7. textures do not need to be compressed, all are RGBA8, and the bandwidth is directly full;
8. shader has a large number of if, discard, and dynamic branches;
9. The main thread calls waitUntilCompleted and blocks synchronously;
10. Forget the semaphore, the CPU is producing like crazy, the GPU can’t keep up, the memory is skyrocketing, and frames are dropped.

---

# 4. How to choose different rendering schemes on Metal
- **Simple 2D, UI, a small amount of 3D**: Forward rendering, single Pass, the most stable, bandwidth-friendly;
- **A large number of light sources**: Forward+ (cluster forward), more suitable for TBDR than traditional deferred rendering; the traditional Deferred GBuffer has multiple RT outputs and huge bandwidth overhead. Use it with caution for primary rendering on iPhone;
- **Post-processing, particles, fluids**: Compute Shader;
- **A large number of repeated objects**: Instanced + Bindless Argument Buffer;
- **shadow, SSAO**: independent Pass, as low resolution as possible, memoryless attachments.

---

# 5. Get started quickly
1. initialization: create devices, layers, pipelines, static buffers/textures, and semaphores;
2. per frame:
    - waits for the semaphore;
    - gets drawable;
    - fills the dynamic buffer (ring buffer);
    - allocates commandBuffer, encoder encoding draw (opaque first, then transparent, merge pass);
    - present + commit;
    - completedHandler semaphore release;
3. Optimization direction priority: **Reduce the number of Passes → Reduce DrawCall (Instanced/Bindless) → Optimize load/store/memoryless → ASTC texture compression → Shader branch streamlining → Parallel encoding**.
