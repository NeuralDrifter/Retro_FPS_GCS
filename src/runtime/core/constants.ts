/** Conversions between the sim's integer units and the renderer's meters */
import { ENGINE_CONFIG } from '../types';
import { SIM_CONFIG } from '../../sim';

export const UNITS_TO_METERS = ENGINE_CONFIG.CELL_SIZE / SIM_CONFIG.CELL_UNITS; // 4.0 / 1000 = 0.004
export const METERS_TO_UNITS = SIM_CONFIG.CELL_UNITS / ENGINE_CONFIG.CELL_SIZE; // 250

/** Fixed sim step: 30 ticks per second */
export const TICK_MS = 1000 / SIM_CONFIG.TICKS_PER_SECOND;
