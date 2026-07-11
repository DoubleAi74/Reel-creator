# Implementation Plan: R2 Presigned Background Video Upload + Cleanup

**Status:** **Implemented (v1)** — product decisions locked 2026-07-11  
**Goal:** Allow mobile (and desktop) to use background videos larger than the Vercel ~4.5 MB serverless body limit by uploading **directly to Cloudflare R2**, with **session-scoped cleanup**.  
**Date:** 2026-07-11  

### Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Max upload size | **80 MB** (`MAX_BACKGROUND_VIDEO_MB` default `80`) |
| 2 | Preview vs Remotion read | **Preview:** session-authenticated **proxy** (`GET /api/assets/:id` streams from R2). **Remotion/export:** **signed GET** (1–2 h) and/or download-to-temp for ffmpeg composite |
| 3 | Feature gate | **`R2_ENABLED=true`** is required. Optional **`R2_SESSION_ASSETS`** (default: on when R2 enabled; set `false` to disable session video R2 without turning off generation audio R2) |

---

## 1. Problem statement

### Today

```
Browser  --multipart POST /api/upload-->  Vercel serverless  -->  /tmp session disk
Preview/export  <--  GET /api/assets/:id  <--  same disk
```

- Vercel request body limit ≈ **4.5 MB** → large phone videos fail (often as vague errors).  
- App allowed up to 50 MB locally; production cannot honor that through the API body.  
- Multi-isolate: disk is **not shared** across instances (same class of bug as audio generate).

### Target

```
Browser  --POST presign-->  Vercel (tiny JSON)
Browser  --PUT file------>  R2 (large binary)
Browser  --POST complete--> Vercel (metadata only)
Preview/export  <-- signed/public URL or server proxy from R2
```

**Yes: video bytes live in R2.** The app stores only metadata (and optional short-lived signed read URLs).

---

## 2. Goals and non-goals

### Goals

1. Support background **video** uploads up to **80 MB**.  
2. Work on **Vercel production + mobile browsers**.  
3. Keep **session isolation** (one browser session cannot read another’s objects).  
4. **Cleanup** orphaned/expired objects so R2 does not grow without bound.  
5. Keep **preview + Remotion export** working with video backgrounds.  
6. Fail clearly when `R2_ENABLED=false` (no silent “success”).  
7. Prefer reusing existing **R2 client / env / lifecycle patterns**.

### Non-goals (v1)

- Replacing **audio** or **image** upload with R2 (can share infrastructure later).  
- Transcoding/compressing video on upload.  
- Public unlisted permanent hosting of backgrounds (session-scoped first).  
- Multipart multi-part S3 upload for 100 MB+ (single PUT is enough for **80 MB** v1).  
- Changing SumUp / credits.

---

## 3. Current code anchors (do not redesign blindly)

| Area | Location | Note |
|------|----------|------|
| Session assets | `lib/files.js` `storeUploadedAsset` | Disk under `TMP_DIR` / session id |
| Upload API | `app/api/upload/route.js` | Multipart; used by audio/image/video |
| Client video pick | `editor-shell.js` `handleBackgroundAssetFile` | FormData → `/api/upload` |
| Limits / MIME | `lib/upload-limits.js` | Vercel-safe 4 MB default; mp4/webm/mov |
| Preview URL | `buildSessionAssetUrl` → `/api/assets/:id` | Cookie session |
| Render | `lib/render/render-job.js` | `resolveSessionAsset` → local `filePath`; also builds `backgroundUrl` for Remotion |
| Composite | `video-background-composite` | Uses local `backgroundFilePath` |
| R2 env | `lib/r2/r2-env.js` | `R2_ENABLED`, account, keys, bucket, optional `R2_PUBLIC_BASE_URL` |
| R2 client | `lib/r2/r2-client.js` | put/head/delete; **no presign yet** |
| R2 lifecycle | `lib/r2/audio-r2-lifecycle.js` | Generation audio keys `generations/{id}/audio.mp3` |
| Session TTL | `lib/files.js` sweeper | ~24h default; exempt active jobs |

---

## 4. Architecture

### 4.1 Object key layout

```text
session-assets/{sessionId}/video/{assetId}{ext}
```

Examples:

```text
session-assets/a1b2…/video/c3d4….mp4
session-assets/a1b2…/video/e5f6….mov
```

