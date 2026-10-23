# How the engine works

The engine (`packages/engine`) is a deterministic **flow simulation**. It doesn't simulate individual requests; traffic moves through the architecture as *rates* (requests per second), and queueing math turns those rates into latency, errors and cascading failures. Nothing in a scenario is scripted except the fault: the failure dynamics come out of the model.

## The world

- **Nodes** are components: `cdn`, `lb`, `service`, `cache`, `db`, `queue`, `worker`, `external`, `client`. Each has instances, capacity per instance (RPS), base latency, a timeout and a connection pool for the calls it makes, a retry policy and a cost.
- **Edges** are calls between components. The graph must be acyclic.
- **Routes** are traffic flows such as `GET /:code`. Each route has a path through the graph, a request rate, a read/write mix and an optional traffic pattern (`flat`, `ramp`, `daily`).

## One tick (100 ms of simulated time), in order

1. **Faults** whose start time has arrived are applied (traffic spikes, latency injection, bad deploys, crashes, cache flushes, hot keys).
2. **Player actions** whose delay has elapsed take effect.
3. **Autoscalers** check utilization every 5 s and launch instances that take 15 s to boot.
4. **Flows** are pushed through the graph in topological order, so every node knows its total inflow.
5. **Latency and success** are computed backwards along each route.
6. **Retries** are scheduled into future ticks.
7. **Caches** warm up.
8. **Stats** (SLO, error budget, users, cost) and the outcome are updated.
9. **Outputs**: logs on threshold crossings every tick; metrics history and one sampled trace per route every second.

## The formulas

| Quantity | Formula |
|---|---|
| Utilization | `ρ = readLoad / readCapacity + writeLoad / writeCapacity`, where read capacity is `instances × capacityPerInstance × (1 + readReplicas)` |
| Mean latency | `base / (1 − min(ρ, 0.99))`, the queueing "hockey stick", plus any injected latency |
| Overload | when `ρ > 1`, only `1/ρ` of requests are served; the rest are rejected |
| p99 | `mean × (2 + 3 · min(ρ, 1))`: the tail spreads as the system saturates |
| Timeouts | latency is treated as exponential, so the fraction of calls that time out is `exp(−timeout / meanDownstreamLatency)` |
| Connection pools | Little's law: in-flight calls = `outbound rate × min(downstream latency, timeout)`. Demand is measured *before* pool rejection and applied on the next tick; when it exceeds `instances × poolSize`, the caller rejects the excess. This is how a slow dependency takes down a healthy caller. |
| Retries | a call fails with probability `f`. With `maxRetries = k`, success becomes `1 − f^(1+k)`, and the extra load is `out × f × (1 + f + … + f^(k−1))`. No backoff: retries arrive next tick. Exponential backoff without jitter: they all arrive together 1 s later. With jitter: spread over 2 s. |
| Hot keys | on a partitioned node with `n` instances and hot share `h`, the hottest partition gets `h + (1−h)/n` of the load, so adding instances barely helps |
| Caches | only reads can hit. Misses continue downstream (× 0.2 with request coalescing). Hit ratio warms linearly at `warmRatePerSec` up to its target; a flush resets it to 0. |
| Error budget | per second: `max(0, errorRate − allowedErrorRate) + 0.25 if p99 > SLO` |
| Win / lose | win after all faults have started and the SLO holds for `sloHealthyForSeconds`. Lose when the error budget hits 0 or the time limit passes. |

## Known simplifications

- Retries are modelled as expected values, not individual attempts. Synchronised retries (no jitter) arrive as one delayed lump.
- Traces are sampled from the current state of the model, not from simulated requests.
- Shedding and rate limiting count as errors: they slow the burn but can't produce a win on their own.

These are deliberate. The goal is correct *intuitions* (why 80% utilization is the danger zone, why retries make overload worse, why adding shards doesn't fix a hot key), not a byte-accurate model of any one system.
