/**
 * ============================================================================
 * DETERMINISTIC SIMULATION STRUCTURED LOGGING
 * ============================================================================
 */

import { SimulationState } from './types';

export function addSimLog(
  state: SimulationState,
  level: 'info' | 'warn' | 'error',
  code: string,
  message: string,
  eventId?: string
): void {
  state.logs.push({
    tick: state.tick,
    level,
    code,
    message,
    ...(eventId ? { eventId } : {}),
  });
}