- Prefix `session-assets/` separates from `generations/…` audio.  
- Session id in path enables prefix delete on session expiry.  
- Asset id is UUID (same charset as today: `^[a-zA-Z0-9_-]+$`).

Optional later: `session-assets/{sessionId}/image/{assetId}.png` (out of v1).

### 4.2 Metadata model (session JSON, extend today’s shape)

Keep writing `{assetId}.json` under the session dir **or** a dedicated meta file that does not require the binary on disk.

Recommended fields for R2-backed video:

```json
{
  "assetId": "…",
  "kind": "video",
  "name": "IMG_1234.MOV",
  "mimeType": "video/quicktime",
  "sizeBytes": 12345678,
  "durationSec": 4.2,
  "sessionId": "…",
  "sourceType": "upload",
  "storage": "r2",
  "r2ObjectKey": "session-assets/…/video/….mov",
  "createdAt": "ISO-8601",
  "storedFileName": null
}
```

- Disk-backed assets keep `storage: "local"` (or omit) + `storedFileName` as today.  
- `getAssetFilePath` / asset GET must branch on `storage === "r2"`.

### 4.3 End-to-end sequence

```text
1) Client: user picks file
2) Client: local preflight (type, size ≤ product max, e.g. 40 MB)
3) POST /api/upload/background-video/presign
      cookie session (create if missing)
      body: { fileName, contentType, sizeBytes }
      → validate → create pending meta → return
         { assetId, uploadUrl, objectKey, requiredHeaders, expiresAt }
4) Client: PUT uploadUrl
      body: raw file bytes
      headers: Content-Type (must match presign)
5) POST /api/upload/background-video/complete
      body: { assetId }
      → HEAD R2 object
      → size/type checks
      → optional duration probe (download stream or ffprobe if available)
      → mark meta ready
      → return public asset JSON (assetId, name, durationSec, sizeBytes, kind)
6) Client: set background type=video, asset id; set preview URL from
      GET /api/assets/:id (proxy) OR short-lived signed GET URL
```

### 4.4 Read path (preview + Remotion)

**Recommended v1: server proxy (simplest CORS/auth)**

`GET /api/assets/[assetId]` already session-gated:

- If local → stream file (today).  
- If R2 → `GetObject` from R2 and stream to client (or 302 to signed URL).

**Render job today** uses:

- Local `filePath` for ffmpeg composite  
- `backgroundUrl` pointing at `/api/assets/…` for Remotion in some paths  

Plan for render:

1. Resolve metadata.  
2. If R2: **download object to job work dir** (or stream into composite), set `filePath` as today.  
3. Remotion `backgroundUrl`: either  
   - signed R2 GET (if Remotion can fetch URL), or  
   - file:// / local path after download, or  
   - existing public asset URL with session cookie (fragile for headless render — prefer download or signed URL).

**Prefer:** render worker downloads once to temp path; reuse existing composite code.

---

## 5. API design

### 5.1 `POST /api/upload/background-video/presign`

**Auth:** session cookie (create session if absent; Set-Cookie on response).

**Body (JSON):**

```json
{
  "fileName": "clip.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 12000000
}
```

**Validation:**

| Rule | Value (v1 proposal) |
|------|---------------------|
| Max size | **80 MB** (`MAX_BACKGROUND_VIDEO_MB`, default **80**) |
| MIME | `video/mp4`, `video/webm`, `video/quicktime` |
| Extension | `.mp4`, `.webm`, `.mov` |
| Rate limit | Per session + IP (reuse credits rate-limit pattern, new namespace) |

**Response 200:**

```json
{
  "assetId": "…",
  "objectKey": "session-assets/…/video/….mp4",
  "uploadUrl": "https://….r2.cloudflarestorage.com/…?X-Amz-…",
  "headers": { "Content-Type": "video/mp4" },
  "expiresAt": "ISO-8601",
  "maxBytes": 83886080
}
```

**Errors:** 503 if R2 disabled; 400 validation; 429 rate limit.

**Side effects:**

- Ensure session dir + cookie.  
- Write **pending** metadata: `{ status: "pending_upload", storage: "r2", r2ObjectKey, … }`.  
- Presign PUT with `@aws-sdk/s3-request-presigner` (`getSignedUrl` + `PutObjectCommand`).  
- Expiry: **10–15 minutes**.  
- Optional: `ContentLength` condition if R2/S3 supports (enforce size).

