/**
 * ============================================================================
 * PHASE 4: VISUAL EVENT & TRIGGER EDITOR MODAL (GRIDFORGE 3D GCS)
 * ============================================================================
 * Allows game authors to visually author events, triggers, conditions, actions,
 * regions, and variables without touching JSON, with real-time validation.
 */

import React, { useState } from 'react';
import {
  ActionSpec,
  ConditionSpec,
  EventDefinition,
  RegionDefinition,
  TriggerSpec,
  VariableRegistrySpec,
} from '../engine/sim/types';
import { validateLevelDataV3, ValidationErrorItem } from '../engine/sim/validator';
import { X, Plus, Trash2, CheckCircle2, AlertTriangle, Sliders, ShieldAlert, BookOpen } from 'lucide-react';

interface EventTriggerEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: EventDefinition[];
  regions: RegionDefinition[];
  variables: VariableRegistrySpec;
  grid: number[][];
  gridSize: number;
  onSaveLevelData: (updated: {
    events: EventDefinition[];
    regions: RegionDefinition[];
    variables: VariableRegistrySpec;
  }) => void;
}

type EditorTab = 'events' | 'regions' | 'variables' | 'validation';

export const EventTriggerEditorModal: React.FC<EventTriggerEditorModalProps> = ({
  isOpen,
  onClose,
  events: initialEvents,
  regions: initialRegions,
  variables: initialVariables,
  grid,
  gridSize,
  onSaveLevelData,
}) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('events');
  const [events, setEvents] = useState<EventDefinition[]>(
    () => JSON.parse(JSON.stringify(initialEvents))
  );
  const [regions, setRegions] = useState<RegionDefinition[]>(
    () => JSON.parse(JSON.stringify(initialRegions))
  );
  const [variables, setVariables] = useState<VariableRegistrySpec>(
    () => JSON.parse(JSON.stringify(initialVariables))
  );

  const [selectedEventIndex, setSelectedEventIndex] = useState<number>(0);
  const [newFlagKey, setNewFlagKey] = useState<string>('');
  const [newCounterKey, setNewCounterKey] = useState<string>('');
  const [newTimerName, setNewTimerName] = useState<string>('');

  // Hooks must run on every render, so the closed check comes after them
  if (!isOpen) return null;

  // Run validation on current state
  const validationResult = validateLevelDataV3({
    formatVersion: 3,
    gridSize,
    rngSeed: 12345,
    nextEntityId: 1,
    spawn: { row: 2, col: 2, yawBam: 0 },
    minimapEnabled: true,
    skybox: { theme: 'retro-nebula', seed: 1, showCeiling: false },
    grid,
    wallTextures: [],
    floorTextures: [],
    ceilingTextures: [],
    entities: [],
    regions,
    variables,
    events,
  });

  const handleAddEvent = () => {
    const newId = `evt_${Date.now().toString(36)}`;
    const newEvt: EventDefinition = {
      id: newId,
      name: 'New Trigger Event',
      enabled: true,
      trigger: { type: 'enter_cell', row: 2, col: 2 },
      conditions: [],
      actions: [{ type: 'show_message', text: 'Trigger activated!' }],
      options: { once: true },
    };
    setEvents([...events, newEvt]);
    setSelectedEventIndex(events.length);
  };

  const handleDeleteEvent = (idx: number) => {
    const updated = events.filter((_, i) => i !== idx);
    setEvents(updated);
    setSelectedEventIndex(Math.max(0, idx - 1));
  };

  const handleAddRegion = () => {
    const rId = `reg_${Date.now().toString(36)}`;
    setRegions([
      ...regions,
      { id: rId, name: 'New Region', cells: [{ row: 2, col: 2 }] },
    ]);
  };

  const handleDeleteRegion = (idx: number) => {
    setRegions(regions.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    onSaveLevelData({ events, regions, variables });
    onClose();
  };

  const currentEvent = events[selectedEventIndex];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[#252526] border border-[#3f3f46] rounded-lg w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl text-[#d4d4d4] font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1e1e1e] border-b border-[#3f3f46]">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-[#478cbf]" />
            <h2 className="font-semibold text-white text-base">
              Event & Trigger Visual Authoring System (Phase 4)
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white text-xs font-semibold rounded shadow transition-colors cursor-pointer"
            >
              Apply to Level
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[#858585] hover:text-white p-1 rounded transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center bg-[#2d2d2d] px-4 border-b border-[#3f3f46] gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'events'
                ? 'border-[#478cbf] text-white bg-[#252526]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            Events ({events.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('regions')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'regions'
                ? 'border-[#478cbf] text-white bg-[#252526]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            Regions ({regions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('variables')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'variables'
                ? 'border-[#478cbf] text-white bg-[#252526]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            Variables Registry
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('validation')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'validation'
                ? 'border-[#478cbf] text-white bg-[#252526]'
                : 'border-transparent text-[#858585] hover:text-[#cccccc]'
            }`}
          >
            {validationResult.valid ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            )}
            <span>Validation ({validationResult.errors.length} errors)</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden flex">
          {activeTab === 'events' && (
            <div className="flex w-full h-full">
              {/* Event List Sidebar */}
              <div className="w-72 bg-[#1e1e1e] border-r border-[#3f3f46] flex flex-col">
                <div className="p-2 border-b border-[#3f3f46] flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-[#858585]">
                    Trigger Events
                  </span>
                  <button
                    type="button"
                    onClick={handleAddEvent}
                    className="p-1 bg-[#333333] hover:bg-[#444444] text-white rounded text-xs flex items-center gap-1 px-2 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Event</span>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-[#333333]">
                  {events.map((evt, idx) => (
                    <div
                      key={evt.id}
                      onClick={() => setSelectedEventIndex(idx)}
                      className={`p-2.5 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                        selectedEventIndex === idx
                          ? 'bg-[#2a2d2e] text-white border-l-2 border-[#478cbf]'
                          : 'text-[#cccccc] hover:bg-[#252526]'
                      }`}
                    >
                      <div>
                        <div className="font-semibold truncate w-44">
                          {evt.name || evt.id}
                        </div>
                        <div className="text-[10px] text-[#858585] font-mono">
                          Type: {evt.trigger.type}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEvent(idx);
                        }}
                        className="text-[#858585] hover:text-rose-400 p-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Event Properties Inspector */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#252526]">
                {currentEvent ? (
                  <div className="space-y-5 max-w-2xl">
                    <div className="flex items-center justify-between pb-3 border-b border-[#3f3f46]">
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          Editing Event: {currentEvent.id}
                        </h3>
                        <p className="text-xs text-[#858585]">
                          Configure trigger conditions, sequential actions, and fire options.
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={currentEvent.enabled}
                          onChange={(e) => {
                            const updated = [...events];
                            updated[selectedEventIndex].enabled = e.target.checked;
                            setEvents(updated);
                          }}
                          className="rounded bg-[#1e1e1e] border-[#3f3f46] text-[#478cbf]"
                        />
                        <span>Enabled</span>
                      </label>
                    </div>

                    {/* Name & ID */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[#cccccc] mb-1">
                          Event ID (Slug)
                        </label>
                        <input
                          type="text"
                          value={currentEvent.id}
                          onChange={(e) => {
                            const updated = [...events];
                            updated[selectedEventIndex].id = e.target.value;
                            setEvents(updated);
                          }}
                          className="w-full bg-[#1e1e1e] border border-[#3f3f46] rounded px-3 py-1.5 text-xs text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#cccccc] mb-1">
                          Display Name
                        </label>
                        <input
                          type="text"
                          value={currentEvent.name}
                          onChange={(e) => {
                            const updated = [...events];
                            updated[selectedEventIndex].name = e.target.value;
                            setEvents(updated);
                          }}
                          className="w-full bg-[#1e1e1e] border border-[#3f3f46] rounded px-3 py-1.5 text-xs text-white"
                        />
                      </div>
                    </div>

                    {/* Trigger Section */}
                    <div className="bg-[#1e1e1e] p-4 rounded border border-[#3f3f46] space-y-3">
                      <h4 className="text-xs font-semibold text-white uppercase tracking-wide">
                        Trigger Condition
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-[#858585] mb-1">
                            Trigger Type
                          </label>
                          <select
                            value={currentEvent.trigger.type}
                            onChange={(e) => {
                              const tType = e.target.value as TriggerSpec['type'];
                              const updated = [...events];
                              updated[selectedEventIndex].trigger = {
                                type: tType,
                                row: 2,
                                col: 2,
                                region: regions[0]?.id || 'armory',
                                dwell_ticks: 30,
                              } as any;
                              setEvents(updated);
                            }}
                            className="w-full bg-[#252526] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white"
                          >
                            <option value="enter_cell">enter_cell (Step on tile)</option>
                            <option value="enter_region">enter_region (Enter area)</option>
                            <option value="stand_in_region">stand_in_region (Pressure plate dwell)</option>
                            <option value="use">use (Press E / Space)</option>
                            <option value="shoot">shoot (Gun shot)</option>
                            <option value="all_dead">all_dead (Clear enemies)</option>
                            <option value="mover_finished">mover_finished (Door/Lift done)</option>
                            <option value="timer_fired">timer_fired (Timer expired)</option>
                          </select>
                        </div>

                        {['enter_cell', 'leave_cell', 'use', 'shoot'].includes(
                          currentEvent.trigger.type
                        ) && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] text-[#858585] mb-1">Row</label>
                              <input
                                type="number"
                                value={(currentEvent.trigger as any).row ?? 0}
                                onChange={(e) => {
                                  const updated = [...events];
                                  (updated[selectedEventIndex].trigger as any).row = Number(e.target.value);
                                  setEvents(updated);
                                }}
                                className="w-full bg-[#252526] border border-[#3f3f46] rounded px-2 py-1 text-xs text-white font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[#858585] mb-1">Col</label>
                              <input
                                type="number"
                                value={(currentEvent.trigger as any).col ?? 0}
                                onChange={(e) => {
                                  const updated = [...events];
                                  (updated[selectedEventIndex].trigger as any).col = Number(e.target.value);
                                  setEvents(updated);
                                }}
                                className="w-full bg-[#252526] border border-[#3f3f46] rounded px-2 py-1 text-xs text-white font-mono"
                              />
                            </div>
                          </div>
                        )}

                        {['enter_region', 'leave_region', 'stand_in_region'].includes(
                          currentEvent.trigger.type
                        ) && (
                          <div>
                            <label className="block text-[11px] text-[#858585] mb-1">Region ID</label>
                            <select
                              value={(currentEvent.trigger as any).region || ''}
                              onChange={(e) => {
                                const updated = [...events];
                                (updated[selectedEventIndex].trigger as any).region = e.target.value;
                                setEvents(updated);
                              }}
                              className="w-full bg-[#252526] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white"
                            >
                              {regions.map((reg) => (
                                <option key={reg.id} value={reg.id}>
                                  {reg.name} ({reg.id})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {currentEvent.trigger.type === 'stand_in_region' && (
                          <div>
                            <label className="block text-[11px] text-[#858585] mb-1">
                              Dwell Ticks (30Hz)
                            </label>
                            <input
                              type="number"
                              value={(currentEvent.trigger as any).dwell_ticks ?? 30}
                              onChange={(e) => {
                                const updated = [...events];
                                (updated[selectedEventIndex].trigger as any).dwell_ticks = Number(e.target.value);
                                setEvents(updated);
                              }}
                              className="w-full bg-[#252526] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white font-mono"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions List */}
                    <div className="bg-[#1e1e1e] p-4 rounded border border-[#3f3f46] space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-white uppercase tracking-wide">
                          Action Sequence ({currentEvent.actions.length})
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...events];
                            updated[selectedEventIndex].actions.push({
                              type: 'show_message',
                              text: 'New action executed!',
                            });
                            setEvents(updated);
                          }}
                          className="px-2.5 py-1 bg-[#333333] hover:bg-[#444444] text-white rounded text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Action</span>
                        </button>
                      </div>

                      <div className="space-y-2">
                        {currentEvent.actions.map((act, aIdx) => (
                          <div
                            key={aIdx}
                            className="bg-[#252526] p-3 rounded border border-[#3f3f46] flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-2 flex-1">
                              <span className="font-mono text-[10px] bg-[#333333] px-1.5 py-0.5 rounded text-[#858585]">
                                #{aIdx + 1}
                              </span>
                              <select
                                value={act.type}
                                onChange={(e) => {
                                  const aType = e.target.value as ActionSpec['type'];
                                  const updated = [...events];
                                  if (aType === 'open_door') {
                                    updated[selectedEventIndex].actions[aIdx] = {
                                      type: 'open_door',
                                      row: 4,
                                      col: 5,
                                    };
                                  } else if (aType === 'show_message') {
                                    updated[selectedEventIndex].actions[aIdx] = {
                                      type: 'show_message',
                                      text: 'Message text here.',
                                    };
                                  } else if (aType === 'earthquake') {
                                    updated[selectedEventIndex].actions[aIdx] = {
                                      type: 'earthquake',
                                      duration_ticks: 60,
                                      intensity: 50,
                                    };
                                  } else if (aType === 'set_hazard_region') {
                                    updated[selectedEventIndex].actions[aIdx] = {
                                      type: 'set_hazard_region',
                                      region: regions[0]?.id || 'hazard',
                                      damage_per_interval: 10,
                                      interval_ticks: 30,
                                    };
                                  } else {
                                    updated[selectedEventIndex].actions[aIdx] = {
                                      type: aType,
                                    } as any;
                                  }
                                  setEvents(updated);
                                }}
                                className="bg-[#1e1e1e] border border-[#3f3f46] rounded px-2 py-1 text-xs text-white"
                              >
                                <option value="open_door">open_door</option>
                                <option value="close_door">close_door</option>
                                <option value="toggle_door">toggle_door</option>
                                <option value="toggle_lift">toggle_lift</option>
                                <option value="start_crusher">start_crusher</option>
                                <option value="earthquake">earthquake</option>
                                <option value="set_hazard_region">set_hazard_region</option>
                                <option value="clear_hazard_region">clear_hazard_region</option>
                                <option value="spawn_entity">spawn_entity</option>
                                <option value="wake_entities">wake_entities</option>
                                <option value="show_message">show_message</option>
                                <option value="play_sound">play_sound</option>
                                <option value="exit_level">exit_level</option>
                              </select>

                              {act.type === 'show_message' && (
                                <input
                                  type="text"
                                  value={(act as any).text || ''}
                                  onChange={(e) => {
                                    const updated = [...events];
                                    (updated[selectedEventIndex].actions[aIdx] as any).text = e.target.value;
                                    setEvents(updated);
                                  }}
                                  className="flex-1 bg-[#1e1e1e] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white"
                                  placeholder="Message text..."
                                />
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...events];
                                updated[selectedEventIndex].actions = updated[
                                  selectedEventIndex
                                ].actions.filter((_, i) => i !== aIdx);
                                setEvents(updated);
                              }}
                              className="text-[#858585] hover:text-rose-400 p-1 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-[#858585] py-20">
                    Select an event or click "Add Event" to begin authoring logic.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'regions' && (
            <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-[#252526]">
              <div className="flex items-center justify-between pb-3 border-b border-[#3f3f46]">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Level Regions & Zones
                  </h3>
                  <p className="text-xs text-[#858585]">
                    Regions group cells together for "enter_region", "all_dead", and hazard/light areas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddRegion}
                  className="px-3 py-1.5 bg-[#333333] hover:bg-[#444444] text-white rounded text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Region</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {regions.map((reg, rIdx) => (
                  <div
                    key={reg.id}
                    className="bg-[#1e1e1e] p-4 rounded border border-[#3f3f46] space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <input
                        type="text"
                        value={reg.name}
                        onChange={(e) => {
                          const updated = [...regions];
                          updated[rIdx].name = e.target.value;
                          setRegions(updated);
                        }}
                        className="bg-[#252526] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => handleDeleteRegion(rIdx)}
                        className="text-[#858585] hover:text-rose-400 p-1 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#858585] mb-1">Region ID (Slug)</label>
                      <input
                        type="text"
                        value={reg.id}
                        onChange={(e) => {
                          const updated = [...regions];
                          updated[rIdx].id = e.target.value;
                          setRegions(updated);
                        }}
                        className="w-full bg-[#252526] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white font-mono"
                      />
                    </div>
                    <div className="text-[11px] text-[#858585]">
                      Cells assigned: <span className="text-white font-mono">{reg.cells.length}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'variables' && (
            <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-[#252526]">
              <div className="pb-3 border-b border-[#3f3f46]">
                <h3 className="text-sm font-semibold text-white">Variables Registry</h3>
                <p className="text-xs text-[#858585]">
                  Declare simulation-wide flags (booleans), counters (integers), and countdown timers.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-6">
                {/* Flags */}
                <div className="bg-[#1e1e1e] p-4 rounded border border-[#3f3f46] space-y-3">
                  <h4 className="text-xs font-semibold text-white uppercase">Flags (Booleans)</h4>
                  <div className="space-y-2">
                    {Object.entries(variables.flags || {}).map(([fKey, fVal]) => (
                      <div key={fKey} className="flex items-center justify-between bg-[#252526] p-2 rounded">
                        <span className="text-xs font-mono text-white">{fKey}</span>
                        <input
                          type="checkbox"
                          checked={fVal}
                          onChange={(e) => {
                            setVariables({
                              ...variables,
                              flags: { ...variables.flags, [fKey]: e.target.checked },
                            });
                          }}
                          className="rounded bg-[#1e1e1e] border-[#3f3f46] text-[#478cbf]"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={newFlagKey}
                      onChange={(e) => setNewFlagKey(e.target.value)}
                      placeholder="New flag name..."
                      className="flex-1 bg-[#252526] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newFlagKey.trim()) return;
                        setVariables({
                          ...variables,
                          flags: { ...variables.flags, [newFlagKey.trim()]: false },
                        });
                        setNewFlagKey('');
                      }}
                      className="px-3 bg-[#333333] hover:bg-[#444444] text-white rounded text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Counters */}
                <div className="bg-[#1e1e1e] p-4 rounded border border-[#3f3f46] space-y-3">
                  <h4 className="text-xs font-semibold text-white uppercase">Counters (Integers)</h4>
                  <div className="space-y-2">
                    {Object.entries(variables.counters || {}).map(([cKey, cVal]) => (
                      <div key={cKey} className="flex items-center justify-between bg-[#252526] p-2 rounded">
                        <span className="text-xs font-mono text-white">{cKey}</span>
                        <input
                          type="number"
                          value={cVal}
                          onChange={(e) => {
                            setVariables({
                              ...variables,
                              counters: {
                                ...variables.counters,
                                [cKey]: Number(e.target.value),
                              },
                            });
                          }}
                          className="w-20 bg-[#1e1e1e] border border-[#3f3f46] rounded px-2 py-0.5 text-xs text-white font-mono"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={newCounterKey}
                      onChange={(e) => setNewCounterKey(e.target.value)}
                      placeholder="New counter..."
                      className="flex-1 bg-[#252526] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newCounterKey.trim()) return;
                        setVariables({
                          ...variables,
                          counters: { ...variables.counters, [newCounterKey.trim()]: 0 },
                        });
                        setNewCounterKey('');
                      }}
                      className="px-3 bg-[#333333] hover:bg-[#444444] text-white rounded text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Timers */}
                <div className="bg-[#1e1e1e] p-4 rounded border border-[#3f3f46] space-y-3">
                  <h4 className="text-xs font-semibold text-white uppercase">Timers</h4>
                  <div className="space-y-2">
                    {(variables.timers || []).map((tName) => (
                      <div key={tName} className="flex items-center justify-between bg-[#252526] p-2 rounded">
                        <span className="text-xs font-mono text-white">{tName}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={newTimerName}
                      onChange={(e) => setNewTimerName(e.target.value)}
                      placeholder="New timer..."
                      className="flex-1 bg-[#252526] border border-[#3f3f46] rounded px-2.5 py-1 text-xs text-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newTimerName.trim()) return;
                        setVariables({
                          ...variables,
                          timers: [...(variables.timers || []), newTimerName.trim()],
                        });
                        setNewTimerName('');
                      }}
                      className="px-3 bg-[#333333] hover:bg-[#444444] text-white rounded text-xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'validation' && (
            <div className="flex-1 p-6 space-y-4 overflow-y-auto bg-[#252526]">
              <div className="pb-3 border-b border-[#3f3f46] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Live Level Schema & Integrity Validation
                  </h3>
                  <p className="text-xs text-[#858585]">
                    Enforces strict schema allowlists, variable reference integrity, and static cycle checks.
                  </p>
                </div>
                <div
                  className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 ${
                    validationResult.valid
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {validationResult.valid ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Level Schema Valid</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      <span>{validationResult.errors.length} Validation Errors</span>
                    </>
                  )}
                </div>
              </div>

              {validationResult.errors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-rose-400 uppercase">Errors</h4>
                  {validationResult.errors.map((err, idx) => (
                    <div
                      key={idx}
                      className="bg-[#1e1e1e] border border-rose-900/60 p-3 rounded text-xs flex items-start gap-3"
                    >
                      <span className="font-mono bg-rose-950 text-rose-300 px-1.5 py-0.5 rounded text-[10px]">
                        {err.code}
                      </span>
                      <div className="flex-1">
                        <div className="font-mono text-rose-200 text-[11px]">{err.path}</div>
                        <div className="text-[#cccccc] mt-0.5">{err.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {validationResult.valid && (
                <div className="text-center py-20 text-[#858585] space-y-2">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                  <div className="text-sm font-medium text-white">All checks passed successfully!</div>
                  <p className="text-xs">Your level data is fully compliant and ready for simulation execution.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
