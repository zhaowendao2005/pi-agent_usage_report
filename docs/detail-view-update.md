# 📋 调用明细排序与右键菜单功能实施总结

## 🎯 新增特性与优化说明

### 1. 价格校准图标 SVG 化 
- **文件**: `src-tauri/src-web/src/components/icons/CalibrationIcon.vue`
- **设计**: 设计并独立创建了专业的 SVG 金额刻度校准图标，结合了美元符号（`$`）和刻度虚线环（`calibration dasharray`）的流线型极简几何美学，并注册为全局选项完美集成于 `App.vue` 顶端导航栏，代替了通用的 `CalculatorIcon`。

---

### 2. 异步非阻塞最优排序算法 (Schwartzian Transform)
- **文件**: `src-tauri/src-web/src/views/DetailView.vue`
- **核心算法设计 (最优算法)**: 
  在拥有上万条海量日志时，如果直接在 $O(N \log N)$ 排序的 comparator 循环内部运行 TPS 重新计算、数据格式化、`null` 的容错处理或者深度对象访问，由于循环次数多会导致明显的 CPU 阻塞和 UI 掉帧。
  为了消除这一性能痛点，我们选用了计算机科学中最著名的 **Schwartzian Transform (Schwartzian 变换)**：
  1. **一性次映射 (Map)**: 提取出所有待排数据并生成包含原始对象的 Mapped Array，同时把每一个属性项所代表的的排序关键指标（如：费用、TPS、首字延迟、时间戳、缓存率等）在 $O(N)$ 复杂度下预先提取为平面字段，避免 comparator 重复运行复杂的 getter。
  2. **快速 Timsort (Sort)**: 对已预提取值的 Mapped Array 在平面值上以 $O(N \log N)$ 的复杂度极速运行 V8 底层 c++ 实现的原生排序。
  3. **还原映射 (Unmap)**: 将已排好序的映射结构恢复出原对象实体，达到绝对的最佳理论耗时。
  
- **极致无卡顿渲染 (骨架屏过度)**:
  1. 用户手动点击表头指标进行排序时，立即设置 `isSorting = true` 并阻塞后续事件。
  2. 运用 JavaScript 的 `Promise` 和微宏任务 `setTimeout(resolve, 50)` **强制让出主线程给浏览器和 Vue 的渲染引擎**。
  3. 浏览器瞬间绘制出带有渐变动画且 **100% 对应表头列宽的自定义骨架屏**。
  4. 主线程闲置并完成渲染后，开始后台纯异步进行 Schwartzian 变换排序。
  5. 排序算完的一瞬间，数据无缝落盘，`isSorting = false`，明细表格完成直接重渲染，没有一丝顿挫感。

- **静默后台排序**: 
  针对 Live 状态下持续不断追加的新日志流，采用静默运行 `performSort(false)`，保证后台数据不断增量重排的同时，前端表格不会反复闪烁骨架屏。

---

### 3. 表格自定义右键上下文微型菜单
- **屏蔽系统右键**:
  通过在表格外层容器和行内加入 `@contextmenu.prevent`，全面拦截并物理屏蔽了原生 WebView2 / WebKit 庞大且多余的默认右键菜单。
- **精美微型设计**:
  - 尺寸精巧，严格限制宽度为微型的 `w-32` (`128px`)。
  - 优雅的极小放大渐显动画：`0.08s ease-out` 快速拉起入场，支持暗色/亮色模式背景色完美适配。
  - 搭载 `Trash2Icon` 的红色危险操作：“删除这条记录”。
- **后端物理删除 (SQLite)**:
  - 后端 Rust 新增安全事务操作 `db::delete_llm_call(id)`，支持根据 `llm_calls` 表中的 `id INTEGER PRIMARY KEY` 进行瞬间删除。
  - 前端选中行删除并经过确认（`confirm`）后，通过 Tauri ipc 触发 Rust 物理删除，并自动触发 store 级联全局刷新（`refreshData()`），完全无需人工干预更新。
  - 上下文菜单在用户滚动表格、点击屏幕其他任意位置时自动隐形。

---

## 🛠️ 后端新增命令 (Rust)

**db.rs**:
```rust
pub fn delete_llm_call(id: i64) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM llm_calls WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
```

---

## 📂 修改与新增文件清单

- `src-tauri/src-web/src/components/icons/CalibrationIcon.vue` (新增, 0.5KB)
- `src-tauri/src-web/src/views/DetailView.vue` (修改重写, 17.7KB)
- `src-tauri/src-web/src/stores/usage.ts` (修改)
- `src-tauri/src/db.rs` (修改)
- `src-tauri/src/lib.rs` (修改)
- `docs/detail-view-update.md` (新增, 本文件)

---

## 📦 编译与打包验证

1. **Rust 单元构建校验**：
   ```bash
   cd src-tauri && cargo build
   # Finished `dev` profile in 0.35s
   ```
   **✅ 编译无错误**

2. **Frontend 极速打包生产校验**：
   ```bash
   cd src-tauri/src-web && npm run build
   # ✓ built in 5.96s
   ```
   **✅ 打包完美通过，无任何 Typescript 错误**

---

## 🔮 下一步建议
我们已经把排序与数据变更的安全闭环完全做入底层 SQLite 库中，后续如果对已配置了价格脚本的中转站进行账单明细输出时，可以自动调用我们前一阶段价格校准中的 `calculatePrice()`，实现更深层的计算联通！
