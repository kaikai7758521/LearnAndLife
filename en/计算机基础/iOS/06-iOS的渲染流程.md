---
title: "IOS rendering process"
lang: en
translatedFrom: e4e49a654bc738f4f8028d7151c7cba2d6ec3d9c01f96ae066d37528d00fe799
translatedAt: 2026-11-02
---

# IOS rendering process
> Core sentence: **UIView is just a logical container, and the real rendering carrier is CALayer; the App main thread is only responsible for building the layer tree, and the actual rendering synthesis is completed by an independent Render Server process + GPU; Apple GPU is tile-based delayed rendering TBDR**

## 1. Basic principles
### 1. Core model: view-layer model
UIKit's `UIView` = event response + layout logic; **Each UIView bottom layer is bound to a CALayer**. The layer is the rendering tree node and saves rendering attributes such as position, size, color, rounded corners, shadow, transparency, contents (bitmap texture).
- View tree: The object tree used by developers for daily operations, responsible for clicks, gestures, and layout updates
- Layer tree: Core Animation’s rendering tree, which is the data structure submitted to the rendering service.
- Presentation tree: animation intermediate interpolation tree, representing the real-time status of **displaying** on the current screen (during the animation process, layer.model is the target value and presentation is the current value)

> Key differences: **implicit animation**: Modify most properties of CALayer, CoreAnimation automatically generates animation; UIView turns off implicit animation by default.

### 2. Apple GPU underlying features: TBDR (Tile-Based Deferred Renderer, tiled delayed rendering)
This is the hardware foundation for all rendering in iOS, which is very different from the PC GPU pipeline:
1. **Tiling stage**: GPU splits the screen into many small tiles (tiles), first collects all the graphics elements in this tile, makes visibility judgment, and packages the instructions;
2. **Rendering stage**: Rasterize, color, and mix on high-speed on-chip Tile Memory tile by tile;
After the 3. tile is completed, the result is written back to the main memory Framebuffer.

Advantages: Greatly reduced video memory read and write bandwidth, low power consumption of mobile phones; Cost: Off-screen rendering overhead of **will be amplified by**, because it requires additional independent off-screen buffers and multiple reads and writes of video memory.

### 3. VSync / vertical synchronization & rendering loop (Render Loop)
The screen refreshes at a fixed frequency (60/120Hz), and the VSync signal is the rendering beat. The complete rendering of a frame is divided into three major stages, spanning processes: App process → Render Server (independent system process) → GPU → Display controller
1. **App stage (main thread)**: event, layout, drawing, layer submission commit;
2. **Render Server stage**: parse the layer tree and compile it into a GPU instruction package;
3. **GPU execution phase**: rasterization, shading, layer synthesis, output frame buffer, and the next VSync is sent to the screen.

The essence of > lagging: any link takes longer than the VSync interval (120Hz ≈ 8.3ms, 60Hz ≈16.6ms) and frames are dropped.

## 2. iOS rendering technology stack & framework layering (from top to bottom)
| Frame | Positioning | Purpose | Rendering method |
|---|---|---|---|
| UIKit / SwiftUI | High-level interface components | Button, Label, list, page layout | encapsulates CoreAnimation and automatically builds Layer tree |
| Core Animation (QuartzCore) | layer composition, animation engine | layer management, attribute animation, layer composition, CAMetalLayer | 2D layer composition, handed over to GPU acceleration |
| Core Graphics (Quartz 2D) | vector drawing (CPU drawing) | path, text, gradient, PDF, screenshot, custom drawing drawRect | **CPU rasterization, generate bitmap to layer.contents** |
| Core Image | Image filter processing | Beauty, blur, color correction, image post-processing | GPU filter pipeline, based on Metal |
| Metal | Apple's underlying GPU API | 3D, high-performance 2D, video rendering, custom rendering pipeline, ARKit | directly encodes GPU instructions, replacing the abandoned OpenGL ES |
| RealityKit | AR/3D high-level engine | AR, 3D model rendering | Based on Metal, encapsulates lighting, materials, physics |

