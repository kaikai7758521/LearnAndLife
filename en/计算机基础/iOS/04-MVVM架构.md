---
title: "MVVM architecture"
lang: en
translatedFrom: 99a3ce67adb3c7ae59b27af304d389082b8610a7b8f3f9657171057d4d89bbee
translatedAt: 2026-10-26
---

# MVVM architecture
> Pre-convention: MVVM = Model - View - ViewModel.
> SwiftUI is naturally an MVVM paradigm. Relying on responsive capabilities such as `@Observable` / `@StateObject` is the best carrier for understanding MVVM.
> Important premise: **SwiftUI's View is essentially a declarative view description structure, not a UI control object**. This is fundamentally different from UIKit/WPF's View, as will be reflected in the examples below.

## 1. The precise responsibilities of each layer of MVVM (details)
### 1. Model
Model represents **domain data and pure business rules**, and is the lowest and most stable layer in the entire architecture.
✅ Boundaries of responsibilities:
- stores original data entities (structures, data models)
- encapsulates data verification, data conversion, persistence, and network request logic
- **is completely unaware of the existence of View and ViewModel** and does not hold any UI related references
- only cares about "what the data is, how the data comes from, and how the data is verified", and does not care about who the data is displayed to or how it is displayed.
- Model is a pure data and business entity that can be reused across layers and modules.

❌ Model does not do:
UI formatting, page status control, button click response, pop-up window switch.

> Example: User model, only id, name, email; login interface request function, password verification rules.

### 2. View
View in SwiftUI is **declarative view description**.
✅ Boundaries of responsibilities:
- ’s only job: describe what the page looks like, layout, colors, and control arrangement
- Reads status from ViewModel for rendering; forwards user interaction events to ViewModel
- View only relies on ViewModel, **prohibits direct access to Model**
- View should be as thin as possible, and do not write business logic, data calculations, or network requests.
- View is passive: once the ViewModel data changes, the View automatically refreshes

❌ View does not do:
Business judgment, interface calling, complex data formatting, and status calculation.

> Core: View is a "declaration of UI", not a controller.

### 3. ViewModel (core layer, view model)
ViewModel is the adapter and intermediary between Model and View, and is the soul of MVVM.
✅ Responsibility boundaries:
1. holds the Model and obtains original data from the Model;
2. processes the original Model data **into a UI state** suitable for View display (formatted date, spliced text, calculation mark, switch state, loading state, error prompt);
3. exposes the responsive state** of **that can be monitored by View;
4. exposes the actions that View can call (functions: login, refresh, submit);
5. ViewModel **does not hold View, does not know the existence of View**, and has no reference to any UI control;
6. All business logic and interaction logic related to the page are written here;
7. can do unit testing independently from View.

> key points to distinguish:
> Model: original business data
> ViewModel: **UI state + interactive behavior** for this page

> Two-way binding understanding (SwiftUI perspective)
> SwiftUI does not have the two-way binding syntactic sugar of WPF in the traditional sense, but `@Binding` + responsive data flow constitutes the binding relationship of MVVM:
> View reads the state rendering of VM; the input modification of View is written back to VM through binding; VM changes automatically drive View refresh.
The essence of > is still: **ViewModel as the only trusted data source**.

---

## 2. SwiftUI complete MVVM example (Swift 5.9+, @Observable new version)
Requirements: Make a simple user information page that can load user information, modify user names, and save.
Strict separation of layers: Model/ViewModel/View

```swift
import SwiftUI

// MARK: - Model
/// 领域模型：纯数据，和UI无关
struct User: Identifiable {
    let id: UUID
    var name: String
    var email: String
}

/// Model 服务：负责网络/数据获取（属于Model层能力）
class UserRepository {
    // 模拟网络请求
    func fetchUser() async throws -> User {
        try await Task.sleep(nanoseconds: 1_000_000_000)
        return User(id: UUID(), name: "小明", email: "xiaoming@example.com")
    }
    
    // 模拟保存
    func saveUser(_ user: User) async throws {
        try await Task.sleep(nanoseconds: 800_000_000)
    }
}

// MARK: - ViewModel
/// 视图模型：面向当前页面的UI状态与行为
@Observable
class UserViewModel {
    // 依赖 Model 服务
    private let repo = UserRepository()
    
    // UI状态：给View监听
    var user: User?
    var isLoading: Bool = false
    var errorMsg: String?
    
    // 供View调用的动作
    func loadUser() async {
        isLoading = true
        errorMsg = nil
        do {
            user = try await repo.fetchUser()
        } catch {
            errorMsg = "加载失败：\(error.localizedDescription)"
        }
        isLoading = false
    }
    
    func save() async {
        guard let user else { return }
        isLoading = true
        errorMsg = nil
        do {
            try await repo.saveUser(user)
            errorMsg = "保存成功"
        } catch {
            errorMsg = "保存失败：\(error.localizedDescription)"
        }
        isLoading = false
    }
}

// MARK: - View
/// 视图层：只负责声明UI，转发交互
struct UserView: View {
    @StateObject private var vm = UserViewModel()
    
    var body: some View {
        Form {
            if vm.isLoading {
                ProgressView("加载中...")
            } else if let err = vm.errorMsg {
                Text(err)
                    .foregroundColor(.red)
            } else if let user = vm.user {
                TextField("用户名", text: $vm.user.name)
                Text(user.email)
                    .foregroundColor(.secondary)
                
                Button("保存") {
                    Task { await vm.save() }
                }
            }
        }
        .onAppear {
            Task { await vm.loadUser() }
        }
    }
}

#Preview {
    UserView()
}
```