### 5.2 `POST /api/upload/background-video/complete`

**Body:**

```json
{ "assetId": "…" }
```

**Logic:**

1. Load meta for session+asset; must be `pending_upload` or allow idempotent complete.  
2. `headR2Object(key)` — must exist.  
3. Compare `Content-Length` to declared `sizeBytes` (tolerance 0).  
4. Optional: `Content-Type` check.  
5. Duration:  
   - Best effort: download first N MB or full object to temp + `ffprobe` if binary available.  
   - On Vercel without ffprobe: leave `durationSec: null` and let client probe via `<video>` `loadedmetadata`, then optional `PATCH` metadata — **or** require duration in complete body from client.  
6. Set `status: "ready"`, return same public shape as today’s upload JSON.

**Client-reported duration (recommended v1):**

- After PUT, client loads blob URL, reads `video.duration`, sends:

```json
{ "assetId": "…", "durationSec": 12.34 }
```

Server clamps/sanitizes (0 < d ≤ 600). Avoids server ffprobe dependency.

### 5.3 Existing `POST /api/upload`

- **Keep** for audio + image (and tiny local videos if desired).  
- Video background path on client: **always** use presign flow when `R2_ENABLED` (feature flag from config endpoint or try presign → fallback message).  
- Do **not** dual-write large videos to disk.

### 5.4 Config signal for client

Add to an existing lightweight config route (or `/api/youtube-audio/config`-style):

```json
{
  "backgroundVideo": {
    "mode": "r2" | "local",
    "maxBytes": 83886080,
    "accept": ["video/mp4", "video/webm", "video/quicktime"]
  }
}
```

Client chooses presign vs legacy multipart.

---

## 6. Client changes (`editor-shell` / upload UX)

### 6.1 `handleBackgroundVideoFile` new flow

```text
preflight (upload-limits, higher max when r2)
→ presign
→ PUT to uploadUrl (track progress if easy: xhr upload.onprogress)
→ complete { assetId, durationSec from <video> }
→ setBackgroundUpload success + updateBackground type=video
→ preview URL: /api/assets/{assetId} or signed URL from complete response
```

### 6.2 UX

- Progress: “Uploading… 30%” during PUT (optional but valuable on mobile).  
- Errors: R2 disabled, presign fail, PUT 403 (CORS), complete fail, too large.  
- Accept attribute: keep mp4/webm/mov.  
- Copy: “Videos up to 80 MB” when R2 mode.

### 6.3 Fallback

If R2 disabled:

- Show: “Large video upload requires cloud storage. Use a short clip under 4 MB or enable R2.”  
- Or keep legacy multipart with 4 MB cap (current behavior).

---

## 7. Server modules to add/extend

| Module | Responsibility |
|--------|----------------|
| `lib/r2/r2-presign.js` | `createPresignedPutUrl`, `createPresignedGetUrl` |
| `lib/r2/session-asset-lifecycle.js` | key builders, complete/head, delete by key/prefix |
| `lib/files.js` | metadata helpers: `readAssetMetadata`, `writeAssetMetadata`, resolve storage; `getAssetReadStream` |
| `app/api/assets/[assetId]/route.js` | stream from R2 when `storage==="r2"` |
| `app/api/upload/background-video/presign/route.js` | presign endpoint |
| `app/api/upload/background-video/complete/route.js` | complete endpoint |
| `lib/upload-limits.js` | separate `getMaxBackgroundVideoBytes()` for R2 mode (**80 MB**) vs local body (~4 MB on Vercel) |
| `package.json` | add `@aws-sdk/s3-request-presigner` |

Dependency: **`@aws-sdk/s3-request-presigner`** (not currently installed).

---

## 8. Cloudflare R2 configuration (ops)

### 8.1 CORS (required for browser PUT)

On the bucket, allow:

- Origins: production origin(s) + `http://localhost:3000` (dev)  
- Methods: `PUT`, `GET`, `HEAD`  
- Headers: `Content-Type`, `Content-Length`  
- Expose headers: `ETag` (optional)

### 8.2 Public vs private

**v1 recommendation: private bucket + signed GET (or server proxy only).**

- Avoid public ACL for session videos (privacy).  
- If `R2_PUBLIC_BASE_URL` is set, only use for **generation** public cards, not session backgrounds, unless keys are unguessable and TTL delete is reliable.

### 8.3 IAM / API token