Key insights:
- `drawRect:`: When calling, CoreGraphics draws bitmaps on the CPU. **is CPU drawing and is very heavy. Try to avoid calling** frequently;
- Most ordinary UI does not require drawRect, only needs to set the layer attribute, which is synthesized by CoreAnimation on the GPU;
- Metal is the modern preferred underlying graphics API; OpenGL ES is no longer recommended on new systems.

## 3. One frame complete rendering process (standard Render Loop)
In chronological order, from user touch to screen refresh:
1. **event response (main thread RunLoop)**: click, gesture, timer triggers UI changes;
2. **Layout stage (Layout)**
   - `layoutSubviews` / SwiftUI layout calculates frame and constraints;
   - updates the bounds and position of the view and layer;
3. **Drawing stage (Draw, optional)**
   - If `drawRect:` is rewritten, the system creates a canvas, calls the CG interface to draw vector content on the CPU, generates a bitmap, and assigns it to `layer.contents`;
   - Ordinary View without drawRect: Without this step, the layer only saves attributes;
4. **Commit(CATransaction)**
   - All layer modifications will be collected by CATransaction; runloop ends and automatically commits;
   - serializes the entire layer tree, and **is sent to Render Server** across processes; after submission, the App main thread no longer participates in this frame synthesis;
5. Render Server: Preparation Phase (Render Prepare)
   - parses the layer tree and compiles layer properties and animation parameters into GPU executable rendering instructions;
   - interpolates animation presentation value and marks which layers need to be rendered off-screen;
6. GPU execution phase (Render Execute)
   - renders the layers in the order of **from back to front**;
   - Rasterization, coloring, cropping, masking, and mixing; when encountering effects that require off-screen, first draw to the Offscreen Buffer;
   - All layers are synthesized into the final Framebuffer;
7. display: The next VSync comes, the frame buffer is sent to the screen driver, and the pixels are lit.

> Two confusing points:
> - Commit just commits the description, **does not draw**; the drawing occurs in Render Server + GPU;
> - The main thread is blocked, which only affects [layout, drawing, and submission] and does not block the frame being rendered by the GPU.

## 4. Common operations during the rendering process
### 1. Rasterization
Convert vector graphics (paths, text, shapes) to pixel bitmaps.
- CoreGraphics: CPU rasterization;
- Metal / CoreAnimation: GPU rasterization;
- `shouldRasterize = YES`: Combine this layer + sublayer into a bitmap cache; suitable for static complex layers; **dynamically changing layers will be frequently redrawn when opened, and the performance will explode**.

### 2. Clipping/Mask
- `masksToBounds`: Crop sub-layers based on layer bounds; paired with cornerRadius, it is a classic off-screen trigger condition;
- `mask`: Custom mask layer (CALayer as mask), forced off-screen rendering;
- scissor cropping: GPU viewport cropping, low cost, and will not trigger off-screen.

### 3. Compositing / Blending
Semi-transparent layer overlay: The GPU needs to read the rendered pixels of the lower layer and mix them according to the alpha formula.
- Completely opaque layer (opaque = YES): direct coverage, no need to read the lower layer, fastest speed;
- Translucent, groupOpacity: requires mixing; groupOpacity will force a group of layers to be combined off-screen first and then unified and transparent.

### 4. Offscreen Render (the most important thing)
Definition: The GPU cannot directly render to the main frame buffer of the screen. It must first render to an independent temporary buffer (Offscreen Buffer). After the effect is completed, the result is copied back to the main frame buffer for synthesis.
✅ Common conditions that trigger off-screen rendering:
1. `cornerRadius + masksToBounds` (rounded corner cropping);
2. `layer.shadowColor / shadowOffset / shadowRadius` (shadow, unless shadowPath optimization is specified);
3. `layer.mask` mask;
4. `allowsGroupOpacity` group transparent;
5. `shouldRasterize = true`;
6. Custom CoreImage chain filter;

