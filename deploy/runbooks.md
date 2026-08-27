# Orchestra Runbooks (Part 13)

## Queue Backing Up

**Symptom:** `orchestra_queue_depth` above 10,000 and rising; run latency climbing.

**Diagnosis:**
1. Check worker replica count and whether KEDA is scaling
2. Check `orchestra_step_duration_seconds` by piece for one slow upstream
3. Check for poison jobs: a single job with high attempt count
4. Check per-org queue share for a single tenant flooding

**Action:**
- If one piece is slow: raise its concurrency limit or move it to a separate queue
- If poison job: move to DLQ by jobId
- If one tenant: tighten their admission token bucket
- If genuinely under-provisioned: raise `maxReplicaCount` and lower KEDA's target

---

## Third-Party Outage

**Symptom:** `orchestra_step_errors_total` spikes with `error_class=transient` for one piece.

**Diagnosis:**
1. Confirm on the provider's status page
2. Check whether retries are amplifying the load

**Action:**
1. Enable piece-level circuit breaker: fail fast with `UPSTREAM_5XX` and long backoff
2. Notify orgs with active flows on that piece
3. Do NOT disable flows — dehydrated retries drain naturally when provider recovers

---

## Credential Mass-Expiry

**Symptom:** `orchestra_step_errors_total` spikes with `error_class=auth` clustered on one piece.

**Diagnosis:**
1. Usually a provider changed refresh-token policy or revoked an app
2. Check whether the refresh job is failing for all connections or only some

**Action:**
1. If provider policy change: re-verify OAuth app registration and scopes
2. Trigger bulk refresh
3. Notify affected owners with a direct reconnect link
4. Flows stay enabled: they fail with a clear error rather than being silently disabled

---

## Copilot Quality Regression

**Symptom:** `orchestra_copilot_stage_total` ratio drops below 0.70, or abstention rate doubles.

**Diagnosis:**
1. Correlate with last prompt version, routing-table change, or provider model update
2. The last is most common and least announced
3. Run eval suite against both current and previous prompt version

**Action:**
1. Pin affected purpose to previous model version in routing table
2. Or roll back prompt version
3. Both are configuration, deployable in minutes without code release

---

## Poison Job

**Symptom:** One job retries indefinitely; the same error appears repeatedly.

**Diagnosis:**
1. Inspect job payload
2. Usually malformed trigger payload that a piece cannot parse
3. Or definition referencing a piece version that has been unpublished

**Action:**
1. Move job to DLQ
2. Mark the run with a clear message
3. If definition problem: notify owner with Ops Copilot diagnosis
4. Add contract test for payload shape so same class fails fast next time

---

## Graceful Shutdown

**Verified:** Under load with in-flight steps, the worker:
1. Stops accepting new jobs from Redis
2. Waits for in-progress steps to complete (up to `SHUTDOWN_TIMEOUT`)
3. Marks paused runs with expired transition leases
4. Crash recovery re-enqueues runs with expired leases

**Drill:** Kill a worker pod during an active run with a 10-second step. Verify the run completes on another worker.
