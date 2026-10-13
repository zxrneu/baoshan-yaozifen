/** 公开回归集的结构统计；按单一职责原则呈现实际覆盖，不推断泛化牌力。 */
import { EvalScenario, ScenarioCoverage, ScenarioSetupResult } from './types';

export function scenarioCoverage(scenarios: readonly EvalScenario[], setups: readonly ScenarioSetupResult[]): ScenarioCoverage {
  const coverage: ScenarioCoverage = {
    total: scenarios.length,
    phaseSeats: { bidding: [0, 0, 0, 0], trump: [0, 0, 0, 0], bury: [0, 0, 0, 0], playing: [0, 0, 0, 0] },
    playingPositions: [0, 0, 0, 0],
    trumpSuits: { bury: { S: 0, H: 0, C: 0, D: 0 }, playing: { S: 0, H: 0, C: 0, D: 0 } },
    contracts: { trump: {}, bury: {}, playing: {} },
    playingRoles: { declarer: 0, partner: 0, defender: 0 },
    roundBands: { early: 0, middle: 0, late: 0 }, lateGame: 0,
    criticalScores: { declarer: 0, defender: 0 }, knownBuriedCards: 0,
    openHands: { declarer: 0, partner: 0, defender: 0 },
  };
  scenarios.forEach((scenario, i) => {
    const { seat, state, observation: o } = setups[i];
    coverage.phaseSeats[scenario.phase][seat]++;
    if (scenario.phase === 'bidding') return;
    const bid = o?.bid ?? state!.highestBid;
    const contracts = coverage.contracts[scenario.phase];
    contracts[bid] = (contracts[bid] ?? 0) + 1;
    if (scenario.phase === 'bury') coverage.trumpSuits.bury[state!.trump!]++;
    if (!o) return;
    coverage.trumpSuits.playing[o.trump]++;
    coverage.playingPositions[o.currentRound.length]++;
    const role = seat === o.declarer ? 'declarer' : seat % 2 === o.declarer % 2 ? 'partner' : 'defender';
    coverage.playingRoles[role]++;
    coverage.roundBands[o.roundNumber <= 4 ? 'early' : o.roundNumber <= 9 ? 'middle' : 'late']++;
    if (o.roundNumber >= 10) coverage.lateGame++;
    if (o.bid - o.declarerPoints === 5) coverage.criticalScores.declarer++;
    if (105 - o.bid - o.defenderPoints === 5) coverage.criticalScores.defender++;
    if (o.knownBuriedCards) coverage.knownBuriedCards++;
    if (o.revealedHand) coverage.openHands[role]++;
  });
  return coverage;
}

export function formatScenarioCoverage(coverage: ScenarioCoverage): string {
  const lines = [
    '公开开发回归集，不代表泛化牌力；覆盖计数不是抽样权重。单步通过率不能替代独立发牌的换边对战赢副率。',
    '', '| 阶段/座位 | 东（0） | 南（1） | 西（2） | 北（3） |', '| --- | --- | --- | --- | --- |',
    ...Object.entries(coverage.phaseSeats).map(([phase, seats]) => `| ${phase} | ${seats.join(' | ')} |`),
    '', `- 出牌位置（第 1/2/3/4 手）：${coverage.playingPositions.join('/')}`,
    `- 出牌角色（庄家/搭档/闲家）：${Object.values(coverage.playingRoles).join('/')}`,
    `- 出牌轮次（1–4/5–9/10–12）：${Object.values(coverage.roundBands).join('/')}`,
  ];
  for (const phase of ['bury', 'playing'] as const) {
    lines.push(`- ${phase} 主花色（S/H/C/D）：${Object.values(coverage.trumpSuits[phase]).join('/')}`);
  }
  for (const phase of ['trump', 'bury', 'playing'] as const) {
    lines.push(`- ${phase} 合同档：${Object.entries(coverage.contracts[phase]).map(([bid, count]) => `${bid} 分 × ${count}`).join('、') || '无'}`);
  }
  lines.push(`- 距成局线 5 分（庄/闲）：${coverage.criticalScores.declarer}/${coverage.criticalScores.defender}`,
    `- 已知底牌：${coverage.knownBuriedCards}；100 分明牌（庄家/搭档/闲家）：${Object.values(coverage.openHands).join('/')}`);
  return lines.join('\n');
}
