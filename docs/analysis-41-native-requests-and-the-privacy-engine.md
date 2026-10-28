# Analysis 41: requests made by plugins' main-process code and the privacy engine

Written on 2026-10-26, while reviewing Neversleeper's branch `Neversleeper/plugins-tab` before joining it (it brought the native bridge of `analysis-29`). The owner asked for the fix as a separate commit after the merge.

## 1. The finding

`host.fetch` of `src/main/nativeHost.ts` is the only way a plugin's main-process code reaches the network. Neversleeper's wiring in `electronGlue.ts` made it with **Node's `fetch`**. Checked in the code:

| What the privacy engine does | Does it reach a request made with Node's `fetch` in the main process? |
|---|---|
| The request hub (`session.webRequest`): firewall shields, the owner's blocked sites, the token guard | **No**: it only sees what Chromium's network stack sends |
| The list of recent blocks and the counters ("Blocked by your rules") | **No**, they are fed by the hub |
| Encrypted DNS (`app.configureHostResolver`) | **No**: it configures Chromium's resolver; Node's `fetch` uses the system's DNS |

So a plugin with native code that declares a site could reach a site the owner had blocked, without a count and without a line in the list, and its lookups ignored the DNS choice. For the plugin that exists today (Pinterest Tool: `*.pinterest.com`, `i.pinimg.com`, `s.pinimg.com`) that would only matter if the owner blocked one of those, but the rule of the engine ("what the owner blocks stays blocked") has to hold for every plugin that comes next.

## 2. The fix (small, in our zone)

- The real request is made by **Chromium's network stack** (`net.fetch`), the one the encrypted DNS choice configures.
- Before each request, and so before **each redirect hop** (the host calls the function again for every hop), the address is checked against the owner's **blocked sites** (`makeNativeFetch`, `src/main/nativeFetch.ts`). A hit stops the request with a plain error ("`<host>` is on the list of sites you blocked.") and tells the firewall (`noteOwnBlock`), so it is **counted** under "Blocked by your rules" and **listed** in Recent blocks with the rule's host, the method and the path shape (never a query).
- Fail rule as everywhere: a check that fails lets the request go on; a counting that fails still stops the request.
- Nothing changes for plugins without native code.

## 3. What this does not do (said openly)

- **The shields (telemetry hosts) do not apply** to native requests: a plugin declares its own sites, and none of them is a telemetry host. Only the owner's blocked sites are enforced.
- **Native code is not sandboxed.** A plugin's main-process module is code bundled at build time and chosen by the owners; it runs with the rights of the main process. `host.fetch` limits what a well-behaved module can reach, but a module that imports the network by itself is not stopped here. The protection is the review of what is bundled (and the build's scan of native code that Neversleeper's branch adds, **not read by me in detail**).
- **The name of the caller is a claim** (documented by Neversleeper in `nativeHost.ts`): all plugins share one page, so another plugin could call a declared function of Pinterest Tool or overwrite or clear its declared secret. Secrets are never given back to the page; they are encrypted with Windows' own storage, which another program of the same Windows user can also ask to decrypt.
- **Not verified:** that `net.fetch` of this Electron version honours `redirect: "manual"` for every redirect kind, and that its lookups use the DoH choice (they should, the resolver is the same); both need a real run with a plugin that has native code and the encrypted DNS on, on the owner's Stable.

## 4. Tests

`tests/nativeFetch.test.ts`: passes what no rule covers unchanged; stops a blocked site before anything is sent; tells the firewall the rule, the method and only the path; checks every hop; refuses a bad address; fails open when the check fails; still stops when counting fails; the firewall counts it as "host-rules", lists it, bounds the log, and does not touch the shield counters.
