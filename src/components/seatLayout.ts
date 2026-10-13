/** 四座展示坐标（SRP）：朝向始终跟随玩家，动画与牌桌共用同一映射。 */
export const SEAT_DIRECTIONS = ['east', 'south', 'west', 'north'] as const;
export const SEAT_ANGLES = [-90, 0, 90, 180] as const;

export function seatAngle(seat: number): number {
  return SEAT_ANGLES[seat] ?? 0;
}
