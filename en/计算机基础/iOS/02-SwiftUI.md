---
title: "SwiftUI study notes: architecture, underlying principles, common writing methods"
lang: en
translatedFrom: 73bee30ffb3c10c07636b28992c0efe2d4aaca45efefee6bd1f5c66b7e9c1a8e
translatedAt: 2026-10-26
---

# SwiftUI study notes: architecture, underlying principles, common writing methods

> 
> Description: SwiftUI is the** declarative UI framework** launched by Apple at WWDC2019. It is cross-platform (iOS/macOS/watchOS/tvOS/visionOS), based on Swift, and UIKit/AppKit are two sets of paradigms, not a simple encapsulation of UIKit.

## 1. Core architectural ideas

### 1. Paradigm: Declarative vs. Imperative

- **Imperative (UIKit)**: You tell the system "what to do": create control → set frame → set properties → addSubview → change constraints; the view state needs to be maintained manually.
- **Declarative (SwiftUI)**: You tell the system "what the UI should look like" and describe the mapping relationship between **state and view**; the framework automatically synchronizes the state and interface. >
> core formula: **View = f(State)**
> View is a pure function of state, and the same state must produce the same view.

### 2. SwiftUI architecture layering

It can be simply divided into four layers from top to bottom:

1. **View layer (description layer)**: `View` protocol, all UI components are View. **View is not a real rendering object, but a description structure (struct)**, lightweight, value type.
2. **update and diff layer (ViewGraph / view graph)**: SwiftUI maintains a view graph internally, compares the old and new View descriptions, and finds the change increment and minimum update.
3. **Rendering bridge layer (Render Engine)**: Pass the parsed view description to the underlying rendering engine.
4. **Native rendering backend**:
   - iOS: The bottom layer will eventually be mapped to UIKit / CoreAnimation
   - macOS: mapped to AppKit
   - new platform (visionOS) directly uses the native rendering pipeline>
   > ⚠️ Misunderstanding: SwiftUI **does not directly convert View into UIView**, it is not a simple UIKit encapsulation; it has an independent view management mechanism and generates back-end native views on demand.

### 3. Data flow architecture (soul of SwiftUI architecture)

SwiftUI does not have a callback system based on UIKit's delegate and notification, but a one-way data flow system:

| wrapper | role | owner | life cycle |
| --- | --- | --- | --- |
| `@State` | View internal private state, state change triggers view refresh | View itself | and View life cycle binding |
| `@Binding` | Two-way binding, passing the read and write permissions of the state to the subview | The state belongs to the upper layer, and the subview only has binding references | Follows the source state |
| `@ObservedObject` | Reference type external object, comply with `ObservableObject`, `@Published` tag publishing attribute | External class | External management |
| `@StateObject` | Create and hold ObservableObject in the view. The object will be destroyed only when the view destroys it. | Current View | View holds |
| `@EnvironmentObject` | Global environment injection, object transfer across multi-layer views | Global injection | Global life cycle |
| `@Environment` | Read system environment variables (color, font, dark mode, etc.) | SwiftUI runtime | System environment |
| `@AppStorage` | Encapsulation of UserDefaults | UserDefaults | Persistence |

Core principles:

- **Single data source**; the state is lifted upward (State Lift), and the shared state is placed on the upper layer;
- One-way flow: status is passed downward and events are called back upward;
- value types take precedence to reduce side effects.

### 4. Official recommended architecture solution

1. **MV (Model + View)**: simple page, Model is a common structure, `@State` management; suitable for small pages.
2. **MVVM**: Most commonly used, ViewModel implements `ObservableObject` and carries business logic. View is only responsible for declaring the UI.
3. **Redux/TCA (The Composable Architecture)**: Large Complex App unifies state, action, and reducer, and is suitable for extremely complex states and multi-page shared states.
4. **Clean Architecture**: With SwiftUI, ViewModel calls UseCase to isolate the network and database.

> 
> SwiftUI itself **does not enforce any architecture**, it just provides data flow primitives.

---

## 2. Underlying principles (key points)

### 1. View essence: struct, just a description, not a view instance

```
protocol View {
    associatedtype Body : View
    var body: Self.Body { get }
}
```

- `View` is the **structure (value type)**, with no reference and no memory address;
- Each time `body` is accessed, only a new UI description is generated;
- **body does not render** immediately, but just returns the description tree; SwiftUI will capture this description when running and build the internal View Graph.

> 
> Key points: `body` is a calculated attribute. **cannot write business logic or perform time-consuming operations.** is only used to describe the UI.

### 2. View Graph - the core black box of SwiftUI

When the view is first rendered:

1. The system reads View.body and recursively parses all sub-Views;
2. builds an internal directed graph ViewGraph. The node is not SwiftUI View, but `GraphNode` inside the framework;
3. Each node records: type, identification, attributes, dependency status;
4. When the binding status changes:
   - SwiftUI finds the node** that **depends on this state;
   - Re-execute the body of the corresponding View and get the new description;
   - Do diff (difference comparison) between the old and new descriptions;
   - only sends the changes to the rendering backend for update (incremental update).

