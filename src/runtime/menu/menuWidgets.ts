/** Builds and styles the DOM element for each menu widget (moved out of MenuDOMRenderer.ts in P1.4) */
import {
  DEFAULT_MENU_RUNTIME_SETTINGS,
  MenuSaveSlotSummary,
  MenuSettingTarget,
  MenuWidgetSpec,
  MenuWidgetVisualStyle,
  resolveMenuFontFamilyCss,
} from './types';
import {
  MENU_SVG_ICONS,
  formatStatReadoutText,
  resolveMenuTexturePreviewUrl,
  type MenuDOMRendererCallbacks,
  type MenuRenderRuntimeContext,
} from './menuDomShared';

/** The renderer state a widget needs: its callbacks and whether the editor is showing it */
export interface WidgetHost {
  readonly callbacks: MenuDOMRendererCallbacks;
  readonly editorMode: boolean;
}

export function applyWidgetVisualStyle(
  host: WidgetHost,
  el: HTMLElement,
  style: MenuWidgetVisualStyle,
  state: 'default' | 'hover' | 'active',
  context: MenuRenderRuntimeContext
): void {
  const override =
    state === 'hover'
      ? style.hoverStyle
      : state === 'active'
      ? style.activeStyle
      : undefined;

  const bgColor = override?.bgColorRgba ?? style.bgColorRgba;
  const borderColor = override?.borderColorHex ?? style.borderColorHex;
  const textColor = override?.textColorHex ?? style.textColorHex;
  const texId = override?.backgroundTextureId ?? style.backgroundTextureId;
  const scale = override?.scaleMultiplier ?? 1;

  el.style.backgroundColor = bgColor;
  el.style.color = textColor;
  el.style.fontFamily = resolveMenuFontFamilyCss(style.fontFamily);
  el.style.fontSize = `${style.fontSizePx}px`;
  el.style.fontWeight = String(style.fontWeight);
  el.style.letterSpacing = `${style.letterSpacingEm}em`;
  el.style.textTransform = style.textTransform;
  el.style.textAlign = style.textAlign;

  if (style.textShadowHex) {
    el.style.textShadow = `0 0 16px ${style.textShadowHex}`;
  } else {
    el.style.textShadow = 'none';
  }

  // Shape & Borders
  el.style.clipPath = 'none';
  el.style.borderRadius = '0px';
  el.style.border =
    style.borderWidthPx > 0
      ? `${style.borderWidthPx}px solid ${borderColor}`
      : 'none';

  if (style.shape === 'rounded') {
    el.style.borderRadius = `${style.borderRadiusPx}px`;
  } else if (style.shape === 'pill') {
    el.style.borderRadius = '9999px';
  } else if (style.shape === 'underline') {
    el.style.border = 'none';
    el.style.borderBottom = `${Math.max(2, style.borderWidthPx)}px solid ${borderColor}`;
  } else if (style.shape === 'chamfered') {
    const c = Math.max(4, style.chamferSizePx || 10);
    el.style.clipPath = `polygon(${c}px 0%, 100% 0%, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, 0% 100%, 0% ${c}px)`;
  }

  // Optional Texture Skin
  const texUrl = resolveMenuTexturePreviewUrl(texId, context.customTextures);
  if (texUrl) {
    const fit = style.textureFit || 'stretch';
    el.style.backgroundImage = `linear-gradient(${bgColor}, ${bgColor}), url("${texUrl}")`;
    el.style.backgroundSize =
      fit === 'tile' ? '64px 64px' : '100% 100%';
    el.style.backgroundRepeat = fit === 'tile' ? 'repeat' : 'no-repeat';
  } else {
    el.style.backgroundImage = 'none';
  }

  if (scale !== 1 && !host.editorMode) {
    el.style.transform = `scale(${scale})`;
  } else {
    el.style.transform = 'none';
  }
}

