# File storage and antivirus (FIG-1257, P1.13)

Uploaded files live in a private S3-compatible object store. The app reaches it only through the storage layer (`src/storage/`) and its signed links. The same S3 driver runs everywhere; only the environment values change. Local now, Amazon S3 when we move to AWS.

## What the app needs

| Variable | Meaning |
|---|---|
| `STORAGE_DRIVER` | `s3` (the `local` driver is for development without a store). |
| `S3_ENDPOINT` | Origin of the S3 API, as the server reaches it. |
| `S3_PUBLIC_ENDPOINT` | Optional. Origin a browser reaches the store at. When set, the signed upload and download links are built and signed for this host; every server-side call (put, get, head, delete) still uses `S3_ENDPOINT`. Needed when the two differ, for example the Docker staging stack (`http://localhost:59100` for the host, `http://objectstore:8333` inside Docker). Must be an http(s) URL; unset means links use `S3_ENDPOINT`. |
| `S3_REGION` | Signing region. |
| `S3_BUCKET` | Bucket name (private). |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credentials of the app's storage identity. From a secret manager, never committed. |
| `S3_FORCE_PATH_STYLE` | `true` for a local store; `false` for Amazon S3 virtual-hosted style (`true` also works there). |
| `CLAMD_HOST`, `CLAMD_PORT` | The ClamAV daemon (default port 3310). See the antivirus section. |

## Local (this computer)

`docker-compose.storage.yml` runs a plain S3-compatible store and a ClamAV daemon, separate from the database stack.

```
docker compose -f docker-compose.storage.yml up -d --wait     # store, buckets and ClamAV
docker compose -f docker-compose.storage.yml down             # stop (add -v to wipe objects and signatures)
```

The first ClamAV start downloads its signature database and takes a few minutes; `--wait` blocks until it is healthy. To start only the store: `up -d --wait objectstore createbucket`.

Values for the local `.env` (dev-only credentials, defined in the compose file; never reuse them anywhere else):

```
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:59000
S3_REGION=us-east-1
S3_BUCKET=figbloom-crm-dev
S3_ACCESS_KEY_ID=devminioadmin
S3_SECRET_ACCESS_KEY=dev-only-minio-secret
S3_FORCE_PATH_STYLE=true
CLAMD_HOST=localhost
CLAMD_PORT=53310
```

Two private buckets are created at start: `figbloom-crm-dev` and `figbloom-crm-test` (used by the tests). Ports are bound to 127.0.0.1 only.

## Staging and Amazon S3 later

Same variables, different values. Nothing in the code changes.

| | Local | Staging (object store of the staging host) | Amazon S3 |
|---|---|---|---|
| `S3_ENDPOINT` | `http://localhost:59000` | the staging store's HTTPS endpoint | `https://s3.<region>.amazonaws.com` |
| `S3_REGION` | `us-east-1` | the store's region | the bucket's region |
| `S3_BUCKET` | `figbloom-crm-dev` | `figbloom-crm-staging` | the production bucket |
| `S3_FORCE_PATH_STYLE` | `true` | `true` | `false` (or `true`) |
| Credentials | dev-only, in the compose file | staging-only, secret manager | an IAM identity limited to the one bucket |

Staging and production credentials are never the same as each other or as the local ones. The staging values go in `.env.staging.example`'s names (`docs/STAGING.md`).

## The bucket must be private

* No public read, no public listing, no public policy, no website hosting, no anonymous write. On Amazon S3 turn on Block Public Access for the bucket and the account.
* The app is the only identity with access; users get a signed link (60 seconds for downloads) made by the storage layer after the permission check.
* Keys always start `orgs/<organisation id>/...`. A signed link names one exact key; changing the key invalidates the signature.
* Check: an unsigned `GET` of an object, an unsigned listing and an unsigned `PUT` must each return 403. `tests/storageS3Local.test.ts` checks this against the local store; repeat it by hand on staging (`curl -i <endpoint>/<bucket>/` must not list anything).
* Server-side encryption at rest on, and TLS only, for any shared environment.

## Rotating the storage credentials

The app has one storage identity. Rotate it on a schedule and whenever someone with access leaves or a leak is suspected.

1. In the store (or IAM on Amazon S3) create a second access key for the same identity, so two keys are active.
2. Put the new `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` in the secret manager and restart the app.
3. Check an upload, a download and a delete in the app (or `npx vitest run tests/storageS3Local.test.ts` with `S3_TEST_*` set for that environment).
4. Disable the old key, watch for access errors for a day, then delete it.
5. Links already handed out were signed with the old key and stop working when it is disabled; they live 60 seconds, so users only retry.

The local `STORAGE_SIGNING_SECRET` (local driver only) rotates by changing the environment value and restarting. Never paste keys into tickets, chat or commits.

