# C2 Balance Report

Date: 2026-06-11
Branch: `rebuild/c2-balance-pass`

## Scope

Implemented and tested the C2 headless balance pass from `docs/TaskBrief_C2.md`:

- Full headless run simulation from layer 1 to 20.
- Four strategy tiers: `random`, `greedy`, `balanced`, `expert`.
- Batch aggregation for pass rate, layer checkpoints, failure reasons, card type use/win/stolen rates, role spread, gas health, half-loop triggers, and cumulative profit curve.
- C1 mechanism fixes for arbitrage steal/loss direction, partial failed gas loss, L15 opportunity invalidation, sandwich variance, front-run replacement threshold, and L10 shortcut accounting.
- Liquidation trigger model: option A. The existing `hardTimeWindow` model is retained for this phase; state-trigger liquidation remains a later focused refactor.

## Final Validation

Command:

```powershell
node sim/run-batch.js --runs 500 --strategies all --roles all --seed c2-final-verified-3 --summary-only true
```

This runs 500 complete games for each strategy/role pair: 4 strategies x 3 roles x 500 = 6000 full headless runs.

Key final metrics:

| Metric | Result | Target |
| --- | ---: | ---: |
| Random pass rate | 8.4% | 5-15% |
| Greedy pass rate | 34.1% | 25-40% |
| Balanced pass rate | 64.3% | 50-65% |
| Expert pass rate | 82.1% | 80-92% |
| Role win-rate spread | 6.9pp | <=10pp |
| Half-loop triggers/game | 3.60 | 1-4 |
| Average gas used rate | 40.5% | tracked |

Card-type rates from the same run:

| Type | Use rate | Win rate | Stolen rate | Avg net profit |
| --- | ---: | ---: | ---: | ---: |
| arbitrage | 20.1% | 26.9% | 3.2% | 0.149 |
| sandwich | 19.9% | 52.3% | 5.3% | 0.379 |
| nft_snipe | 19.9% | 24.8% | 9.5% | 0.130 |
| front_run | 20.0% | 35.9% | 6.4% | 0.213 |
| liquidation | 20.1% | 30.1% | 2.8% | 0.163 |

## Config Changes

- `src/config/toolSimulator.js`
  - Failed gas loss is partial and reason-specific.
  - Arbitrage is no longer protected by the lowest steal probability; its stability now comes from lower failed loss.
  - Sandwich profit variance increased to 0.30.
  - Front-run replacement threshold increased to 1.10.
  - Broadcast pressure retuned with lower base success, higher risk/bot pressure, and lower max success.
  - Mempool detection base retuned to keep half-loop volume near target.

- `src/config/winloss.js`
  - Victory profit threshold retuned to 8.75 ETH for the new mechanics.

- `src/config/roles.js`
  - Scout high-level scan scaling reduced to keep role win spread within target.
  - Resist and efficiency buffs retuned to preserve role parity after C2 mechanic changes.

- `sim/run-batch.js`
  - Added full-run and batch simulation.
  - Added strategy deciders and CLI support.
  - Added JSON metrics and `summaryText`.

## Review Follow-Up

### TX_FAILED Half-Loop Policy

Review feedback noted that terminal `TX_FAILED` no longer entered the half-loop. This is intentional and now explicit:

- `target_stolen`, `gas_insufficient`, and `player_intervention` remain actionable half-loop incidents.
- Terminal broadcast failures (`tx_failed`, `window_expired`, `invalid_opportunity`) are already settled card outcomes, so the executor does not ask the decider to replan a completed failed transaction.
- Dead `TX_FAILED` incident code was removed from `INCIDENT_TYPES`, `RuleDecider`, and incident titles.
- Batch metrics now expose `terminalFailureReasons` separately from `failureReasons`.

This keeps section 4.5 half-loop volume focused on actionable replans while section 3 still sees revert/window/opportunity failure distribution.

### Genesis Layers 18-20

Command:

```powershell
node sim/run-batch.js --runs 500 --strategies all --roles all --from-layer 18 --to-layer 20 --role-level 3 --seed c2-genesis-verified --summary-only true
```

This starts directly at layer 18 with role level 3, so full-run `passRate` is not the acceptance signal: the run begins with zero cumulative profit and still checks the layer-20 victory threshold. Genesis pressure is judged by layer reach, profit, stolen/failure rates, and half-loop volume.

Genesis-layer results:

| Metric | Result |
| --- | ---: |
| Layer 18 reached | 100.0% |
| Layer 19 reached | 100.0% |
| Layer 20 reached | 99.98% |
| Avg cumulative profit over 18-20 | 1.085 ETH |
| Avg half-loop triggers/game | 1.069 |
| Role win-rate spread | 0.5pp |
| Layer 18 negative-profit rate | 50.47% |
| Layer 19 negative-profit rate | 50.77% |
| Layer 20 negative-profit rate | 50.46% |

Genesis conclusion: terminal layers have clear pressure (roughly half of layer attempts are negative and stolen rates are elevated) but are not fatal, because almost every 18-20 slice reaches layer 20 and the three-layer average remains positive.

## Test Evidence

Command:

```powershell
npm.cmd test
```

Result: 64 tests passed, 0 failed.