Key interpretation of ### Example
1. `@Observable` makes ViewModel responsive, and property changes automatically notify the Views that rely on it to refresh;
2. View `UserView` only holds ViewModel and does not touch `UserRepository` directly;
3. All asynchronous, loading logic, and error handling are in ViewModel;
4. View only has layout, controls and binding;
5. During unit testing, you can directly instantiate `UserViewModel` and call `loadUser()` without starting the SwiftUI view.

> Tip: If you use an old version of SwiftUI (iOS16 and below), replace `@Observable` with `ObservableObject` + `@Published`.

---

## 3. The evolution path of MVVM (from MVC → MVP → MVVM)
By clarifying the evolutionary chain, you can understand that MVVM solves the pain points of the previous architecture:
### 1. The earliest version of MVC (Model-View-Controller)
Classic backend MVC ported to client.
- Controller acts as a middleman; View can perceive Model
**pain points (UIKit typical problems)**:
The Controller continues to expand and become a "big ball of mud", commonly known as Massive View Controller. Business logic, UI logic, and data logic are all stacked in the Controller, which is extremely difficult to test.

### 2. MVP (Model-View-Presenter) was born to solve the bloated MVC
Goal: Isolate View and Model
- Presenter middle layer; View holds Presenter; Presenter holds View's protocol (ViewProtocol)
- Data flow is one-way: View events are handed over to Presenter → Presenter operates Model → Presenter callback View updates UI
**Pain Points**:
Presenter needs to manually call View's protocol method to refresh the interface, which requires a lot of boilerplate callback code; when there is a lot of page interaction, update callbacks are everywhere.

### 3. The birth of MVVM (first proposed by Microsoft WPF platform)
Microsoft introduced MVVM into the WPF framework. The core innovation: **uses the framework's built-in responsive binding mechanism to eliminate the manual refresh callback**.
- Remove the protocol reference to View in Presenter; ViewModel no longer holds View;
The - framework provides a binding system: ViewModel state changes automatically drive View;
- interactive input automatically flows back to ViewModel;
- no longer requires manual writing of `view.updateData()`;
- This is the most essential watershed between MVVM and MVP: **Presenter knows View; ViewModel does not know View**.

Follow-up: Front-end Vue, Android DataBinding/Compose, SwiftUI, and Flutter GetX all absorbed this set of ideas, and MVVM became the standard architecture of declarative UI frameworks.

Evolution is summarized in one sentence:
> MVC: Controller is too fat;
> MVP: Presenter needs to manually call back View;
> MVVM: Using responsive binding to automatically synchronize state, ViewModel is completely decoupled from View.

---

## 4. Core features of MVVM
1. **Complete separation of concerns**
Model: domain data; ViewModel: UI status and interaction logic; View: UI declaration. Everyone performs their duties and the boundaries are clear.

2. **ViewModel has no UI dependencies (core advantage)**
ViewModel does not import UIKit / SwiftUI (ideal design), does not have any UI object references, is a pure logic layer, and naturally supports unit testing.

3. **responsive driver, single trusted source of status**
The page state converges in the ViewModel, and the View is the projection of the state. Avoid states being scattered in various `@State` views, causing states to be out of sync.

4. **Views can be combined and ViewModels can be reused**
The same ViewModel can provide multiple different Views; the same View can switch services by replacing the ViewModel. For example: details page and pop-up preview page can share a set of ViewModel.

5. **clear data flow**
Standard one-way thinking (SwiftUI mainstream writing method):
User operation → View triggers VM method → VM modifies its own state → Responsive system automatically refreshes View
> Note: Many people confuse two-way binding. SwiftUI recommends one-way data flow. Binding is just syntactic sugar. Do not abuse two-way binding.

6. **Disadvantages (objective characteristics)**
- Simple pages will add boilerplate code and need to create additional ViewModels;
- Reactive systems have certain overhead;
- If the design gets out of control, ViewModel will also expand into Massive ViewModel;
- has requirements for developers: they need to distinguish what belongs to the Model and what belongs to the UI state (many people put UI fields into the Model).

---

## 5. Application scenarios of MVVM
### ✅ Great for MVVM
1. **Declarative UI framework project**: SwiftUI, Jetpack Compose, Vue, React (many of React are variants of MVVM), Flutter (GetX), the framework natively supports responsiveness and has the lowest cost.
2. **form page**: a large number of input boxes, linkage selection, verification, submission, loading, error status. Bindings can greatly reduce synchronization code.
3. **Rich interactive page**: list filtering, search real-time association, multi-Tab, pop-up window, loading/empty/error multi-state switching.
4. **Business modules that require unit testing**: The core business logic requires automated testing. It is a huge advantage that the ViewModel can be tested without the UI.
5. **Medium and large client project** with long-term multi-person iteration: layered specifications facilitate team collaboration, code review, and module splitting.
6. **The same business data is displayed in multiple forms**: such as product data, product cards, detail pages, sharing previews, and the same ViewModel is reused.

### ⚠️ Not suitable for MVVM
1. is an extremely simple static display page with almost no interaction and only displays a text and picture; building a VM is over-designed.
2. has strong animation and heavy underlying view rendering code (Metal, custom rendering pipeline). The core logic itself is View rendering logic, and the benefits of forced splitting are very low.
3. Ultra-small Demo, one-time script page, pursuing the fastest development speed.

---
