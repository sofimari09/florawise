---
name: Plant photo policy
description: Product constraints for durable private plant photo storage.
---

Store plant photo bytes in App Storage, and only paths and metadata in PostgreSQL. Do not substitute local disk files or database base64 storage if provisioning fails. Preserve existing Clerk authentication instead of adopting the object-storage template's Replit Auth instructions.

**Why:** The user explicitly requires permanent storage, private owner access, additive database changes without data loss, and compatibility with existing photo URLs.

**How to apply:** Apply these constraints to future photo or upload changes. Existing external photo URLs must keep working; private uploaded photos must require a real owner session, not the shared development demo identity.