👉 This is the root of SwiftUI's efficiency: **does not redraw the entire tree as a whole, but only updates the branch** that depends on the changed state.
👉 The `id()` modifier will affect diff: if the id changes, SwiftUI will consider it to be a completely different node and destroy and rebuild it directly.

### 3. The underlying principle of Property Wrapper

`@State` / `@Binding` These are Swift’s Property Wrapper, syntax sugar.
Take `@State` as an example:

```
@State var count = 0
```

After expansion:

```
private var _count: State<Int> = State(initialValue: 0)
var count: Int {
    get { _count.wrappedValue }
    set { _count.wrappedValue = newValue }
}
```

- `State<T>` internal **will not store the value in the View struct**;
- SwiftUI runtime (ViewGraph) has an independent **state storage area**;
- `State` The wrapper internally holds a **index/handle** that points to the storage area;
- When assigning `count += 1`, the wrapper notifies the runtime: this state change → marks the dependent node as dirty → triggers body recalculation, diff, refresh.

> 
> This can explain: View is a structure, and when it is copied, the value of `@State` will not be lost - because the data is not in the struct at all, and the struct only stores a reference handle.

### 4. Rendering process overview

1. **state change** (@State / @Published assignment)
2. marks the affected GraphNode as dirty at runtime
3. At the appropriate runloop timing (next rendering cycle), call the body of the dirty node
4. Generate new View description tree, compare diff with old picture
5. generates update instructions and sends them to Renderer
6. Renderer creates/updates/destroyes underlying UIView/CALayer on demand
7. CoreAnimation submits rendering to the screen

### 5. Life cycle principle

SwiftUI does not have fixed life cycle methods such as UIKit `viewDidLoad` / `viewWillAppear`, but uses modifier callbacks:

- `.onAppear()`: Called when a Graph node is added to the view tree
- `.onDisappear()`: Called when the Graph node is removed from the view tree>
> Pitfall: When diff rebuilds a node, disappear + appear will be triggered; id changes and list order changes will also trigger.

### 6. List Lazy principle: LazyVStack / LazyHStack / List

- Normal `VStack`: Create all sub-view descriptions at once;
- `LazyVStack`: Only when the node **is about to enter the visible area**, the body of the sub-View will be executed and the description will be generated; it will not be destroyed immediately after leaving the visible area, and there is a cache policy;
- `List` is Lazy by default in iOS15+, and the bottom layer is UICollectionView optimized encapsulation.

---

## 3. SwiftUI common forms & writing templates

### 1. Basic single view (@State internal state)

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

### 2. Parent-child view passing value: @Binding two-way binding

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

### 3. External business model: ObservableObject + @StateObject / @ObservedObject

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
> distinction: `@StateObject`: objects created within the view; `@ObservedObject`: objects passed in from outside.

### 4. Environment value @EnvironmentObject (across multiple layers)

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

### 5. Common container layouts

- `VStack` / `HStack` / `ZStack`: base stack (Z is stack)
- `LazyVStack`/`LazyHStack`: lazy loading vertical/horizontal stack
- `Grid`: Grid layout (iOS16+)
- `List`: List
- `ScrollView`: rolling container
- `NavigationStack`: Navigation (iOS16+, replaces NavigationView)
- `TabView`: tab page

### 6. Commonly used modifiers (Modifier)

Modifier essence: Return a new `ModifiedContent<Self, M>`, which is also a View.

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
> Important: Modifier order matters! `.padding().background` and `.background().padding` have different effects.

### 7. Pop-up window, Sheet pop-up

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

### 8. Asynchronous task .task (iOS15+, replaces Task in onAppear)

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

### 9. UIKit Mix: UIViewRepresentable

Embedding SwiftUI into UIKit controls or putting SwiftUI views into UIKit is a necessary form of hybrid development:

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

## 4. Frequently Asked Questions

1. body is a calculated attribute, **do not write complex logic and network requests** in the body;
2. `@State` can only be used inside View, do not store large objects; use `ObservableObject` for large objects;
3. `Lazy` The container only lazily loads the body of the child View, **will not lazily load @StateObject**; as long as the view structure is created, StateObject is initialized;
4. diff depends on type and id; circular list is recommended for `ForEach` stable id;
5. SwiftUI refresh is automatic, but excessively fine-grained state splitting and a large number of dynamic IDs will cause performance problems;
6. iOS16 is an important watershed: NavigationStack, Grid, new Sheet API, and .task behavior have all changed.

## 5. One sentence summary

The essence of SwiftUI: **is a declarative UI framework based on value type view description, internal maintenance of ViewGraph for incremental diff, and PropertyWrapper responsive data flow, and finally bridged to the native rendering engine; it provides data flow primitives, and MVVM is the most mainstream form of use.**
