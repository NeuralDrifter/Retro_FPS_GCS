/**
 * ============================================================================
 * ENEMY NAVIGATION ON VERTICAL LEVELS
 * ============================================================================
 * Enemies find their way to the player across layers: up stairs and ramps,
 * and down ledges and holes. Each tile's column of open air spans is a node;
 * a span links to a neighbouring tile's span when an enemy fits through the
 * gap between them and can climb (within one step) or drop to its floor.
 * Not part of the deterministic simulation; it steers the 3D view's enemies.
 */

import {
  NO_FLOOR_UNITS,
  OpenSpan,
  SIM_CONFIG,
  VerticalWorldView,
  gridToWorldUnits,
  openSpansAt,
  spanForFeet,
  worldUnitsToGrid,
} from './sim';

/** Head room an enemy needs */
const ENEMY_BODY_UNITS = SIM_CONFIG.PLAYER_BODY_HEIGHT_UNITS;

interface NavNode {
  row: number;
  col: number;
  span: number;
}

const nodeKey = (n: NavNode) => `${n.row},${n.col},${n.span}`;

export class VerticalNavigator {
  private readonly spans = new Map<string, OpenSpan[]>();

  constructor(private readonly view: VerticalWorldView) {}

  private columnSpans(row: number, col: number): OpenSpan[] {
    const key = `${row},${col}`;
    let s = this.spans.get(key);
    if (!s) {
      const { xUnits, zUnits } = gridToWorldUnits(row, col, this.view.gridSize);
      s = openSpansAt(this.view, xUnits, zUnits);
      this.spans.set(key, s);
    }
    return s;
  }

  /** The node an actor occupies, or null when it is not standing in open air */
  nodeAt(xUnits: number, zUnits: number, feetUnits: number): NavNode | null {
    const { row, col } = worldUnitsToGrid(xUnits, zUnits, this.view.gridSize);
    if (row < 0 || col < 0 || row >= this.view.gridSize || col >= this.view.gridSize) return null;
    const spans = this.columnSpans(row, col);
    const stepUnits = this.view.vertical?.movement.stepUnits ?? SIM_CONFIG.DEFAULT_STEP_UNITS;
    const span = spanForFeet(spans, feetUnits, stepUnits);
    if (!span) return null;
    return { row, col, span: spans.indexOf(span) };
  }

  private neighbours(n: NavNode): NavNode[] {
    const here = this.columnSpans(n.row, n.col)[n.span];
    const stepUnits = this.view.vertical?.movement.stepUnits ?? SIM_CONFIG.DEFAULT_STEP_UNITS;
    const out: NavNode[] = [];
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const row = n.row + dr;
      const col = n.col + dc;
      if (row < 0 || col < 0 || row >= this.view.gridSize || col >= this.view.gridSize) continue;
      this.columnSpans(row, col).forEach((there, span) => {
        if (there.floorUnits === NO_FLOOR_UNITS) return; // Never path into a bottomless pit
        if (there.floorUnits > here.floorUnits + stepUnits) return; // Too high to climb
        if (there.ceilingUnits - there.floorUnits < ENEMY_BODY_UNITS) return;
        const gapBottom = Math.max(here.floorUnits, there.floorUnits);
        const gapTop = Math.min(here.ceilingUnits, there.ceilingUnits);
        if (gapTop - gapBottom < ENEMY_BODY_UNITS) return;
        out.push({ row, col, span });
      });
    }
    return out;
  }

  /**
   * Next tile center (in units) to walk toward on the shortest route from one node to
   * another, or null when there is no route.
   */
  nextWaypoint(from: NavNode, to: NavNode, maxNodes = 20_000): { xUnits: number; zUnits: number } | null {
    const startKey = nodeKey(from);
    const goalKey = nodeKey(to);
    if (startKey === goalKey) return null;
    const cameFrom = new Map<string, NavNode | null>([[startKey, null]]);
    const queue: NavNode[] = [from];
    let found: NavNode | null = null;
    for (let qi = 0; qi < queue.length && qi < maxNodes; qi++) {
      const cur = queue[qi];
      if (nodeKey(cur) === goalKey) {
        found = cur;
        break;
      }
      for (const next of this.neighbours(cur)) {
        const k = nodeKey(next);
        if (cameFrom.has(k)) continue;
        cameFrom.set(k, cur);
        queue.push(next);
      }
    }
    if (!found) return null;
    // Walk back to the first step after the start
    let stepNode = found;
    let prev = cameFrom.get(nodeKey(stepNode)) ?? null;
    while (prev && nodeKey(prev) !== startKey) {
      stepNode = prev;
      prev = cameFrom.get(nodeKey(stepNode)) ?? null;
    }
    return gridToWorldUnits(stepNode.row, stepNode.col, this.view.gridSize);
  }
}
