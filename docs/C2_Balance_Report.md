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

## Test Evidence

Command:

```powershell
npm.cmd test
```

Result: 64 tests passed, 0 failed.
