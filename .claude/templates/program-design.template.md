# Program design

Types, signatures, call stacks, and file layout the implementer is bound by.
The human approved this file — not an implied architecture in the stories.

## Types

```
# Name the domain types and their fields. Example:
# Link { id, ownerId, targetUrl, code, expiresAt?, createdAt }
```

## Signatures

```
# Public functions the stories need. Example:
# createLink(ownerId, targetUrl, expiresAt?) -> Link
# resolveCode(code) -> { location, status } | NotFound | Gone
```

## Call stack

```
# Tree of the hot path. Prefix + for new, - for removed, space for existing.
# POST /api/links
#   createLink
#     validateTarget
#     generateCode
#     LinkRepo.insert
```

## File tree

```
# src/
# +  links/
# +    create.ts
# +    resolve.ts
# ~  app.ts          # wires the two routes
```