export function buildWidgetElement(
  host: WidgetHost,
  widget: MenuWidgetSpec,
  context: MenuRenderRuntimeContext
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-menu-widget-id', widget.id);
  wrapper.setAttribute('data-menu-widget-type', widget.type);
  wrapper.style.cssText = `
    position: absolute;
    left: ${widget.rect.xPct}%;
    top: ${widget.rect.yPct}%;
    width: ${widget.rect.widthPct}%;
    height: ${widget.rect.heightPct}%;
    z-index: ${widget.rect.zIndex ?? 1};
    box-sizing: border-box;
    display: flex;
    transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
  `;

  applyWidgetVisualStyle(host, wrapper, widget.style, 'default', context);

  if (host.editorMode && host.callbacks.onSelectWidgetInEditor) {
    wrapper.addEventListener('mousedown', (e) => {
      host.callbacks.onSelectWidgetInEditor?.(widget.id, e);
    });
  }

  switch (widget.type) {
    case 'panel': {
      wrapper.style.pointerEvents = host.editorMode ? 'auto' : 'none';
      break;
    }

    case 'title-text': {
      wrapper.style.flexDirection = 'column';
      wrapper.style.justifyContent = 'center';
      wrapper.style.padding = '4px 8px';
      wrapper.style.pointerEvents = host.editorMode ? 'auto' : 'none';

      const heading = document.createElement('div');
      heading.style.cssText = 'line-height: 1.15; word-break: break-word;';
      heading.textContent = widget.text || '';
      wrapper.appendChild(heading);

      if (widget.subtitleText) {
        const sub = document.createElement('div');
        sub.style.cssText = `
          margin-top: 4px;
          font-size: ${Math.max(10, Math.round(widget.style.fontSizePx * 0.48))}px;
          font-weight: 500;
          opacity: 0.78;
          letter-spacing: 0.04em;
          text-Shadow: none;
        `;
        sub.textContent = widget.subtitleText;
        wrapper.appendChild(sub);
      }
      break;
    }

    case 'image': {
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.overflow = 'hidden';
      const imgUrl = resolveMenuTexturePreviewUrl(
        widget.imageTextureId,
        context.customTextures
      );
      if (imgUrl) {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = widget.text || widget.name;
        img.style.cssText =
          'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
        wrapper.appendChild(img);
      } else {
        const fallback = document.createElement('span');
        fallback.textContent = widget.text || widget.name;
        fallback.style.cssText = 'font-size:11px;opacity:0.75;';
        wrapper.appendChild(fallback);
      }
      break;
    }

    case 'button': {
      wrapper.setAttribute('role', 'button');
      wrapper.tabIndex = 0;
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent =
        widget.style.textAlign === 'left'
          ? 'flex-start'
          : widget.style.textAlign === 'right'
          ? 'flex-end'
          : 'center';
      wrapper.style.gap = '8px';
      wrapper.style.padding = '0 16px';
      wrapper.style.cursor = 'pointer';

      if (widget.iconId && widget.iconId !== 'none') {
        const iconSpan = document.createElement('span');
        iconSpan.style.cssText =
          'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;';
        iconSpan.innerHTML = MENU_SVG_ICONS[widget.iconId] || '';
        wrapper.appendChild(iconSpan);
      }

      const labelSpan = document.createElement('span');
      labelSpan.style.cssText =
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      labelSpan.textContent = widget.text || widget.name;
      wrapper.appendChild(labelSpan);

      wrapper.addEventListener('mouseenter', () => {
        applyWidgetVisualStyle(host, wrapper, widget.style, 'hover', context);
        if (!host.editorMode && widget.hoverSoundId) {
          host.callbacks.onPlaySound?.(widget.hoverSoundId);
        }
      });
      wrapper.addEventListener('mouseleave', () => {
        applyWidgetVisualStyle(host, 
          wrapper,
          widget.style,
          'default',
          context
        );
      });
      wrapper.addEventListener('mousedown', () => {
        if (!host.editorMode) {
          applyWidgetVisualStyle(host, 
            wrapper,
            widget.style,
            'active',
            context
          );
        }
      });
      wrapper.addEventListener('click', (e) => {
        if (host.editorMode) return;
        e.stopPropagation();
        if (widget.clickSoundId) {
          host.callbacks.onPlaySound?.(widget.clickSoundId);
        }
        if (widget.onClickAction) {
          host.callbacks.onTriggerAction?.(widget.onClickAction, widget);
        }
      });
      break;
    }

    case 'stat-readout': {
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent =
        widget.style.textAlign === 'left'
          ? 'flex-start'
          : widget.style.textAlign === 'right'
          ? 'flex-end'
          : 'center';
      wrapper.style.padding = '0 14px';
      wrapper.style.fontVariantNumeric = 'tabular-nums';
      wrapper.textContent = formatStatReadoutText(widget, context);
      break;
    }

    case 'inventory-grid': {
      wrapper.style.flexDirection = 'column';
      wrapper.style.justifyContent = 'space-between';
      wrapper.style.padding = '12px 14px';

      const header = document.createElement('div');
      header.style.cssText =
        'font-size:11px;opacity:0.8;text-align:left;letter-spacing:0.06em;';
      header.textContent = widget.text || 'TACTICAL LOADOUT & CLEARANCE';
      wrapper.appendChild(header);

      const gridRow = document.createElement('div');
      gridRow.style.cssText =
        'display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;flex:1;margin-top:8px;';

      const collectedKeys = context.simState?.collectedKeys ?? [];
      const hasKeycard = collectedKeys.length > 0;
      const ammoCount = Math.round(context.combatState?.ammo ?? 32);
      const hpCount = Math.round(context.combatState?.health ?? 100);

      const slots = [
        {
          title: 'Plasma Repeater',
          sub: `${ammoCount} Cells Loaded`,
          active: true,
          icon: MENU_SVG_ICONS.crosshair,
          accent: '#38bdf8',
        },
        {
          title: 'Security Keycard',
          sub: hasKeycard
            ? `Clearance Active (${collectedKeys.length})`
            : 'Not Acquired',
          active: hasKeycard,
          icon: MENU_SVG_ICONS.key,
          accent: hasKeycard ? '#facc15' : '#64748b',
        },
        {
          title: 'Exo-Armor Suit',
          sub: `Integrity ${hpCount}%`,
          active: hpCount > 0,
          icon: MENU_SVG_ICONS.shield,
          accent: '#4ec9b0',
        },
      ];

      for (const item of slots) {
        const card = document.createElement('div');
        card.style.cssText = `
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          padding:8px;
          background:rgba(15,23,42,0.75);
          border:1px solid ${item.active ? item.accent : '#334155'};
          border-radius:4px;
          opacity:${item.active ? '1' : '0.55'};
          gap:4px;
        `;
        const iconWrap = document.createElement('div');
        iconWrap.style.cssText = `color:${item.accent};display:flex;align-items:center;`;
        iconWrap.innerHTML = item.icon;

        const nameEl = document.createElement('div');
        nameEl.style.cssText =
          'font-size:11px;font-weight:700;color:#f8fafc;text-align:center;';
        nameEl.textContent = item.title;

        const subEl = document.createElement('div');
        subEl.style.cssText =
          'font-size:10px;color:#94a3b8;font-variant-numeric:tabular-nums;text-align:center;';
        subEl.textContent = item.sub;

        card.append(iconWrap, nameEl, subEl);
        gridRow.appendChild(card);
      }

      wrapper.appendChild(gridRow);
      break;
    }

    case 'slider-setting': {
      wrapper.style.flexDirection = 'row';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'space-between';
      wrapper.style.padding = '0 16px';
      wrapper.style.gap = '12px';

      const target: MenuSettingTarget =
        widget.settingBinding?.target || 'masterVolume';
      const min = widget.settingBinding?.min ?? 0;
      const max = widget.settingBinding?.max ?? 100;
      const step = widget.settingBinding?.step ?? 5;
      const settings = context.settings || DEFAULT_MENU_RUNTIME_SETTINGS;
      const currentVal = Number(
        settings[target] ?? DEFAULT_MENU_RUNTIME_SETTINGS[target]
      );

      const label = document.createElement('span');
      label.style.cssText = 'font-size:12px;white-space:nowrap;';
      label.textContent = widget.text || target;

      const rightBox = document.createElement('div');
      rightBox.style.cssText =
        'display:flex;align-items:center;gap:10px;width:52%;';

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(currentVal);
      input.style.cssText = 'flex:1;cursor:pointer;accent-color:#4ec9b0;';

      const valReadout = document.createElement('span');
      valReadout.style.cssText =
        'font-size:12px;font-variant-numeric:tabular-nums;min-width:42px;text-align:right;';
      valReadout.textContent =
        target === 'fov' ? `${currentVal}°` : `${currentVal}%`;

      input.addEventListener('input', (e) => {
        if (host.editorMode) return;
        e.stopPropagation();
        const nextNum = Number(input.value);
        valReadout.textContent =
          target === 'fov' ? `${nextNum}°` : `${nextNum}%`;
        host.callbacks.onChangeSetting?.(target, nextNum);
      });

      rightBox.append(input, valReadout);
      wrapper.append(label, rightBox);
      break;
    }

    case 'toggle-setting': {
      wrapper.style.flexDirection = 'row';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'space-between';
      wrapper.style.padding = '0 16px';
      wrapper.style.cursor = 'pointer';

      const target: MenuSettingTarget =
        widget.settingBinding?.target || 'minimapEnabled';
      const settings = context.settings || DEFAULT_MENU_RUNTIME_SETTINGS;
      const isOn = Boolean(settings[target]);

      const label = document.createElement('span');
      label.style.cssText = 'font-size:12px;';
      label.textContent = widget.text || target;

      const statusText = document.createElement('span');
      statusText.style.cssText = `
        font-size:11px;
        font-weight:700;
        color:${isOn ? '#4ec9b0' : '#94a3b8'};
        font-variant-numeric:tabular-nums;
      `;
      statusText.textContent = isOn ? '[ ENABLED ]' : '[ DISABLED ]';

      wrapper.addEventListener('click', (e) => {
        if (host.editorMode) return;
        e.stopPropagation();
        host.callbacks.onChangeSetting?.(target, !isOn);
      });

      wrapper.append(label, statusText);
      break;
    }

    case 'save-slot-list': {
      wrapper.style.flexDirection = 'column';
      wrapper.style.justifyContent = 'space-between';
      wrapper.style.padding = '10px 12px';
      wrapper.style.gap = '8px';

      const slots: MenuSaveSlotSummary[] = context.saveSlots || [
        { slotIndex: 1, occupied: false },
        { slotIndex: 2, occupied: false },
        { slotIndex: 3, occupied: false },
      ];

      for (const slot of slots) {
        const row = document.createElement('div');
        row.style.cssText = `
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:8px 12px;
          background:rgba(15,23,42,0.82);
          border:1px solid ${slot.occupied ? '#38bdf8' : '#334155'};
          border-radius:4px;
          flex:1;
        `;

        const info = document.createElement('div');
        info.style.cssText =
          'display:flex;flex-direction:column;align-items:flex-start;gap:2px;';

        const titleLine = document.createElement('div');
        titleLine.style.cssText =
          'font-size:12px;font-weight:700;color:#f8fafc;';
        titleLine.textContent = slot.occupied
          ? `Slot ${slot.slotIndex}: ${slot.levelTitle || `Sector ${(slot.levelIndex ?? 0) + 1}`}`
          : `Slot ${slot.slotIndex}: Empty Checkpoint`;

        const metaLine = document.createElement('div');
        metaLine.style.cssText =
          'font-size:10px;color:#94a3b8;font-variant-numeric:tabular-nums;';
        metaLine.textContent = slot.occupied
          ? `HP ${slot.health ?? 100} · Ammo ${slot.ammo ?? 32} · Saved ${slot.savedAt || 'Recently'}`
          : 'No saved data in this slot';

        info.append(titleLine, metaLine);

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;align-items:center;gap:6px;';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText =
          'padding:4px 10px;font-size:11px;font-weight:700;background:#1e293b;border:1px solid #4ec9b0;color:#4ec9b0;border-radius:3px;cursor:pointer;';
        saveBtn.addEventListener('click', (e) => {
          if (host.editorMode) return;
          e.stopPropagation();
          host.callbacks.onSaveSlot?.(slot.slotIndex);
        });

        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.textContent = 'Load';
        loadBtn.disabled = !slot.occupied;
        loadBtn.style.cssText = `
          padding:4px 10px;
          font-size:11px;
          font-weight:700;
          background:${slot.occupied ? '#0284c7' : '#1e293b'};
          border:1px solid ${slot.occupied ? '#38bdf8' : '#334155'};
          color:${slot.occupied ? '#ffffff' : '#64748b'};
          border-radius:3px;
          cursor:${slot.occupied ? 'pointer' : 'not-allowed'};
        `;
        loadBtn.addEventListener('click', (e) => {
          if (host.editorMode || !slot.occupied) return;
          e.stopPropagation();
          host.callbacks.onLoadSlot?.(slot.slotIndex);
        });

        actions.append(saveBtn, loadBtn);
        row.append(info, actions);
        wrapper.appendChild(row);
      }
      break;
    }
  }

  return wrapper;
}