## Antivirus: a go-live condition

Every upload is scanned before it can be served; an infected file is quarantined (status `QUARANTINED`, the audit event `file.quarantined`, the API answers 409 `FILE_UNAVAILABLE`).

* **`CLAMD_HOST` set:** the scan goes to a real ClamAV daemon. If it cannot be reached the verdict is an error and the upload fails closed (503 `SERVICE_UNAVAILABLE`, the file stays unavailable and the client retries). Nothing unscanned is ever served.
* **`CLAMD_HOST` not set:** only the built-in detector for the EICAR test string runs. Real malware is **not** detected. This is acceptable for development only.

**Go-live condition (open item in `docs/SECURITY_REVIEW_V1.md`): staging and production must set `CLAMD_HOST` (and `CLAMD_PORT`) to a running ClamAV daemon with current signatures (`freshclam` enabled), reachable from the app only on a private network, not the internet.** Staging acceptance: upload the EICAR test file in staging and see it quarantined; upload an ordinary file and see it ready.

Note: ClamAV matches the EICAR test file as a whole file, so it is found when the file is uploaded as is, not when buried inside other bytes. The built-in detector finds it anywhere.

## Tests

* `tests/storageS3Local.test.ts`: upload, signed upload and download, delete, purge byte removal, private bucket, cross-organisation link refused, expired link refused, wrong credentials. Skips cleanly when the store is not reachable. `S3_TEST_ENDPOINT`, `S3_TEST_REGION`, `S3_TEST_BUCKET`, `S3_TEST_ACCESS_KEY_ID`, `S3_TEST_SECRET_ACCESS_KEY` point it at another store.
* `tests/storageS3Antivirus.test.ts`: EICAR is flagged by the real daemon; the not-set and unreachable behaviours. The daemon tests skip cleanly when it does not answer. `CLAMD_TEST_HOST` and `CLAMD_TEST_PORT` override the address.
* Existing: `tests/storage.test.ts` (driver against an in-process stand-in, scan client, policy).

## Only a person can do

* Create the staging object store, bucket and its identity, and put the keys in the secret manager.
* Provide the staging and production ClamAV hosts and set `CLAMD_HOST`.
* Later: create the Amazon S3 bucket (Block Public Access on, encryption on) and its single-bucket identity.

## Staging verification, 4 Nov 2026

Run through the live local staging app (`http://localhost:33000`, production image, `FIGBLOOM_ENVIRONMENT=staging`, S3 driver against the staging object store, `CLAMD_HOST` set to the staging ClamAV), signed in as the UAT accounts of organisation `figbloom`. Routes used: `POST /api/orgs/{org}/leads/{id}/attachments` (returns a signed upload link), a `PUT` of the bytes to that link, `POST /attachments/{id}/complete`, `GET /attachments/{id}/download` (signed link, 60 seconds), `DELETE /attachments/{id}`, plus `GET /files/{id}`, `/files/{id}/download` and `/files/{id}/content`. The staging database held no leads, so one test lead was created as `uat-sales` and archived afterwards; all test objects were removed from the bucket at the end.

| # | Check | Result |
|---|---|---|
| a1 | Upload a 45-byte text file to a lead as Sales: link, PUT, complete | Pass. Status `UPLOADING`, then `READY`; scan result `clean`; audit event `file.uploaded`. |
| a2 | Download through the signed link; bytes match | Pass. SHA-256 of the download equals the upload; `Content-Disposition: attachment`. |
| a3 | Object exists in the private bucket | Pass. Signed `HEAD` with the staging credentials: 200, 45 bytes, key `orgs/<org id>/attachment/<file id>`. |
| a4 | Unsigned `GET` of the object, unsigned listing, unsigned `PUT` | Pass. All three return 403. |
| b | EICAR test string (68 bytes, `.txt`, `text/plain`) | Pass. `complete` answers 409 `FILE_UNAVAILABLE` ("This file was quarantined by the malware scan and cannot be used."). Row `QUARANTINED`, scan result `infected:Eicar-Test-Signature` (the real ClamAV signature name, so the daemon did the scan), audit event `file.quarantined`. The download route answers 409 as well and the list shows status `QUARANTINED`. The test string was sent from a pipe, never kept as a file: Windows Defender blocks it on disk. |
| c1 | Role without access cannot fetch the file | Pass. With the lead owned by Sales, Delivery gets 403 on the lead, its attachments, the attachment download and the three `/files/{id}` routes; Restricted Technical gets 403 on the lead, attachments and attachment download and 404 on the `/files/{id}` routes; no session gets 401. The owner gets 200 on all. |
| c2 | Expired signed link | Pass. A 60-second link re-used after expiry returns 403. |
| c3 | Forged signed link | Pass. Each of these returns 403: a changed signature, the same signature on another object key, the same signature under another organisation prefix, a stretched `X-Amz-Expires`, and the valid URL sent with a different `Host`. |
| c4 | Cross-organisation | Not tested end to end. Staging has one organisation, so no second tenant's token exists. Covered only by the key rule (the prefix cannot be swapped, see c3) and by `tests/storageS3Local.test.ts` and the Stage 1 cross-organisation tests. |
| d | Delete | Pass for the record, see the note below for the bytes. `DELETE /attachments/{id}` answers 200; the file row becomes `DELETED` with `deleted_at` set and `purged_at` empty; the download route then answers 404. A link issued before the delete keeps working until its 60 seconds end. |
| e | ClamAV unreachable fails closed | Pass. A second app container (compose `app` service, name `figbloom_drill_noclam`, port 33003) with `CLAMD_HOST=192.0.2.1` answered `complete` with 503 `SERVICE_UNAVAILABLE` ("The file could not be scanned right now. Try again in a moment.") after about 21 seconds; the file stayed `UPLOADING`, the download route answered 404, a retry answered 503 again. The container was removed afterwards; the shared staging containers were not touched. |

