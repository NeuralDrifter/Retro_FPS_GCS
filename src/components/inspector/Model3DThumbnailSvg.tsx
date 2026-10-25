import React from 'react';
import { EntityArchetypeId } from '../../types/engine';

interface Model3DThumbnailSvgProps {
  blueprintId: EntityArchetypeId;
  accentHex: string;
  isEnemy: boolean;
}

/**
 * Renders an isometric 3D wireframe / silhouette SVG thumbnail for each `.glb`
 * 3D model card in the Asset Library.
 */
export const Model3DThumbnailSvg: React.FC<Model3DThumbnailSvgProps> = ({
  blueprintId,
  accentHex,
  isEnemy,
}) => {
  return (
    <svg
      viewBox="0 0 80 80"
      className="w-full h-full block pointer-events-none"
    >
      {/* Perspective Floor Grid Base */}
      <polygon
        points="40,56 68,66 40,75 12,66"
        fill="rgba(71, 140, 191, 0.08)"
        stroke="#2d2d30"
        strokeWidth="1"
      />
      <ellipse
        cx="40"
        cy="65"
        rx="18"
        ry="5.5"
        fill="none"
        stroke={accentHex}
        strokeWidth="1.2"
        strokeDasharray="3 2"
      />

      {blueprintId === 'supply-crate' ? (
        <g>
          <polygon
            points="40,26 60,35 60,57 40,66 20,57 20,35"
            fill="#1b2432"
            stroke={accentHex}
            strokeWidth="1.4"
          />
          <polyline
            points="20,35 40,44 60,35"
            fill="none"
            stroke={accentHex}
            strokeWidth="1.2"
          />
          <line
            x1="40"
            y1="44"
            x2="40"
            y2="66"
            stroke={accentHex}
            strokeWidth="1.2"
          />
          <ellipse
            cx="40"
            cy="34"
            rx="6"
            ry="2.5"
            fill={accentHex}
            fillOpacity="0.6"
          />
        </g>
      ) : blueprintId === 'turret-guardian' ? (
        <g>
          <polygon
            points="28,64 52,64 46,48 34,48"
            fill="#1e222a"
            stroke="#64748b"
            strokeWidth="1.2"
          />
          <rect
            x="25"
            y="26"
            width="30"
            height="20"
            rx="2"
            fill="#1e1b2e"
            stroke={accentHex}
            strokeWidth="1.4"
          />
          <line
            x1="20"
            y1="36"
            x2="26"
            y2="36"
            stroke="#e2e8f0"
            strokeWidth="2.5"
          />
          <line
            x1="54"
            y1="36"
            x2="60"
            y2="36"
            stroke="#e2e8f0"
            strokeWidth="2.5"
          />
          <circle cx="40" cy="36" r="5" fill={accentHex} />
        </g>
      ) : (
        <g>
          <rect
            x="31"
            y="47"
            width="6"
            height="17"
            fill="#1e293b"
            stroke="#64748b"
            strokeWidth="1"
          />
          <rect
            x="43"
            y="47"
            width="6"
            height="17"
            fill="#1e293b"
            stroke="#64748b"
            strokeWidth="1"
          />
          <rect
            x="28"
            y="27"
            width="24"
            height="20"
            rx="1.5"
            fill="#1e2430"
            stroke={accentHex}
            strokeWidth="1.4"
          />
          <rect
            x="35"
            y="33"
            width="10"
            height="6"
            fill={accentHex}
            fillOpacity="0.85"
          />
          <rect
            x="33"
            y="16"
            width="14"
            height="10"
            fill="#1e293b"
            stroke={accentHex}
            strokeWidth="1.2"
          />
          <rect
            x="35"
            y="19"
            width="10"
            height="3"
            fill={isEnemy ? '#f59e0b' : '#38bdf8'}
          />
          <rect
            x="22"
            y="29"
            width="5"
            height="15"
            fill="#1e293b"
            stroke="#64748b"
            strokeWidth="1"
          />
          <rect
            x="53"
            y="29"
            width="5"
            height="15"
            fill="#1e293b"
            stroke="#64748b"
            strokeWidth="1"
          />
        </g>
      )}
    </svg>
  );
};
