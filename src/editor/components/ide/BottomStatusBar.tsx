import React from 'react';
import { PlayerTransform } from '../../types/engine';
import { Terminal } from 'lucide-react';
import { usePlaytestLog, usePlaytestPlayer } from '../../playtest/playtestStore';

interface BottomStatusBarProps {
  engineLog: string;
  pastHistoryCount: number;
  futureHistoryCount: number;
  activeCoord: { row: number; col: number };
  playerTransform: PlayerTransform;
  wallCount: number;
  entityCount: number;
}

export const BottomStatusBar: React.FC<BottomStatusBarProps> = ({
  engineLog,
  pastHistoryCount,
  futureHistoryCount,
  activeCoord,
  playerTransform: documentPlayer,
  wallCount,
  entityCount,
}) => {
  // The live position while playtesting, the spawn point otherwise
  const playerTransform = usePlaytestPlayer() ?? documentPlayer;
  // While playtesting, the runtime's status lines replace the editor's
  const shownLog = usePlaytestLog() ?? engineLog;
  return (
    <footer className="ide-statusbar">
      <div className="flex items-center gap-2 truncate">
        <Terminal className="w-3 h-3 text-[#478cbf] shrink-0" />
        <span className="text-[#cccccc] truncate">{shownLog}</span>
      </div>

      <div className="flex items-center gap-3 font-mono text-[10px] tabular-nums shrink-0">
        <span>
          History:{' '}
          <strong className="text-[#cccccc]">
            {pastHistoryCount}U / {futureHistoryCount}R
          </strong>
        </span>
        <span className="text-[#3e3e42]">|</span>
        <span>
          Cell:{' '}
          <strong className="text-[#cccccc]">
            [X:{activeCoord.col}, Z:{activeCoord.row}]
          </strong>
        </span>
        <span className="text-[#3e3e42]">|</span>
        <span>
          Cam:{' '}
          <strong className="text-[#cccccc]">
            ({playerTransform.x.toFixed(1)}, {playerTransform.z.toFixed(1)})
          </strong>
        </span>
        <span className="text-[#3e3e42]">|</span>
        <span>
          Walls: <strong className="text-[#cccccc]">{wallCount}</strong>
        </span>
        <span className="text-[#3e3e42]">|</span>
        <span>
          Entities: <strong className="text-[#cccccc]">{entityCount}</strong>
        </span>
      </div>
    </footer>
  );
};
