# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zihaeakb/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zihaeakb/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks DeFi's pre-token protocols by what a launch would be worth. Each protocol's implied value comes from its own TVL, its category's market-cap/TVL multiple (taken from the snapshot's own tokenized protocols, shrunk toward the global median so one outlier cannot set a whole category), 7-day TVL growth, and age without a token. Every row carries a concrete farm plan — the action, what it costs, how long it takes — and the dashboard is sortable, filterable, and opens a detail view per protocol with the full calculation shown. Built from a sealed DeFiLlama snapshot (14 Nov 2026); no token is ever promised.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9v4hjgyv&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
