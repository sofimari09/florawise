---
name: React select automation
description: A Chromium CDP testing quirk for controlled React select elements.
---

When controlling a React `<select>` through Chromium CDP, use actual focus and keyboard selection rather than setting `.value` and dispatching a synthetic `change` event.

**Why:** Direct DOM assignment and synthetic change events did not update the controlled selection in browser testing, while keyboard events did.

**How to apply:** Focus the select, move to the desired option with CDP `Input.dispatchKeyEvent`, and verify the resulting selected value before continuing the test.
