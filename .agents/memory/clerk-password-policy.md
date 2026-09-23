---
name: Clerk password policy boundary
description: What FloraWise can validate locally versus what the managed Clerk auth service controls.
---

FloraWise's API server does not receive registration passwords because browser registration is handled by Clerk. Client-side registration may pre-validate the product's password rules, but the final server-side decision comes from Clerk's password settings.

**Why:** Adding a password schema to FloraWise's API would not protect the actual registration endpoint and could give a false impression that the managed auth policy changed.

**How to apply:** Keep frontend checks aligned with the requested policy, use Clerk's sign-up/password call for server enforcement, and treat exact Clerk policy changes as managed-auth configuration rather than an API route change.