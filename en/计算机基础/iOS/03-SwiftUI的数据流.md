# SwiftUI的数据流

核心准则先重申：

> 
> **单一数据源，数据向下流，事件向上反馈；View = f(State)**
> 所有包装器本质是**状态依赖追踪机制**：状态变 → 找到依赖它的视图节点 → 自动刷新。

我们按数据流的使用顺序，从最简单到多层共享，逐个带可运行示例，同时讲清楚：**什么时候用、数据是谁的、修改之后流向哪里、坑点在哪**。

---

## 1. @State：视图私有本地状态（最简单）

✅ 适用：只属于当前视图的临时 UI 状态，弹窗开关、计数器、输入框、展开收起标记。
✅ 所有权：**当前视图拥有**，SwiftUI 运行时托管存储。
✅ 特点：只能在本视图创建，外部拿不到；可以生成 `$` 绑定传给子视图。

```
struct CounterView: View {
    // 视图私有状态
    @State private var count = 0
    
    var body: some View {
        VStack(spacing: 20) {
            Text("计数：\(count)")
                .font(.largeTitle)
            Button("点我 +1") {
                count += 1
            }
        }
    }
}
```

流向：

1. 用户点击按钮 → 修改 `count`
2. `@State` 通知 SwiftUI 运行时：该状态变更
3. 标记依赖这个状态的节点为脏
4. 重新执行 body，刷新界面

> 
> 坑：不要把网络数据、复杂业务模型丢进 `@State`，它适合轻量值类型。

---

## 2. @Binding：双向绑定，子视图不拥有数据，只代理读写

✅ 适用：抽离通用 UI 组件（自定义开关、输入框、弹窗），组件本身不持有数据源。
✅ 所有权：**数据源永远在上层**，Binding 只是一个读写代理。
✅ 记忆：`@State` 是房东，`@Binding` 是租客，租客没有产权。

示例：把计数器按钮抽成独立子组件

```
// 子组件：只负责UI，不拥有count
struct AddButtonView: View {
    // 绑定，没有源数据
    @Binding var count: Int
    
    var body: some View {
        Button("子组件 +1") {
            count += 1
        }
    }
}

// 父视图：拥有数据源
struct BindingDemoView: View {
    @State private var count = 0
    
    var body: some View {
        VStack(spacing: 20) {
            Text("计数：\(count)")
            // $count：生成 Binding<Int> 传给子视图
            AddButtonView(count: $count)
        }
    }
}
```

流向：

1. 子视图点击按钮 → 通过 `Binding` 修改 `count`
2. 修改会穿透回上游原始的 `@State`
3. 上游状态变更 → 上游、所有依赖该状态的子视图一起刷新

> 
> 重点：刷新的源头不是 Binding，是原始的 `@State` / `@Published`。Binding 本身不发布变更。

> 
> 对比单向回调写法（很多团队优先推荐，更清晰）

```
// 子视图只读，修改事件通过闭包抛上去
struct AddButtonPureView: View {
    var onAdd: () -> Void
    var body: some View {
        Button("单向回调 +1", action: onAdd)
    }
}

struct ParentView: View {
    @State private var count = 0
    var body: some View {
        VStack {
            Text("\(count)")
            AddButtonPureView(onAdd: { count += 1 })
        }
    }
}
```

👉 单向回调：数据往下传，事件往上走；**更容易追踪数据流，大型项目优先推荐**
👉 @Binding：隐式双向，写起来简短，适合通用基础控件。

---

## 3. ObservableObject + @Published + @StateObject：页面业务ViewModel（MVVM标准）

✅ 适用：页面业务逻辑、网络请求、复杂状态，需要封装方法。
✅ 所有权：`@StateObject` 在当前视图创建并持有这个 class 对象，生命周期由 SwiftUI 托管。
✅ `@Published`：属性修改前自动发送 `objectWillChange`，通知视图刷新。

```
// ViewModel：ObservableObject，承载业务
class UserViewModel: ObservableObject {
    @Published var username = "小明"
    @Published var loading = false
    
    func rename() async {
        loading = true
        // 模拟网络请求
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        username = "新名字：\(Int.random(in: 100...999))"
        loading = false
    }
}

struct UserView: View {
    // 当前视图创建、持有ViewModel
    @StateObject private var vm = UserViewModel()
    
    var body: some View {
        VStack(spacing: 20) {
            if vm.loading {
                ProgressView()
            } else {
                Text(vm.username)
                    .font(.title)
            }
            Button("异步修改名字") {
                Task {
                    await vm.rename()
                }
            }
        }
    }
}
```

流向：

1. 用户点击按钮 → 调用 vm.rename()
2. vm 修改 `loading`、`username`（`@Published` 属性）
3. 自动发送 `objectWillChange`
4. 监听这个 VM 的视图收到通知，触发 body 刷新

### @ObservedObject 对比（高频面试）

`@ObservedObject`：**只监听外部传入的 ObservableObject，视图不持有它**

```
struct ObservedChildView: View {
    // 对象是外面传进来的，我只负责监听
    @ObservedObject var vm: UserViewModel
    
    var body: some View {
        Text(vm.username)
    }
}

struct ParentView: View {
    @StateObject private var vm = UserViewModel()
    var body: some View {
        ObservedChildView(vm: vm)
    }
}
```

❌ 禁止写法：

```
// 错误！视图刷新时会反复新建VM，数据丢失
@ObservedObject var vm = UserViewModel()
```

