export interface DuplicateGameScore {
  winnerSide: number;
  team0Points: number;
  team1Points: number;
}

/** A 第一局坐东西、第二局坐南北；吃分只作为辅助指标。 */
export function scoreDuplicateBoard(game1: DuplicateGameScore, game2: DuplicateGameScore) {
  const engineAWins = Number(game1.winnerSide === 0) + Number(game2.winnerSide === 1);
  const engineBWins = 2 - engineAWins;
  const engineAScore = game1.team0Points + game2.team1Points;
  const engineBScore = game1.team1Points + game2.team0Points;
  return {
    engineAWins, engineBWins, engineAScore, engineBScore,
    netScoreA: engineAScore - engineBScore,
    winner: engineAWins > engineBWins ? 'A' as const : engineAWins < engineBWins ? 'B' as const : 'TIE' as const,
  };
}

/** 每个发牌组是一份样本，两局不能当作独立观测。
 * 有限样本 Hoeffding 区间，假设发牌组独立；不因 10 组全平局而声称误差为零。
 */
export function pairedWinRateInterval(boards: readonly { engineAWins: number; engineBWins: number }[]) {
  if (!boards.length) return { difference: 0, lower: -1, upper: 1, groups: 0 };
  const difference = boards.reduce((sum, b) => sum + (b.engineAWins - b.engineBWins) / 2, 0) / boards.length;
  const radius = Math.sqrt(2 * Math.log(40) / boards.length);
  return { difference, lower: Math.max(-1, difference - radius), upper: Math.min(1, difference + radius), groups: boards.length };
}
