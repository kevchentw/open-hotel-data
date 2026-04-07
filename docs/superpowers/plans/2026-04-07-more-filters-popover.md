# More Filters Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Brand, Reviews, and Amenities filters behind a `+ More` popover button so all toolbar controls fit in one row.

**Architecture:** The More button is the last item in the toolbar grid. Clicking it toggles a `position: absolute` panel (reusing existing `.filter-dropdown__panel` styles) that contains the three moved filters stacked vertically. State and event listeners for those filters are unchanged — only their DOM location moves.

**Tech Stack:** Vanilla JS, CSS Grid, existing `.filter-dropdown__panel` / `.filter-toggle-btn` patterns.

---

### Task 1: Add More panel CSS styles

**Files:**
- Modify: `src/styles.css:177-194` (toolbar grid columns)
- Modify: `src/styles.css:219-221` (after `.filter-dropdown` block — add new rules)

- [ ] **Step 1: Update toolbar grid from 8 columns to 7**

In `src/styles.css`, replace the `.toolbar` `grid-template-columns` block:

```css
/* OLD */
.toolbar {
  margin: 10px -18px 0;
  padding: 10px 18px 0;
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns:
    minmax(0, 1.35fr)
    minmax(0, 0.75fr)
    minmax(0, 0.75fr)
    minmax(0, 0.75fr)
    minmax(0, 0.9fr)
    minmax(0, 0.7fr)
    minmax(0, 0.9fr)
    minmax(0, 0.8fr);
  gap: 10px;
  position: relative;
  z-index: 20;
}
```

```css
/* NEW */
.toolbar {
  margin: 10px -18px 0;
  padding: 10px 18px 0;
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns:
    minmax(0, 1.35fr)
    minmax(0, 0.8fr)
    minmax(0, 0.8fr)
    minmax(0, 1fr)
    minmax(0, 0.75fr)
    minmax(0, 1fr)
    minmax(0, 0.7fr);
  gap: 10px;
  position: relative;
  z-index: 20;
}
```

- [ ] **Step 2: Add More wrapper and panel styles**

After the `.filter-dropdown { position: relative; }` rule (~line 219 in `src/styles.css`), add:

```css
.more-filters-wrapper {
  position: relative;
}

.more-filters-panel {
  padding: 16px;
  display: grid;
  gap: 12px;
  min-width: 260px;
}
```

- [ ] **Step 3: Verify visually in browser**

Open `http://localhost:5173` (or the dev server URL) and confirm the toolbar still renders without breakage. No functional changes yet.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "style: update toolbar grid to 7 columns, add more-filters panel styles"
```

---

### Task 2: Restructure HTML — move Brand, Reviews, Amenities into More panel

**Files:**
- Modify: `src/main.js:1861-1933` (toolbar HTML template)

- [ ] **Step 1: Remove Brand label from the toolbar HTML**

In `src/main.js`, delete these 4 lines (~line 1861-1864):

```js
        <label class="toolbar-group">
          <span>Brand</span>
          <select id="brand-select"></select>
        </label>
```

- [ ] **Step 2: Remove Reviews label from the toolbar HTML**

In `src/main.js`, delete these 4 lines (~line 1911-1914, now shifted up by 4 after Step 1):

```js
        <label class="toolbar-group">
          <span>Reviews</span>
          <button id="forum-review-filter-btn" class="filter-toggle-btn" type="button">Has forum review</button>
        </label>
```

- [ ] **Step 3: Replace Amenities label with the More button + panel**

In `src/main.js`, replace the entire Amenities `<label>` block:

```js
        <label class="toolbar-group toolbar-group--amenities">
          <span>Amenities</span>
          <div class="filter-dropdown" id="amenities-dropdown">
            <button
              id="amenities-toggle"
              class="filter-dropdown__toggle"
              type="button"
              aria-haspopup="true"
              aria-expanded="false"
            >
              Any amenities
            </button>
            <div id="amenities-panel" class="filter-dropdown__panel" hidden>
              <div id="amenities-menu" class="filter-dropdown__menu"></div>
            </div>
          </div>
          <small id="amenities-info" hidden></small>
        </label>
```

With:

```js
        <label class="toolbar-group">
          <span>More</span>
          <div class="more-filters-wrapper" id="more-filters-wrapper">
            <button id="more-filters-btn" class="filter-toggle-btn" type="button" aria-expanded="false">+ More</button>
            <div id="more-filters-panel" class="filter-dropdown__panel more-filters-panel" hidden>
              <label class="toolbar-group">
                <span>Brand</span>
                <select id="brand-select"></select>
              </label>
              <label class="toolbar-group">
                <span>Reviews</span>
                <button id="forum-review-filter-btn" class="filter-toggle-btn" type="button">Has forum review</button>
              </label>
              <label class="toolbar-group toolbar-group--amenities">
                <span>Amenities</span>
                <div class="filter-dropdown" id="amenities-dropdown">
                  <button
                    id="amenities-toggle"
                    class="filter-dropdown__toggle"
                    type="button"
                    aria-haspopup="true"
                    aria-expanded="false"
                  >
                    Any amenities
                  </button>
                  <div id="amenities-panel" class="filter-dropdown__panel" hidden>
                    <div id="amenities-menu" class="filter-dropdown__menu"></div>
                  </div>
                </div>
                <small id="amenities-info" hidden></small>
              </label>
            </div>
          </div>
        </label>
