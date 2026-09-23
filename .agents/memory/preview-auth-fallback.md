---
name: Preview auth fallback
description: Development behavior when the API supplies a demo user without a real Clerk session.
---

The development preview uses a backend demo-user fallback when there is no Clerk session. A normal Clerk sign-out alone cannot persist the signed-out screen because the next request still returns that demo user.

**Why:** Without a client-side signed-out marker, redirecting to the landing page immediately redirects back to the dashboard.

**How to apply:** Preserve the local preview signed-out marker across the landing-page request, and clear it when a real Clerk user becomes available.