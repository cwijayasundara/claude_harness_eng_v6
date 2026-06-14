# Security reference — React / TypeScript / Node

Language-specific vulnerability patterns to scan for, on top of the generic OWASP categories. An exploitable instance is typically critical/high (BLOCK).

- **XSS / DOM injection**: `dangerouslySetInnerHTML` without sanitization (DOMPurify); `.innerHTML`/`outerHTML`/`document.write`/`insertAdjacentHTML` with untrusted data; `href`/`src` set to `javascript:` or a user-controlled URL.
- **Dynamic execution**: `eval`, `new Function`, `setTimeout`/`setInterval` with a string arg.
- **Prototype pollution**: deep-merge/`Object.assign`/`lodash.merge` of untrusted JSON into objects; bracket assignment with a user key (`obj[userKey]=…`) reaching `__proto__`/`constructor`.
- **Secrets in the client bundle**: real secrets behind `VITE_*` / `NEXT_PUBLIC_*` (these ship to the browser); API keys/tokens hardcoded in frontend source.
- **Token storage**: auth tokens in `localStorage`/`sessionStorage` (XSS-exfiltratable) — prefer httpOnly cookies; tokens logged to console.
- **postMessage**: `window.addEventListener('message', …)` without checking `event.origin`; `postMessage(…, '*')` to an untrusted target.
- **Tabnabbing**: `target="_blank"` without `rel="noopener noreferrer"`.
- **Node/SSR (Next API routes, Express)**: SQL/NoSQL injection via string-built queries; command injection via `child_process.exec`; SSRF via `fetch`/`axios` to user URLs; path traversal in `fs` with request input; missing auth on API routes; permissive CORS (`origin: '*'` with credentials).
- **Dependencies**: run `npm audit --json` and flag high/critical advisories.
