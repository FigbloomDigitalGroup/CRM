# File storage and antivirus (FIG-1257, P1.13)

Uploaded files live in a private S3-compatible object store. The app reaches it only through the storage layer (`src/storage/`) and its signed links. The same S3 driver runs everywhere; only the environment values change. Local now, Amazon S3 when we move to AWS.

## What the app needs

| Variable | Meaning |
|---|---|
| `STORAGE_DRIVER` | `s3` (the `local` driver is for development without a store). |
| `S3_ENDPOINT` | Origin of the S3 API. |
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
