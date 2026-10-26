# SwiftUI 学习笔记：架构、底层原理、常用写法

> 
> 说明：SwiftUI 是 Apple 在 WWDC2019 推出的**声明式 UI 框架**，跨平台（iOS/macOS/watchOS/tvOS/visionOS），基于 Swift，和 UIKit/AppKit 是两套范式，不是简单封装 UIKit。

## 一、核心架构思想

### 1. 范式：声明式 vs 命令式

- **命令式（UIKit）**：你告诉系统「做什么步骤」：创建控件 → 设置 frame → 设置属性 → addSubview → 改约束；需要手动维护视图状态。
- **声明式（SwiftUI）**：你告诉系统「UI 应该长什么样」，描述**状态和视图的映射关系**；框架自动同步状态和界面。> 
> 核心公式：**View = f(State)**
> 视图是状态的纯函数，相同状态一定产出相同视图。

### 2. SwiftUI 架构分层

从上到下可以简单分成四层：

1. **View 层（描述层）**：`View` 协议，所有 UI 组件都是 View。**View 不是真实渲染对象，只是一个描述结构体（struct）**，轻量、值类型。
2. **更新与 diff 层（ViewGraph / 视图图）**：SwiftUI 内部维护一张视图图，对比新旧 View 描述，找出变化增量，最小更新。
3. **渲染桥接层（Render Engine）**：把解析后的视图描述，交给底层渲染引擎。
4. **原生渲染后端**：
   - iOS：底层最终会映射到 UIKit / CoreAnimation
   - macOS：映射到 AppKit
   - 新平台（visionOS）直接使用原生渲染管线> 
   > ⚠️ 误区：SwiftUI **不是直接把 View 转成 UIView**，不是简单的 UIKit 封装；它有独立的视图图管理机制，按需生成后端原生视图。

### 3. 数据流架构（SwiftUI 架构灵魂）

SwiftUI 没有 UIKit 的 delegate、notification 为主的回调体系，而是一套单向数据流体系：

| 包装器 | 作用 | 所有者 | 生命周期 |
| --- | --- | --- | --- |
| `@State` | 视图内部私有状态，状态变更触发视图刷新 | View 自己 | 和 View 生命周期绑定 |
| `@Binding` | 双向绑定，把状态的读写权限传给子视图 | 状态归属上层，子视图只有绑定引用 | 跟随源状态 |
| `@ObservedObject` | 引用类型外部对象，遵循 `ObservableObject`，`@Published` 标记发布属性 | 外部类 | 外部管理 |
| `@StateObject` | 在视图内创建并持有 ObservableObject，视图销毁对象才销毁 | 当前 View | 视图持有 |
| `@EnvironmentObject` | 全局环境注入，跨多层视图传对象 | 全局注入 | 全局生命周期 |
| `@Environment` | 读取系统环境变量（配色、字体、暗黑模式等） | SwiftUI 运行时 | 系统环境 |
| `@AppStorage` | 对 UserDefaults 的封装 | UserDefaults | 持久化 |

核心原则：

- **单一数据源**；状态向上提升（State Lift），共享状态放到上层；
- 单向流动：状态向下传递，事件向上回调；
- 值类型优先，减少副作用。

### 4. 官方推荐架构方案

1. **MV（Model + View）**：简单页面，Model 为普通结构体，`@State` 管理；适合小页面。
2. **MVVM**：最常用，ViewModel 实现 `ObservableObject`，承载业务逻辑，View 只负责声明 UI。
3. **Redux / TCA（The Composable Architecture）**：大型复杂 App，统一状态、Action、Reducer，适合状态极其复杂、多页面共享状态。
4. **Clean Architecture**：搭配 SwiftUI，ViewModel 调用 UseCase，隔离网络、数据库。

> 
> SwiftUI 本身**不强制任何架构**，它只是提供了数据流原语。

---

## 二、底层原理（重点）

### 1. View 本质：struct，只是描述，不是视图实例

```
protocol View {
    associatedtype Body : View
    var body: Self.Body { get }
}
```