⚠️ Price: additional development Buffer, multiple reading and writing of video memory, the overhead is significant under the TBDR architecture; a large amount of off-screen will directly drop the frame.
✅ Optimization ideas: pre-cut rounded corners, shadowPath, use CAShapeLayer instead of mask, reduce the number of overlapping off-screen layers.

### 5. Anti-Aliasing
CoreGraphics drawing turns on anti-aliasing by default; Metal can configure MSAA multi-sampling anti-aliasing, and MSAA itself will also increase the graphics memory overhead.

### 6. Texture upload & contents rendering
`layer.contents` Set image (CGImage): The essence is to upload the image as a GPU texture; the image is too large and has the wrong size (not a power of 2, exceeding the screen), which will occupy the video memory; image decompression is a common stuck point in the main thread.

### 7. Animation interpolation
CoreAnimation animation performs interpolation calculations in the Render Server and does not require frame-by-frame callbacks from the main thread; this is also the fundamental reason why attribute animation is smooth.

## 5. Common application scenarios of iOS rendering
### Scenario 1: Regular App UI (list, page, button, image and text)
- solution: UIKit/SwiftUI + CoreAnimation;
- rendering features: try to use only layer attributes to avoid drawRect and overlay off-screen; image pre-decoding;
- performance target: 60/120Hz stable scrolling, reducing main thread layout and image decoding pressure.

### Scenario 2: Customized vector drawing (charts, hand-drawn whiteboard, PDF preview)
- solution: CoreGraphics (CPU) or Metal/CAShapeLayer (GPU);
- CoreGraphics is suitable for static and low-frequency drawing; Metal is recommended for high-frequency hand-drawing and real-time trajectory.

### Scene 3: Picture filters, image processing (camera, beauty, photo retouching)
- solution: CoreImage; running Metal filter chain at the bottom layer;
- is suitable for: Gaussian blur, color correction, and lut filters; complex filter chains will leave the screen many times.

### Scene 4: Short video, live broadcast, camera preview
- solution: Metal + CAMetalLayer; receive CMSampleBuffer, YUV to RGB, beautification, watermark overlay, rendering output;
- Typical: Douyin, Kuaishou camera link, not using CoreGraphics.

### Scenario 5: 3D/AR rendering (games, AR measurements, virtual models)
- solution: Metal self-developed pipeline, or high-level RealityKit; old project SceneKit (has been gradually abandoned); ARKit provides camera frames and attitude information to the rendering layer.

### Scenario 6: Screenshot, generate poster, export image
- solution:
  - `UIGraphicsImageRenderer` (CoreGraphics) screenshot;
  - Metal reads renderPass texture export;
  - Note: Ordinary screenshot operations will trigger the drawing and synthesis of the layer tree, which is a double overhead of CPU + GPU.

### Scene 7: High-performance animation, particle effects
- Simple: CoreAnimation CAKeyframeAnimation;
- A large number of particles and fluids: Metal compute shader + rendering pipeline.

## 6. Troubleshooting Tools
1. Xcode Debug → Color Offscreen-Rendered Yellow: Yellow marks the off-screen rendering layer;
2. Color Copied Images: mark image copy;
3. Core Animation Instrument: View GPU time consumption, off-screen times, and rasterization;
4. Metal Debugger: Capture GPU instructions to see render pass, texture, and tile rendering.

## 7. Summary
1. UIView is not a rendering unit, CALayer is;
2. drawRect is CPU drawing, so don’t use it if you can;
3. Shadows, rounded corners, and masks are major off-screen users and should be prioritized for optimization;
4. Apple GPU uses tile deferred rendering, which is different from PC GPU optimization ideas;
The core of 5. animation smoothness: hand over the animation to the Render Server, do not refresh the layout frame by frame in the main thread;
6. There are many translucent layers, and the mixing overhead increases; it can be opaque as much as possible.
