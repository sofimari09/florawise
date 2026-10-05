---
name: Clerk localization boundary
description: A development-only Clerk label that did not follow localization settings.
---

The Clerk sign-in development watermark still displayed “Development mode” after setting its Ukrainian localization value, while the surrounding sign-in strings translated correctly.

**Why:** This was observed in the running preview. Do not assume every visible Clerk label follows the supplied locale, or claim complete localization without checking the rendered screen.

**How to apply:** Recheck this behavior when updating Clerk. Preserve the requested layout rather than hiding or replacing provider-controlled labels through fragile DOM selectors.