- `View` 是**结构体（value type）**，没有引用，没有内存地址；
- 每次 `body` 被访问，只是生成一份新的 UI 描述；
- **body 不是立刻渲染**，只是返回描述树；SwiftUI 运行时会捕获这个描述，构建内部的 View Graph（视图图）。

> 
> 重点：`body` 是一个计算属性，**不能写业务逻辑、不能做耗时操作**，只用来描述 UI。

### 2. View Graph（视图图）—— SwiftUI 的核心黑盒

当视图第一次渲染：

1. 系统读取 View.body，递归解析所有子 View；
2. 构建一张内部的有向图 ViewGraph，节点不是 SwiftUI View，而是框架内部的 `GraphNode`；
3. 每个节点记录：类型、标识、属性、依赖的状态；
4. 当绑定的状态发生变化时：
   - SwiftUI 找到**依赖这个状态的节点**；
   - 重新执行对应 View 的 body，拿到新描述；
   - 对新旧描述做 diff（差异比对）；
   - 只把变化部分交给渲染后端更新（增量更新）。

👉 这就是 SwiftUI 高效的根源：**不整体重绘整棵树，只更新依赖变更状态的分支**。
👉 `id()` 修饰符会影响 diff：如果 id 变化，SwiftUI 认为是完全不同的节点，直接销毁重建。

### 3. 属性包装器（Property Wrapper）底层原理

`@State` / `@Binding` 这些都是 Swift 的 Property Wrapper，语法糖。
以 `@State` 举例：

```
@State var count = 0
```

展开后：

```
private var _count: State<Int> = State(initialValue: 0)
var count: Int {
    get { _count.wrappedValue }
    set { _count.wrappedValue = newValue }
}
```

- `State<T>` 内部**不会把值存在 View struct 里**；
- SwiftUI 运行时（ViewGraph）有一个独立的**状态存储区**；
- `State` 包装器内部持有一个指向存储区的**索引/句柄**；
- 当赋值 `count += 1`，包装器通知运行时：这个状态变更 → 标记依赖节点为脏节点 → 触发 body 重新计算、diff、刷新。

> 
> 这就能解释：View 是结构体，被拷贝的时候，`@State` 的值不会丢失——因为数据根本不在 struct 里面，struct 只存了一个引用句柄。

### 4. 渲染流程总览

1. **状态变更**（@State / @Published 赋值）
2. 运行时标记受影响的 GraphNode 为 dirty
3. 在合适的 runloop 时机（下一次渲染周期），调用 dirty 节点的 body
4. 生成新 View 描述树，diff 和旧图对比
5. 生成更新指令，下发给 Renderer
6. Renderer 按需创建/更新/销毁底层 UIView / CALayer
7. CoreAnimation 提交渲染到屏幕

### 5. 生命周期原理

SwiftUI 没有 UIKit `viewDidLoad` / `viewWillAppear` 这种固定生命周期方法，而是用修饰符回调：

- `.onAppear()`：Graph 节点被添加到视图树时调用
- `.onDisappear()`：Graph 节点从视图树移除时调用> 
> 坑点：diff 重建节点时，会触发 disappear + appear；id 变化、列表顺序变化都会触发。

### 6. 列表 Lazy 原理：LazyVStack / LazyHStack / List

- 普通 `VStack`：一次性创建所有子 View 描述；
- `LazyVStack`：只有当节点**即将进入可视区域**，才会执行子 View 的 body，生成描述；离开可视区域不会立刻销毁，有缓存策略；
- `List` 在 iOS15+ 默认是 Lazy 的，底层是 UICollectionView 优化封装。

---

## 三、SwiftUI 常用形式 & 写法模板

### 1. 基础单视图（@State 内部状态）

```
struct CounterView: View {
    @State private var count = 0
    
    var body: some View {
        VStack(spacing: 16) {
            Text("计数：\(count)")
                .font(.title)
            Button("+1") {
                count += 1
            }
        }
    }
}
```

### 2. 父子视图传值：@Binding 双向绑定

```
struct ParentView: View {
    @State private var isOn = false
    var body: some View {
        ToggleView(isOn: $isOn)
    }
}

struct ToggleView: View {
    @Binding var isOn: Bool
    var body: some View {
        Toggle("开关", isOn: $isOn)
    }
}
```