> 
> 一句话区分：
> 
> 
> - 视图内部创建实例 → `@StateObject`
> - 外部传入实例，我只是监听 → `@ObservedObject`

⚠️ 经典大坑演示：`@Published` 不监听 class 内部成员变更

```
class User {
    var name: String
    init(name: String) { self.name = name }
}

class BadVM: ObservableObject {
    // User 是 class 引用类型
    @Published var user: User = User(name: "小红")
    
    func changeName() {
        // ❗只是修改对象内部字段，没有给 user 重新赋值
        user.name = "小红改名"
        // 界面不会刷新！
    }
}
```

原因：`@Published` 监听**属性赋值**，不是引用对象内部修改。
两种修复方案：

1. User 改成 struct 值类型（推荐）
2. 手动发送通知：`objectWillChange.send()`

---

## 4. @EnvironmentObject：跨多层隐式共享全局状态

✅ 适用：App 全局状态，登录用户、全局主题配置；跳过多层传参。
✅ 所有权：在祖先视图注入，全局环境持有。
✅ 风险：隐式依赖，编译器不检查，忘记注入直接崩溃，滥用等于全局变量。

```
// 全局状态
class GlobalStore: ObservableObject {
    @Published var isLogin = false
    @Published var userName: String?
}

// 入口注入（比如在App入口）
@main
struct DataFlowApp: App {
    @StateObject private var store = GlobalStore()
    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store) // 注入环境
        }
    }
}

// 中间层视图：不需要传参
struct MiddleView: View {
    var body: some View {
        DeepChildView()
    }
}

// 深层子视图，直接读取全局
struct DeepChildView: View {
    @EnvironmentObject var store: GlobalStore
    
    var body: some View {
        VStack {
            if store.isLogin {
                Text("欢迎：\(store.userName ?? "")")
                Button("退出登录") {
                    store.isLogin = false
                    store.userName = nil
                }
            } else {
                Button("登录") {
                    store.isLogin = true
                    store.userName = "全局用户"
                }
            }
        }
    }
}
```

流向：

1. 任意子视图修改 `store` 里 `@Published` 属性
2. 所有在环境中拿到这个 `GlobalStore` 的视图全部自动刷新> 
> 限制：同一个类型，环境里只能有一个实例。业务页面临时共享状态不要用它。

---

## 5. @AppStorage：持久化状态（UserDefaults包装）

```
struct SettingView: View {
    // 自动读写UserDefaults，变更自动刷新视图，重启App数据保留
    @AppStorage("darkMode") private var darkMode = false
    
    var body: some View {
        Toggle("深色模式", isOn: $darkMode)
    }
}
```

本质是 `@State` 的持久化变种，数据流行为和 `@State` 几乎一致。适合简单配置。

---

# 综合实战：一个完整MVVM页面，多种数据流组合

需求：页面展示用户信息，一个开关控制编辑模式；编辑框双向绑定名字，保存按钮调用ViewModel。

```
class ProfileVM: ObservableObject {
    @Published var nickName = "阿泽"
    @Published var saving = false
    
    func save() async -> Bool {
        saving = true
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        saving = false
        return true
    }
}

struct ProfileView: View {
    // 页面业务VM
    @StateObject private var vm = ProfileVM()
    // 页面本地UI状态：是否开启编辑
    @State private var isEdit = false
    
    var body: some View {
        VStack(spacing: 16) {
            Toggle("开启编辑模式", isOn: $isEdit)
            
            if isEdit {
                // 双向绑定VM里的属性
                TextField("昵称", text: $vm.nickName)
                    .textFieldStyle(.roundedBorder)
                
                Button("保存") {
                    Task {
                        _ = await vm.save()
                    }
                }
                .disabled(vm.saving)
            } else {
                Text("昵称：\(vm.nickName)")
            }
            
            if vm.saving {
                ProgressView("保存中...")
            }
        }
        .padding()
    }
}
```

数据流梳理：

1. `isEdit`：页面本地 UI 开关，`@State`，只控制编辑UI显示
2. `vm.nickName`：业务数据，`@Published`，ViewModel持有
3. TextField 使用 `$vm.nickName`：生成 Binding，双向修改VM内发布属性
4. 点击保存：调用ViewModel异步方法，修改 `saving` 驱动加载UI

> 
> 这个就是 SwiftUI MVVM 最日常的写法：
> ✅ 临时UI开关：`@State`
> ✅ 业务数据、网络逻辑：ViewModel + `@StateObject` + `@Published`
> ✅ 输入框：对VM属性做 `Binding`

---

# 数据流选型总结

| 包装器 | 数据归属 | 典型场景 |
| --- | --- | --- |
| @State | 当前视图私有 | 弹窗、开关、本地临时标记 |
| @Binding | 上游视图 | 通用组件双向输入 |
| @StateObject | 当前视图持有VM | 当前页面业务ViewModel |
| @ObservedObject | 外部传入 | 接收上层传下来的VM |
| @EnvironmentObject | 环境全局 | 登录态、全局主题 |
| @AppStorage | UserDefaults | 简单持久化配置 |

---

# 关键思考方式

写 SwiftUI 页面，第一步先找**单一数据源**：

1. 这个数据是谁的？页面本地UI？业务？全局？
2. 谁要修改它？
3. 子视图是只展示，还是可以修改？
再决定用哪一套数据流原语，而不是上来就随便写 `@EnvironmentObject`。