### What happens to the bytes after a delete (retention)

Now: deleting an attachment only marks the file `DELETED`. The object stays in the bucket (a signed `HEAD` still returned 200 after the delete, for both the clean and the quarantined file). `purgeDeletedFiles()` in `src/services/fileService.ts` (line 442) is what removes the bytes after `DEFAULT_RETENTION_DAYS` (30) and sets `purged_at`, and it also marks uploads that never completed as deleted after a day. **Nothing calls it**: it is not registered in `src/jobs/definitions.ts` and no cron route runs it; only `tests/files.test.ts` calls it. The scheduled `privacy.retention` job (`runRetentionSweep` in `src/services/privacyService.ts`, from line 495) purges IMPORT and EXPORT files only. So, as built, attachment, avatar and logo bytes are never removed from the object store, and quarantined (infected) objects stay there too, because the purge looks only at `DELETED` rows. This contradicts "the bytes are purged after the retention period" in the attachment route. The test objects of this run were removed from the bucket by hand with the storage credentials.

### Honest limits

* One organisation only, so no real cross-organisation request was possible (c4).
* ClamAV here is the staging container with signatures downloaded at start, on the Docker network. There is no production ClamAV host yet; the go-live condition above still stands. The "unreachable" check used an address that does not answer, which is the same failure path as a stopped daemon, not a stopped daemon.
* The retention purge was not run on staging (nothing schedules it, and running it by hand would have changed other data).
* Browser upload was not tried (see the defect below); the PUT was sent with curl.

### Defects found

1. **Fixed in code (4 Nov 2026), to be re-verified after the image is rebuilt:** new optional `S3_PUBLIC_ENDPOINT` (set to `http://localhost:59100` in `docker-compose.staging.yml`); signed links are now signed for that host while server calls keep `S3_ENDPOINT`. Original finding: **Signed upload and download links carry the internal address.** The links are signed for `S3_ENDPOINT`, which the staging compose file sets to `http://objectstore:8333` (`docker-compose.staging.yml` line 29), a name that exists only inside the Docker network. A browser on the host cannot use them (the PUT to the link from the host failed to connect); the checks above sent the request to the published port 59100 with `Host: objectstore:8333`. The storage layer has one endpoint setting only (`src/storage/index.ts` line 32). Fix options: a separate public endpoint used only when signing (for example `S3_PUBLIC_ENDPOINT=http://localhost:59100` locally, the real store URL on AWS), or serve the staging store under a name both sides resolve.
2. **Fixed in code (4 Nov 2026), to be re-verified on staging after the image is rebuilt: the file purge was not scheduled.** Bytes of deleted files and of quarantined (infected) files are now removed from the object store 30 days after deletion or quarantine by the daily `files.purge` background job (per organisation, `DEFAULT_RETENTION_DAYS` in `src/services/fileService.ts`, job in `src/jobs/handlers/filePurge.ts`); the database row stays with `purged_at` set, together with its audit trail, and the job is safe to repeat and ignores objects that are already gone. The retention is a code constant, not yet a per-organisation setting; the quarantine age is measured from the row's `updatedAt`, and one run removes at most 500 files per organisation. Original finding (kept for the record): `purgeDeletedFiles` was not registered in `src/jobs/definitions.ts` and no cron route ran it.
3. **A `complete` retry without the scanner takes about 21 seconds to answer 503.** Acceptable, but the user waits that long before seeing the message.

### Only a person can do

* Decide the fix for defect 1 before any browser upload test or UAT of attachments on staging, and for defect 2 before go-live.
* Provide the production ClamAV host, and repeat checks b and e there.
* Create a second organisation on staging (or run the Stage 1 cross-organisation tests against it) for check c4.