Same R2 API token as today must allow: `PutObject`, `GetObject`, `HeadObject`, `DeleteObject` (and ideally `ListObjects` for prefix cleanup).

---

## 9. Cleanup design

### 9.1 When to delete

| Trigger | Action |
|---------|--------|
| Session TTL sweep (`sweepExpiredSessions`) | Delete all R2 keys under `session-assets/{sessionId}/` + remove session dir |
| Explicit clear background / new project / clear media | Delete that asset’s `r2ObjectKey` + meta |
| Replace background video | Delete previous R2 key |
| Abandoned presign (pending, no complete) | TTL sweeper: pending > 1 h → delete key if any + meta |
| Failed complete after PUT | Best-effort delete object |

### 9.2 How to delete

```js
// Prefer explicit keys from metadata files
for each *.json in session:
  if storage===r2 && r2ObjectKey: deleteR2Object({ key })

// Safety net: list prefix session-assets/{sessionId}/ and delete
```

Add `listR2Prefix` + `deleteR2Prefix` in `r2-client.js` (ListObjectsV2).

### 9.3 Wire into existing sweeper

Extend `removeSessionAssets` / `sweepExpiredSessions` in `lib/files.js`:

1. Read session metas → R2 deletes.  
2. Prefix delete for orphans.  
3. `rm` session directory as today.

Exempt sessions with active render/transcribe/youtube jobs (existing exemption sets).

### 9.4 Lifecycle rules (optional ops belt-and-suspenders)

Cloudflare R2 object lifecycle: delete prefix `session-assets/` after **2 days**.  
App TTL is ~24 h; lifecycle is backup if sweeper misses.

### 9.5 Metrics / logs

```text
[r2:session-asset] presign { sessionId, assetId, sizeBytes }
[r2:session-asset] complete { assetId, sizeBytes, durationSec }
[r2:session-asset] delete { key, reason }
[r2:session-asset] sweep { sessionId, deletedCount }
```

No secrets, no full URLs with signatures in logs.

---

## 10. Preview and export integration

### 10.1 Preview

- After complete, client uses `/api/assets/{assetId}` which proxies R2.  
- Or complete returns `playbackUrl` (signed GET, 1 h); client uses that for `<video>` / Remotion player background.  
- **Proxy is simpler** (cookie auth, no CORS on GET). Signed URL is better for Remotion if it must load without cookies.

### 10.2 Export (`runRenderJob`)

Update `resolveSessionAsset`:

```text
if metadata.storage === "r2":
  download to os.tmpdir()/render-{jobId}/background{ext}
  return { filePath, metadata }
else:
  existing local path
```

Composite keeps using `backgroundFilePath`.  
Remotion `backgroundUrl`: for headless Chrome, **file path or data is unreliable**; use:

- signed HTTPS GET to R2, or  
- absolute URL to proxy that does not need browser cookies (pass render-secret header) — more complex.

**v1 export recommendation:**

1. Download R2 → temp file.  
2. For Remotion URL props, serve via **signed R2 GET** (1–2 h) as `backgroundUrl`.  
3. FFmpeg composite uses local temp file.

Cleanup temp files in `finally` of render job.

---

## 11. Security

| Risk | Mitigation |
|------|------------|
| Presign abuse (upload spam) | Session required; rate limit; max size; short expiry |
| Guess asset id | UUID; session cookie required for complete + GET |
| Content-Type spoof | Restrict allowlist; HEAD on complete |
| SSRF | No server fetch of user URLs in v1 |
| Path traversal | Existing asset id charset; keys server-generated only |
| Residual objects | Sweeper + lifecycle rule |
| Public leak | Private bucket; no public ACL for session-assets |

---

## 12. Implementation phases (PR slices)

### Phase A — R2 primitives (no UI)

1. Add `@aws-sdk/s3-request-presigner`.  
2. `createPresignedPutUrl` / `createPresignedGetUrl` + tests (mock S3).  
3. `listR2Prefix` / `deleteR2Prefix`.  
4. Key builder + unit tests.  
5. Document CORS checklist in `CREDITS_SETUP.md` or R2 section.

**Exit:** unit tests green; optional manual put/get with smoke script.

### Phase B — Presign + complete APIs

1. `POST .../presign` + `POST .../complete`.  
2. Pending/ready metadata on session.  
3. Extend `GET /api/assets/[assetId]` for R2 stream **or** redirect to signed GET.  
4. Rate limits + validation.  
5. Route tests with mocked R2.

