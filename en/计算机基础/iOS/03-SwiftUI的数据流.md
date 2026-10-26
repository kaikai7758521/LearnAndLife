---
title: "SwiftUI data flow"
lang: en
translatedFrom: cd2139b0098234514f7b9c64140700b75f9bee638b7f134203be46ed56a3550c
translatedAt: 2026-10-26
---

# SwiftUI data flow

The core principles are reiterated first:

> 
> **Single data source, data flows downward, and events are fed back upward; View = f(State)**
The essence of all > wrappers is the **state dependency tracking mechanism**: state changes → find the view node that depends on it → automatically refresh.

We follow the order of use of data flows, from the simplest to multi-layer sharing, and provide runnable examples one by one. At the same time, we explain clearly: when **is used, who owns the data, where it flows after modification, and where the pitfalls are in**.

---

## 1. @State: View private local state (simplest)

✅ Applicable: Temporary UI state that only belongs to the current view, pop-up window switch, counter, input box, expand and collapse mark.
✅ Ownership: **The current view owns**, SwiftUI runtime managed storage.
✅ Features: It can only be created in this view and cannot be obtained from outside; `$` binding can be generated and passed to subviews.

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

Flow direction:

1. user clicks the button → modify `count`
2. `@State` Notifies the SwiftUI runtime that this state has changed
3. marks nodes that depend on this status as dirty
4. Re-execute body and refresh the interface

> 
> Pitfalls: Don’t throw network data and complex business models into `@State`, which is suitable for lightweight value types.

---

## 2. @Binding: two-way binding, the subview does not own the data, only proxy reading and writing

✅ Applicable: Extract common UI components (custom switches, input boxes, pop-up windows), and the components themselves do not hold data sources.
✅ Ownership: The **data source is always in the upper layer**, and Binding is just a read-write agent.
✅ Memory: `@State` is the landlord, `@Binding` is the tenant, and the tenant has no property rights.

Example: Extract the counter button into independent subcomponents

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

Flow direction:

1. subview click button → modify `count` by `Binding`
The 2. modification will penetrate back to the upstream original `@State`
3. Upstream status change → Upstream, all subviews that depend on this status are refreshed together

> 
> Important: The refresh source is not Binding, but the original `@State` / `@Published`. Binding itself does not publish changes.

> 
> Compare the one-way callback writing method (many teams recommend it first, it is clearer)

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

👉 One-way callback: data is transmitted downwards and events are transmitted upwards; **makes it easier to track the data flow. For large projects,** is preferred.
👉 @Binding: Implicit bidirectional, short to write, suitable for general basic controls.

---

## 3. ObservableObject + @Published + @StateObject: Page business ViewModel (MVVM standard)

✅ Applicable to: page business logic, network requests, complex states, which require encapsulation methods.
✅ Ownership: `@StateObject` creates and holds this class object in the current view, and the life cycle is managed by SwiftUI.
✅ `@Published`: Automatically send `objectWillChange` before attribute modification to notify the view to refresh.

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

Flow direction:

1. The user clicks the button → calls vm.rename()
2. vm modifies `loading`, `username` (`@Published` attributes)
3. automatically sends `objectWillChange`
4. monitors the view of this VM to receive notification and triggers body refresh

### @ObservedObject comparison (high frequency interview)

`@ObservedObject`: **only listens to the external ObservableObject passed in, and the view does not hold it**

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

❌ Prohibited writing:

```
// 错误！视图刷新时会反复新建VM，数据丢失
@ObservedObject var vm = UserViewModel()
```

> 
> distinguishes in one sentence:
> 
> 
> - Create instance inside view → `@StateObject`
> - External incoming instance, I just listen → `@ObservedObject`

⚠️ Classic pitfall demonstration: `@Published` does not monitor changes in class internal members

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

Reason: `@Published` monitors the **attribute assignment to**, which is not an internal modification of the reference object.
Two repair options:

1. User changed to struct value type (recommended)
2. Manually send notification: `objectWillChange.send()`

---

## 4. @EnvironmentObject: Implicitly share global state across multiple layers

✅ Applicable to: App global status, logged in users, global theme configuration; skip multi-layer parameter transmission.
✅ Ownership: Injected in ancestor view, held by global environment.
✅ Risks: Implicit dependencies, the compiler does not check, forget to inject and crash directly, abuse of global variables.

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

Flow direction:

1. Modifies the `@Published` attribute in `store` in any subview
2. All views that get this `GlobalStore` in the environment are automatically refreshed>
> Limitation: There can only be one instance of the same type in the environment. Do not use it for temporary sharing status of business pages.

---

## 5. @AppStorage: Persistent state (UserDefaults packaging)

```
struct SettingView: View {
    // 自动读写UserDefaults，变更自动刷新视图，重启App数据保留
    @AppStorage("darkMode") private var darkMode = false
    
    var body: some View {
        Toggle("深色模式", isOn: $darkMode)
    }
}
```

It is essentially a persistent variant of `@State`, and the data flow behavior is almost the same as `@State`. Suitable for simple configuration.

---

# Comprehensive practice: a complete MVVM page, multiple data stream combinations

Requirements: The page displays user information, a switch controls the editing mode; the edit box is bidirectionally bound to the name, and the save button calls ViewModel.

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

Data flow sorting:

1. `isEdit`: Page local UI switch, `@State`, only controls the editing UI display
2. `vm.nickName`: business data, `@Published`, held by ViewModel
3. TextField uses `$vm.nickName`: generate Binding and bidirectionally modify the publishing properties in the VM
4. Click to save: call the ViewModel asynchronous method and modify the `saving` driver loading UI

> 
> This is the most common way to write SwiftUI MVVM:
> ✅ Temporary UI switch: `@State`
> ✅ Business data, network logic: ViewModel + `@StateObject` + `@Published`
> ✅ Input box: do `Binding` on VM attributes

---

# Data flow selection summary

| wrapper | data ownership | typical scenario |
| --- | --- | --- |
| @State | Current view private | Pop-up window, switch, local temporary mark |
| @Binding | Upstream view | Universal component bidirectional input |
| @StateObject | The current view holds VM | The current page business ViewModel |
| @ObservedObject | External incoming | Receives VM | passed from the upper layer
| @EnvironmentObject | Environment global | Login state, global theme |
| @AppStorage | UserDefaults | Simple persistence configuration |

---

# Key Ways of Thinking

To write a SwiftUI page, the first step is to find the **single data source**:

1. Whose data does this belong to? Page local UI? business? The big picture?
2. Who wants to modify it?
3. Is the subview only displayed, or can it be modified?
Then decide which set of data flow primitives to use instead of just writing `@EnvironmentObject`.