### 3. 外部业务模型：ObservableObject + @StateObject / @ObservedObject

```
class UserViewModel: ObservableObject {
    @Published var name = "张三"
    
    func rename() {
        name = "李四"
    }
}

struct UserView: View {
    @StateObject private var vm = UserViewModel()
    
    var body: some View {
        VStack {
            Text(vm.name)
            Button("改名") {
                vm.rename()
            }
        }
    }
}
```

> 
> 区分：`@StateObject`：视图内创建对象；`@ObservedObject`：外部传入对象。

### 4. 环境传值 @EnvironmentObject（跨多层）

```
class AppGlobalState: ObservableObject {
    @Published var themeDark = false
}

// 入口注入
ContentView()
    .environmentObject(AppGlobalState())

// 任意子视图读取
struct ChildView: View {
    @EnvironmentObject var global: AppGlobalState
    var body: some View {
        Text(global.themeDark ? "深色" : "浅色")
    }
}
```

### 5. 常用容器布局

- `VStack` / `HStack` / `ZStack`：基础堆叠（Z 是层叠）
- `LazyVStack` / `LazyHStack`：懒加载垂直/水平栈
- `Grid`：网格布局（iOS16+）
- `List`：列表
- `ScrollView`：滚动容器
- `NavigationStack`：导航（iOS16+，替代 NavigationView）
- `TabView`：标签页

### 6. 常用修饰符（Modifier）

修饰符本质：返回一个新的 `ModifiedContent<Self, M>`，也是 View。

```
Text("Hello")
    .font(.body)
    .foregroundColor(.blue)
    .padding()
    .background(.gray.opacity(0.1))
    .cornerRadius(8)
    .onTapGesture {
        // 点击
    }
    .onAppear {
        // 出现
    }
```

> 
> 重要：修饰符顺序有影响！`.padding().background` 和 `.background().padding` 效果不一样。

### 7. 弹窗、Sheet 弹出

```
struct SheetDemo: View {
    @State private var showSheet = false
    var body: some View {
        Button("打开弹窗") {
            showSheet = true
        }
        .sheet(isPresented: $showSheet) {
            DetailView()
        }
    }
}
```

### 8. 异步任务 .task（iOS15+，替代 onAppear 里 Task）

```
struct AsyncView: View {
    @State private var data: String?
    var body: some View {
        Text(data ?? "加载中")
            .task {
                // 视图出现自动执行，视图销毁自动cancel Task
                data = await fetchData()
            }
    }
    
    func fetchData() async -> String {
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        return "请求完成"
    }
}
```

### 9. UIKit 混合：UIViewRepresentable

SwiftUI 嵌入 UIKit 控件、或者把 SwiftUI 视图放到 UIKit，是混合开发必备形式：

```
struct WrappedUIButton: UIViewRepresentable {
    func makeUIView(context: Context) -> UIButton {
        let btn = UIButton(type: .system)
        btn.setTitle("UIKit Button", for: .normal)
        return btn
    }
    func updateUIView(_ uiView: UIButton, context: Context) {}
}
```

---

## 四、常见问题

1. body 是计算属性，**不要在 body 里写复杂逻辑、网络请求**；
2. `@State` 只能用于 View 内部，不要存大型对象；大型对象用 `ObservableObject`；
3. `Lazy` 容器只懒加载子 View 的 body，**不会懒加载 @StateObject**；只要视图结构体被创建，StateObject 就初始化；
4. diff 依赖类型和 id；循环列表建议给 `ForEach` 稳定 id；
5. SwiftUI 刷新是自动的，但过度细粒度状态拆分、大量动态 id 会带来性能问题；
6. iOS16 是重要分水岭：NavigationStack、Grid、新 Sheet API、.task 行为都有变化。

## 五、一句话总结

SwiftUI 的本质：**一套基于值类型视图描述、内部维护 ViewGraph 做增量 diff、配合 PropertyWrapper 响应式数据流、最后桥接到原生渲染引擎的声明式 UI 框架；它提供数据流原语，MVVM 是最主流的使用形式。**