**Exit:** curl/Postman can presign → put fixture → complete → GET asset.

### Phase C — Client video background

1. Config flag for R2 video mode.  
2. Rewrite `handleBackgroundVideoFile` for R2 path.  
3. Progress + errors.  
4. Client duration probe.  
5. Keep image/audio on old multipart.

**Exit:** mobile browser uploads >4 MB video; preview plays.

### Phase D — Render + composite

1. `resolveSessionAsset` R2 download.  
2. Signed URL for Remotion background.  
3. Temp cleanup.  
4. Export E2E with video background on Vercel (or staging).

**Exit:** export succeeds with R2-backed video background.

### Phase E — Cleanup

1. Hook session sweep → R2 prefix delete.  
2. Clear background / replace video deletes old key.  
3. Pending upload GC.  
4. Optional R2 lifecycle rule (ops doc).  
5. Log lines for audit.

**Exit:** expired session leaves no objects under its prefix (verify with list).

### Phase F — Hardening

1. Observability, error codes.  
2. Cap concurrent presigns.  
3. Docs: operator setup, max size, CORS.  
4. Consider images on R2 later.

---

## 13. Testing plan

### Unit

- Key format / sanitization.  
- Presign input validation (size, MIME).  
- Metadata pending → ready transitions.  
- Sweeper deletes keys (mock `deleteR2Object`).

### Integration (R2 sandbox bucket)

- Presign → PUT → HEAD → complete.  
- GET asset proxy.  
- Complete without PUT → 400.  
- Expired session sweep removes object.

### Manual / staging

| Case | Expect |
|------|--------|
| 10 MB mp4 on mobile Safari | Success |
| 60 MB file | Reject at preflight |
| `R2_ENABLED=false` | Clear error, no silent local 50 MB attempt on Vercel |
| Export with R2 video | MP4 out |
| New project after upload | Old R2 object gone after clear + sweep |

---

## 14. Rollout

1. Enable R2 on staging with CORS.  
2. Ship Phases A–C behind implicit flag (`R2_ENABLED`).  
3. Ship D (export) before marketing “large video on mobile”.  
4. Ship E cleanup same week as C (do not accumulate orphans).  
5. Production: monitor R2 storage + 4xx on complete.

### Feature flag

- **Required:** `R2_ENABLED=true` (existing generation R2 stack).  
- **Optional override:** `R2_SESSION_ASSETS=false` disables session background-video R2 while leaving generation audio R2 on. Default when unset: **enabled iff `R2_ENABLED`**.

---

## 15. Effort estimate (rough)

| Phase | Effort |
|-------|--------|
| A primitives | 0.5–1 day |
| B APIs + asset GET | 1–1.5 days |
| C client | 0.5–1 day |
| D render | 1 day |
| E cleanup | 0.5–1 day |
| F docs/hardening | 0.5 day |

**Total:** ~4–6 engineering days including staging validation.

---

## 16. Risks and decisions

| Risk | Mitigation |
|------|------------|
| iOS PUT CORS pain | Test Safari early; exact Content-Type match |
| No ffprobe on Vercel | Client-supplied `durationSec` |
| Render multi-isolate | Download in render job; don’t rely on /tmp from upload |
| Cost/storage growth | **80 MB** cap + 24 h session TTL + lifecycle |
| Double storage during transition | Video backgrounds R2-only when enabled |

### Open decisions (remaining)

1. **MOV on export host** — confirm `.mov` works in Remotion/ffmpeg on the export environment, or message “prefer MP4” if composite fails on MOV.  
2. ~~Max size / preview read / feature gate~~ — **locked** (see top of doc).

---

## 17. Success criteria

- [ ] Mobile Chrome/Safari can upload a **≥10 MB** background video on Vercel.  
- [ ] Preview shows the video.  
- [ ] Export with video background succeeds.  
- [ ] After session expiry / clear project, R2 prefix for that session is empty.  
- [ ] No credits/SumUp regressions.  
- [ ] Clear errors when R2 is off or file too large.

---

## 18. Suggested first implementation PR

**PR1 (A+B skeleton):** presign + complete + R2 asset GET + unit tests + CORS doc.  
No editor wiring yet — prove the pipe.  

Then **PR2:** client video path.  
**PR3:** render download + cleanup sweeper.

---

*End of plan.*
