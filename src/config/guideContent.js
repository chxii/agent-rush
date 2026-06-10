export const RULES_PAGES = [
  {
    title: 'Welcome to Agent Rush',
    body: [
      'You make execution decisions across a 20-layer on-chain battlefield: read opportunities, allocate Gas, set contingencies, then let Executor run.',
      'At run start you choose one role. Role buffs are transparent rules, not AI agents, and they stay active for the whole run.',
      'Win by clearing Layer 20 above the victory profit line. A loss streak below the failure line ends the run.',
    ],
  },
  {
    title: 'Round Flow',
    body: [
      'Scan: the system generates opportunity cards from the current scene. Scout can increase the number of cards.',
      'Decision: select cards, manually allocate Gas, and set a contingency for each card: fight, abandon, or transfer.',
      'Execute: Executor runs the semi-closed loop. On steals, failures, gas issues, or your one intervention, it replans from the current state.',
      'Settle: the round result updates profit, gas, loss pressure, and progression.',
    ],
  },
  {
    title: 'Reading Cards',
    body: [
      'Profit estimates the ETH upside if the card succeeds.',
      'Gas is the execution budget. Your selected cards cannot exceed the current Gas Pool.',
      'Risk is shown from available public signals. Scam cards can disguise themselves as low-risk, high-profit opportunities.',
      'Window is how long the opportunity remains usable. Short windows are easier to miss during execution.',
    ],
  },
  {
    title: 'Executor And Intervention',
    body: [
      'Executor is always present from Layer 1. It is the only LLM-driven part of the game.',
      'You can intervene once per round during execution. Shortcuts are rule-parsed; natural language is interpreted by the online Executor when available.',
      'Once all cards have finished and settlement summary begins, intervention is closed for that round.',
    ],
  },
  {
    title: 'Win Or Lose',
    body: [
      'Victory requires reaching Layer 20 with cumulative profit above the victory threshold.',
      'Failure triggers when consecutive losses reach the threshold while cumulative profit is below the failure line.',
      'The header shows cumulative profit, victory distance, and remaining loss pressure so each decision has context.',
    ],
  },
]

export const AGENT_GUIDE = {
  executor: {
    name: 'Executor',
    role: 'LLM execution lead',
    order: 1,
    summary: 'Executor is fixed from Layer 1. It decomposes the battle plan, calls tools, and replans on incidents.',
    withoutIt: 'There is no roster gate for Executor anymore. Every run uses the semi-closed loop execution path.',
    howToUse: 'Give it a legal battle plan, then intervene once per round if the live execution needs a course correction.',
  },
  scout: {
    name: 'Scout Role',
    role: 'Transparent rule buff',
    order: 2,
    summary: 'Scans extra opportunity cards each round. This increases information before the decision phase.',
    withoutIt: 'Non-scout roles use the base scan count.',
    howToUse: 'Pick Scout at run start if you want more options and are comfortable evaluating more cards.',
  },
  resist: {
    name: 'Resist Role',
    role: 'Transparent rule buff',
    order: 3,
    summary: 'Reduces steal probability and makes replace_tx cheaper or easier when fighting a competitor.',
    withoutIt: 'Other roles use the base mempool steal and replacement rules.',
    howToUse: 'Pick Resist if you want safer execution under bot pressure.',
  },
  efficiency: {
    name: 'Efficiency Role',
    role: 'Transparent rule buff',
    order: 4,
    summary: 'Raises the Gas Pool cap by role level.',
    withoutIt: 'Other roles use the base Gas Pool cap for each layer.',
    howToUse: 'Pick Efficiency if you want more budget for multi-card execution.',
  },
}

export const BOT_GUIDE = {
  'Bot-404': {
    name: 'Bot-404',
    layers: 'Layers 1-3',
    order: 1,
    threat: 'Very low',
    style: 'Tutorial pressure. It rarely steals targets.',
  },
  Shadow: {
    name: 'Shadow',
    layers: 'Layers 4-7',
    order: 2,
    threat: 'Low',
    style: 'Prefers new-token opportunities and mild mempool pressure.',
  },
  Phantom: {
    name: 'Phantom',
    layers: 'Layers 8-12',
    order: 3,
    threat: 'Medium',
    style: 'Watches NFT markets and competes for the same opportunities.',
  },
  'Phantom+': {
    name: 'Phantom+',
    layers: 'Layers 13-17',
    order: 4,
    threat: 'High',
    style: 'A stronger Phantom variant with multi-scene pressure.',
  },
  Genesis: {
    name: 'Genesis',
    layers: 'Layers 18-20',
    order: 5,
    threat: 'Extreme',
    style: 'Late-game pressure bot. Learning behavior is reserved for a later stage.',
  },
}