```

- [ ] **Step 4: Verify in browser**

Confirm the toolbar shows Search, Chain, Country, Also eligible for, Sort, tab-specific, and `+ More` in one row. The More button does nothing yet (no JS wired). Brand/Reviews/Amenities are gone from the main row.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: move Brand/Reviews/Amenities into More popover panel (HTML only)"
```

---

### Task 3: Wire up JS — More button toggle, outside-click, badge

**Files:**
- Modify: `src/main.js:1978-1999` (dom object)
- Modify: `src/main.js:2081-2107` (event listeners)
- Modify: `src/main.js:1761` (render function — badge update call)

- [ ] **Step 1: Add dom references for More button and panel**

In `src/main.js`, find the `dom = { ... }` object (~line 1970). After the existing `amenitiesInfo` entry, add two new entries:

Find:
```js
    amenitiesInfo: document.querySelector("#amenities-info"),
```

Replace with:
```js
    amenitiesInfo: document.querySelector("#amenities-info"),
    moreFiltersBtn: document.querySelector("#more-filters-btn"),
    moreFiltersPanel: document.querySelector("#more-filters-panel"),
    moreFiltersWrapper: document.querySelector("#more-filters-wrapper"),
```

- [ ] **Step 2: Add More button click handler**

In `src/main.js`, after the `amenitiesToggle` click handler (~line 2085):

```js
  dom.amenitiesToggle.addEventListener("click", () => {
    const isOpen = !dom.amenitiesPanel.hidden;
    dom.amenitiesPanel.hidden = isOpen;
    dom.amenitiesToggle.setAttribute("aria-expanded", String(!isOpen));
  });
```

Add immediately after:

```js
  dom.moreFiltersBtn.addEventListener("click", () => {
    const isOpen = !dom.moreFiltersPanel.hidden;
    dom.moreFiltersPanel.hidden = isOpen;
    dom.moreFiltersBtn.setAttribute("aria-expanded", String(!isOpen));
  });
```

- [ ] **Step 3: Update outside-click listener to also close More panel**

Find the existing outside-click listener (~line 2095):

```js
  document.addEventListener("click", (event) => {
    if (!dom.amenitiesDropdown.contains(event.target)) {
      dom.amenitiesPanel.hidden = true;
      dom.amenitiesToggle.setAttribute("aria-expanded", "false");
    }
  });
```

Replace with:

```js
  document.addEventListener("click", (event) => {
    if (!dom.amenitiesDropdown.contains(event.target)) {
      dom.amenitiesPanel.hidden = true;
      dom.amenitiesToggle.setAttribute("aria-expanded", "false");
    }
    if (!dom.moreFiltersWrapper.contains(event.target)) {
      dom.moreFiltersPanel.hidden = true;
      dom.moreFiltersBtn.setAttribute("aria-expanded", "false");
    }
  });
```

- [ ] **Step 4: Update Escape key listener to also close More panel**

Find the existing keydown listener (~line 2102):

```js
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dom.amenitiesPanel.hidden = true;
      dom.amenitiesToggle.setAttribute("aria-expanded", "false");
    }
  });
```

Replace with:

```js
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dom.amenitiesPanel.hidden = true;
      dom.amenitiesToggle.setAttribute("aria-expanded", "false");
      dom.moreFiltersPanel.hidden = true;
      dom.moreFiltersBtn.setAttribute("aria-expanded", "false");
    }
  });
```

- [ ] **Step 5: Add updateMoreFiltersBadge function**

In `src/main.js`, find the `render` function (around line 1738). Add a new function just before it:

```js
function updateMoreFiltersBadge() {
  const activeCount = [
    state.brand !== "all",
    state.hasForumReview,
    state.amenities.length > 0,
  ].filter(Boolean).length;
  dom.moreFiltersBtn.textContent = activeCount > 0 ? `More · ${activeCount}` : "+ More";
  dom.moreFiltersBtn.classList.toggle("is-active", activeCount > 0);
  dom.moreFiltersBtn.setAttribute("aria-expanded", String(!dom.moreFiltersPanel.hidden));
}
```

- [ ] **Step 6: Call updateMoreFiltersBadge in the render function**

In `src/main.js`, find the line in `render` that sets the forum review button active state (~line 1761):

```js
  dom.forumReviewFilterBtn.classList.toggle("is-active", state.hasForumReview);
```

Add a call immediately after:

```js
  dom.forumReviewFilterBtn.classList.toggle("is-active", state.hasForumReview);
  updateMoreFiltersBadge();
```

- [ ] **Step 7: Verify full behavior in browser**

Check:
- Clicking `+ More` opens the panel with Brand, Reviews, Amenities
- Clicking outside the panel closes it
- Pressing Escape closes it
- Selecting a brand → button shows `More · 1` and turns green
- Toggling forum review → count updates
- Selecting amenities → count updates
- All three active → button shows `More · 3`
- Resetting all three → button shows `+ More` (not active)
- Amenities sub-dropdown opens inside the panel without closing the More panel

- [ ] **Step 8: Commit**

```bash
git add src/main.js
git commit -m "feat: wire More filters popover — toggle, outside-click, badge count"
```
