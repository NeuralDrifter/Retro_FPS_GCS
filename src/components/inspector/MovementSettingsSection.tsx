import React from 'react';
import { MovementSettingsSpec, SIM_CONFIG } from '../../runtime/sim';

const M = 4 / SIM_CONFIG.CELL_UNITS; // Meters per sim unit

interface MovementSettingsSectionProps {
  movement: MovementSettingsSpec;
  onUpdateMovement: (movement: MovementSettingsSpec) => void;
}

/** Per-game movement rules: jumping, crouching, step height, fall damage, aiming */
export const MovementSettingsSection: React.FC<MovementSettingsSectionProps> = ({
  movement,
  onUpdateMovement,
}) => {
  const toggle = (key: 'jump' | 'crouch' | 'fallDamage', label: string, hint: string) => (
    <label className="ide-label flex items-center gap-1.5 cursor-pointer py-0.5" title={hint}>
      <input
        type="checkbox"
        checked={movement[key]}
        onChange={(e) => onUpdateMovement({ ...movement, [key]: e.target.checked })}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div>
      <div className="ide-section-header">
        <span>Player Movement</span>
      </div>
      <div className="p-2.5 space-y-1.5">
        {toggle('jump', 'Jumping (Space)', 'Space jumps instead of using; E still uses')}
        {toggle('crouch', 'Crouching (C or Ctrl)', 'Fit under low ceilings, pipes and vents')}
        {toggle('fallDamage', 'Fall damage', 'Falls longer than about 3 m hurt')}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="ide-label block mb-0.5" title="Highest ledge you can walk up without jumping">
              Step height (m)
            </label>
            <input
              type="number"
              step={0.05}
              min={0}
              max={SIM_CONFIG.MAX_STEP_UNITS * M}
              value={Number((movement.stepUnits * M).toFixed(3))}
              onChange={(e) => {
                const u = Math.round(Number(e.target.value) / M);
                if (Number.isFinite(u)) {
                  onUpdateMovement({
                    ...movement,
                    stepUnits: Math.max(0, Math.min(SIM_CONFIG.MAX_STEP_UNITS, u)),
                  });
                }
              }}
              className="ide-input w-full font-mono"
            />
          </div>
          <div>
            <label className="ide-label block mb-0.5">Aiming</label>
            <select
              value={movement.aim}
              onChange={(e) => onUpdateMovement({ ...movement, aim: e.target.value as 'free' | 'auto' })}
              className="ide-input w-full"
            >
              <option value="free">Free mouse look</option>
              <option value="auto">Auto-aim up/down</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
