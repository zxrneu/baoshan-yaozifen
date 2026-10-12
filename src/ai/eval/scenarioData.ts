/**
 * JSON 样本边界校验；按单一职责原则将外部数据验证与局面构造分离。
 * 类型断言集中在完成字段校验后的适配边界，错误带样本 ID。
 */
import { SUITS } from '../../cards';
import { ScenarioDefinition } from './types';

type Validator = (value: unknown, field: string) => void;

export function parseScenarioDefinitions(data: unknown): ScenarioDefinition[] {
  if (!Array.isArray(data)) throw new Error('评估样本集必须是数组');
  const ids = new Set<string>();
  return data.map((value: unknown, index: number) => {
    const id = value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
      ? value.id : `第 ${index + 1} 项`;
    const fail = (field: string, reason: string): never => {
      throw new Error(`评估样本 ${id}：${field} ${reason}`);
    };
    const object = (value: unknown, field: string): Record<string, unknown> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, '必须是对象');
      return value as Record<string, unknown>;
    };
    const keys = (value: Record<string, unknown>, field: string, allowed: string[]) => {
      for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${field}.${key}`, '是未知字段');
    };
    const integer = (min: number, max: number): Validator => (value, field) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        fail(field, `必须是 ${min}..${max} 的整数`);
      }
    };
    const seat = integer(0, 3);
    const bid: Validator = (value, field) => {
      integer(70, 100)(value, field);
      if (Number(value) % 5 !== 0) fail(field, '必须是 5 的倍数');
    };
    const suit: Validator = (value, field) => {
      if (!SUITS.some(s => s === value)) fail(field, '必须是 S/H/C/D');
    };
    const card: Validator = (value, field) => {
      if (typeof value !== 'string' || !/^(?:[2-9]|10|[JQKA])[SHCD]$/.test(value)) {
        fail(field, '牌记法不合法，须使用 10S、AH 等格式');
      }
    };
    const array = (value: unknown, field: string, validate: Validator, min = 0, max = Infinity) => {
      if (!Array.isArray(value)) fail(field, '必须是数组');
      const items = value as unknown[];
      if (items.length < min || items.length > max) fail(field, `张数或项数须在 ${min}..${max} 之间`);
      items.forEach((item, i) => validate(item, `${field}[${i}]`));
    };
    const cards: Validator = (value, field) => array(value, field, card, 1);
    const optional = (record: Record<string, unknown>, field: string, validate: Validator, prefix: string) => {
      if (record[field] !== undefined) validate(record[field], `${prefix}.${field}`);
    };
    const roundCard: Validator = (value, field) => {
      const entry = object(value, field);
      keys(entry, field, ['seat', 'card']);
      seat(entry.seat, `${field}.seat`);
      card(entry.card, `${field}.card`);
    };
    const score: Validator = (value, field) => {
      integer(0, 100)(value, field);
      if (Number(value) % 5 !== 0) fail(field, '必须是 5 的倍数');
    };
    const sample = object(value, '样本');
    keys(sample, '样本', ['id', 'name', 'phase', 'category', 'description', 'optimalActionDesc', 'setup', 'expected']);
    for (const key of ['id', 'name', 'category', 'description', 'optimalActionDesc']) {
      if (typeof sample[key] !== 'string' || !String(sample[key]).trim()) fail(key, '必须是非空字符串');
    }
    if (ids.has(id)) fail('id', '重复');
    ids.add(id);
    const setup = object(sample.setup, 'setup');
    const expected = object(sample.expected, 'expected');
    seat(setup.seat, 'setup.seat');

    switch (sample.phase) {
      case 'bidding': {
        keys(setup, 'setup', ['seat', 'hand', 'highestBid', 'highestBidder', 'history']);
        array(setup.hand, 'setup.hand', card, 12, 12);
        optional(setup, 'highestBid', (v, f) => { if (v !== 0) bid(v, f); }, 'setup');
        optional(setup, 'highestBidder', (v, f) => { if (v !== null) seat(v, f); }, 'setup');
        optional(setup, 'history', (v, f) => array(v, f, (entry, field) => {
          const action = object(entry, field);
          keys(action, field, ['seat', 'bid']);
          seat(action.seat, `${field}.seat`);
          if (action.bid !== null) bid(action.bid, `${field}.bid`);
        }), 'setup');
        if ('bids' in expected) {
          keys(expected, 'expected', ['bids']);
          array(expected.bids, 'expected.bids', (v, f) => { if (v !== null) bid(v, f); }, 1);
        } else {
          keys(expected, 'expected', ['minBid', 'maxBid']);
          bid(expected.minBid, 'expected.minBid');
          bid(expected.maxBid, 'expected.maxBid');
          if (Number(expected.minBid) > Number(expected.maxBid)) fail('expected', '叫分区间上下界颠倒');
        }
        break;
      }
      case 'trump':
        keys(setup, 'setup', ['seat', 'hand', 'winningBid']);
        array(setup.hand, 'setup.hand', card, 12, 12);
        optional(setup, 'winningBid', bid, 'setup');
        keys(expected, 'expected', ['suits']);
        array(expected.suits, 'expected.suits', suit, 1, 4);
        break;
      case 'bury':
        keys(setup, 'setup', ['seat', 'hand16', 'trump', 'winningBid']);
        array(setup.hand16, 'setup.hand16', card, 16, 16);
        suit(setup.trump, 'setup.trump');
        optional(setup, 'winningBid', bid, 'setup');
        keys(expected, 'expected', ['zeroPointsBuried', 'trumpsPreserved', 'minVoidsCreated', 'includeCards', 'excludeCards']);
        if (expected.zeroPointsBuried !== true) fail('expected.zeroPointsBuried', '必须为 true');
        optional(expected, 'trumpsPreserved', (v, f) => {
          if (typeof v !== 'boolean') fail(f, '必须是布尔值');
        }, 'expected');
        optional(expected, 'minVoidsCreated', integer(0, 3), 'expected');
        optional(expected, 'includeCards', cards, 'expected');
        optional(expected, 'excludeCards', cards, 'expected');
        break;
      case 'playing':
        keys(setup, 'setup', ['seat', 'ownHand', 'trump', 'declarer', 'bid', 'leader', 'roundNumber',
          'currentRound', 'completedRounds', 'knownBuriedCards', 'declarerPoints', 'defenderPoints', 'voidSuits']);
        array(setup.ownHand, 'setup.ownHand', card, 1, 12);
        suit(setup.trump, 'setup.trump');
        seat(setup.declarer, 'setup.declarer');
        bid(setup.bid, 'setup.bid');
        seat(setup.leader, 'setup.leader');
        integer(1, 12)(setup.roundNumber, 'setup.roundNumber');
        array(setup.currentRound, 'setup.currentRound', roundCard, 0, 3);
        optional(setup, 'completedRounds', (v, f) => array(v, f, (value, field) => {
          const round = object(value, field);
          keys(round, field, ['trickNumber', 'winner', 'points', 'cards']);
          integer(1, 12)(round.trickNumber, `${field}.trickNumber`);
          seat(round.winner, `${field}.winner`);
          score(round.points, `${field}.points`);
          array(round.cards, `${field}.cards`, roundCard, 4, 4);
        }, 0, 11), 'setup');
        optional(setup, 'knownBuriedCards', (v, f) => array(v, f, card, 4, 4), 'setup');
        optional(setup, 'declarerPoints', score, 'setup');
        optional(setup, 'defenderPoints', score, 'setup');
        optional(setup, 'voidSuits', (v, f) => array(v, f, (v, f) => array(v, f, suit, 0, 4), 4, 4), 'setup');
        keys(expected, 'expected', ['cards', 'excludeCards']);
        if (expected.cards === undefined && expected.excludeCards === undefined) fail('expected', '必须声明允许或禁止的牌');
        optional(expected, 'cards', cards, 'expected');
        optional(expected, 'excludeCards', cards, 'expected');
        break;
      default:
        fail('phase', '必须是 bidding/trump/bury/playing');
    }
    // 所有分支已验证完整结构；克隆以隔离 JSON 导入对象与运行时定义。
    return structuredClone(value) as ScenarioDefinition;
  });
}
