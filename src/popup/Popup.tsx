import React, { useState, useEffect, useCallback } from 'react';
import { Dice1, Plus, Settings, Shield, User, Book, Trash2, XCircle, RefreshCw, Dice5 } from 'lucide-react';
import { Button, Card, BatteryIcon, Logo, PhysicalDie, DieRow, Select, TextArea, Input } from '../components/UI';

interface DieStatus {
  dieId: string;
  name: string;
  battery: number;
  dieType: string;
  isRolling: boolean;
  status: string;
  isCharging?: boolean;
  lastResult?: number | null;
  colorway?: string;
  rssi?: number;
}

interface RollTemplate {
  name: string;
  formula: string;
}

const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILLS = [
  'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
  'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature',
  'perception', 'performance', 'persuasion', 'religion', 'sleight_of_hand',
  'stealth', 'survival'
];

const Popup: React.FC = () => {
  const [diceList, setDiceList] = useState<DieStatus[]>([]);
  const [rollTemplates, setRollTemplates] = useState<Map<string, RollTemplate>>(new Map());
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('');

  // Modifiers State
  const [advantageMode, setAdvantageMode] = useState<'normal' | 'advantage' | 'disadvantage'>('normal');
  const [modifierSource, setModifierSource] = useState<'none' | 'stat' | 'save' | 'skill'>('none');
  const [modifierKey, setModifierKey] = useState<string>('');
  const [manualModifier, setManualModifier] = useState<number>(0);
  const [isWaitingForSecondRoll, setIsWaitingForSecondRoll] = useState<boolean>(false);

  // Update Dice List
  const updateDiceList = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getDiceStatus' });
      if (Array.isArray(response)) {
        setDiceList(response);
      }
    } catch (error) {
      console.error('[Pixels Roll20] Error updating dice list:', error);
    }
  }, []);

  // Load Message Types
  const loadMessageTypes = useCallback(async () => {
    try {
      const templates = new Map<string, RollTemplate>();

      const indexUrl = chrome.runtime.getURL('messageTypes/index.json');
      const indexResponse = await fetch(indexUrl);
      if (indexResponse.ok) {
        const messageTypeFiles: string[] = await indexResponse.json();
        for (const file of messageTypeFiles) {
          try {
            const fileUrl = chrome.runtime.getURL(`messageTypes/${file}`);
            const response = await fetch(fileUrl);
            if (response.ok) {
              const data = await response.json();
              const name = file.replace('.json', '');
              const messageData = data.message || data.roll;
              if (messageData && messageData.formula) {
                templates.set(name, {
                  name: messageData.name || name,
                  formula: messageData.formula
                });
              }
            }
          } catch (e) {
            console.error(`Error loading ${file}:`, e);
          }
        }
      }

      // Load custom message types from storage
      const result = await chrome.storage.local.get(['customMessageTypes']);
      const customTypes = result.customMessageTypes || {};
      for (const key of Object.keys(customTypes)) {
        templates.set(key, customTypes[key]);
      }

      setRollTemplates(templates);

      // Restore selection
      const stored = await chrome.storage.local.get(['lastSelectedMessageType', 'modifierConfig']);
      const lastKey = stored.lastSelectedMessageType;

      if (stored.modifierConfig) {
        setAdvantageMode(stored.modifierConfig.advantageMode || 'normal');
        setModifierSource(stored.modifierConfig.modifierSource || 'none');
        setModifierKey(stored.modifierConfig.modifierKey || '');
        setManualModifier(stored.modifierConfig.manualModifier || 0);
      }

      if (lastKey && templates.has(lastKey)) {
        setSelectedTemplateKey(lastKey);
      } else if (templates.has('Default')) {
        setSelectedTemplateKey('Default');
        // Ensure storage is updated with default if nothing was there
        const template = templates.get('Default')!;
        chrome.storage.local.set({
          lastSelectedMessageType: 'Default',
          customRollTemplate: template.formula
        });
      }
    } catch (error) {
      console.error('[Pixels Roll20] Error loading message types:', error);
    }
  }, []);

  useEffect(() => {
    chrome.storage.local.set({
      modifierConfig: {
        advantageMode,
        modifierSource,
        modifierKey,
        manualModifier
      }
    });
  }, [advantageMode, modifierSource, modifierKey, manualModifier]);

  useEffect(() => {
    loadMessageTypes();
    updateDiceList();
    const interval = setInterval(updateDiceList, 1000);

    const messageListener = (message: any) => {
      if (message.type === 'diceRolled' || message.type === 'dieStatusChanged' || message.type === 'diceStatusUpdate') {
        updateDiceList();
      }
      if (message.type === 'waitingForSecondRoll') {
        setIsWaitingForSecondRoll(message.waiting);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      clearInterval(interval);
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [loadMessageTypes, updateDiceList]);

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value;
    setSelectedTemplateKey(key);
    if (key && rollTemplates.has(key)) {
      const template = rollTemplates.get(key)!;
      chrome.storage.local.set({
        lastSelectedMessageType: key,
        customRollTemplate: template.formula
      });
    } else {
      chrome.storage.local.set({
        lastSelectedMessageType: '',
        customRollTemplate: ''
      });
    }
  };

  const handleConnectDie = async () => {
    try {
      const url = chrome.runtime.getURL('hub.html?tab=dice&action=pair');
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('hub.html*') });

      if (tabs.length > 0 && tabs[0].id !== undefined) {
        // If hub exists, just update it and switch to it
        await chrome.tabs.update(tabs[0].id, { url, active: true });
      } else {
        const roll20Tabs = await chrome.tabs.query({ url: '*://app.roll20.net/*' });
        const activeRoll20 = roll20Tabs.find(t => t.active) || roll20Tabs[0];

        await chrome.tabs.create({
          url,
          pinned: false,
          active: true,
          index: activeRoll20 ? activeRoll20.index + 1 : undefined,
          windowId: activeRoll20 ? activeRoll20.windowId : undefined
        });
      }
    } catch (error) {
      console.error('[Pixels Roll20] Error connecting die:', error);
    }
  };

  const handleDisconnect = async (dieId: string) => {
    try {
      await chrome.runtime.sendMessage({ type: 'disconnect', dieId });
      updateDiceList();
    } catch (error) {
      console.error('[Pixels Roll20] Error disconnecting die:', error);
    }
  };

  const templateOptions = Array.from(rollTemplates.entries()).map(([key, t]) => ({
    value: key,
    label: t.name
  }));

  return (
    <div className="w-[500px] p-4 text-text-main pb-6">
      <div className="flex items-center gap-3 mb-6">
        <Logo size={48} />
        <h2 className="text-2xl font-black tracking-tight text-accent italic">Pixels Dice for Roll20</h2>

        <div className="flex-1 gap-3 mb-6 text-right items-right justify-end">
          <Button
            onClick={handleConnectDie}
            className="flex gap-3 p-2 text-lg"
          >
            <Plus size={22} />
            <Dice5 size={22} className='hidden' />
          </Button>
          <Button
            onClick={async () => {
              const url = chrome.runtime.getURL('hub.html?tab=templates');
              const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('hub.html*') });
              if (tabs.length > 0 && tabs[0].id !== undefined) {
                await chrome.tabs.update(tabs[0].id, { url, active: true });
              } else {
                await chrome.tabs.create({ url });
              }
            }}
            variant="secondary"
            className="p-2"
            title="Open Roll Templates"
          >
            <Settings size={22} />
          </Button>
        </div>
      </div>

      <Card>
        <div className="space-y-4">
          {diceList.length === 0 ? (
            <p className="text-text-muted text-center py-8 bg-card-bg rounded-xl border border-dashed border-border-main">
              No dice connected. Click "Connect New Die" to get started.
            </p>
          ) : (
            diceList.map(die => (
              <DieRow key={die.dieId} die={die} onDisconnect={handleDisconnect} />
            ))
          )}
        </div>
      </Card>

      {/* Modifiers Section */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs font-black uppercase tracking-widest text-text-muted opacity-60">Modifiers & Advantage</span>
          <button
            onClick={() => {
              setModifierSource('none');
              setModifierKey('');
              setManualModifier(0);
              setAdvantageMode('normal');
            }}
            className="text-[0.6rem] font-black uppercase tracking-tighter px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-text-muted hover:text-text-main transition-colors flex items-center gap-1"
          >
            <Trash2 size={10} /> Clear
          </button>
        </div>

        {/* Advantage Toggles */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {['advantage', 'normal', 'disadvantage'].map((mode) => (
            <button
              key={mode}
              onClick={() => setAdvantageMode(mode as any)}
              className={`py-2 rounded-lg font-black uppercase text-[0.7rem] tracking-widest transition-all ${advantageMode === mode
                ? 'bg-accent text-white shadow-lg shadow-accent/20'
                : 'bg-white/5 text-text-muted hover:bg-white/10'
                }`}
            >
              {mode === 'normal' ? 'Normal' : mode === 'advantage' ? 'Adv' : 'Dis'}
            </button>
          ))}
        </div>

        {/* Source Selectors */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1 no-scrollbar scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {[
            { id: 'stat', icon: <User size={14} />, label: 'Stats' },
            { id: 'save', icon: <Shield size={14} />, label: 'Saves' },
            { id: 'skill', icon: <Book size={14} />, label: 'Skills' }
          ].map(src => (
            <button
              key={src.id}
              onClick={() => setModifierSource(modifierSource === src.id ? 'none' : src.id as any)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[0.7rem] font-bold transition-all border whitespace-nowrap ${modifierSource === src.id
                ? 'bg-accent/10 border-accent text-accent'
                : 'bg-white/5 border-transparent text-text-muted hover:text-text-main'
                }`}
            >
              {src.icon}
              {src.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 bg-black/40 rounded-full px-3 py-1 border border-white/5">
            <span className="text-[0.6rem] font-bold text-text-muted uppercase">Bonus</span>
            <input
              type="number"
              value={manualModifier === 0 ? '' : manualModifier}
              onChange={(e) => setManualModifier(parseInt(e.target.value) || 0)}
              placeholder="+0"
              className="bg-transparent w-8 text-center text-[0.7rem] font-bold text-accent outline-none"
            />
          </div>
        </div>

        {/* Sub-selectors */}
        {modifierSource === 'stat' && (
          <div className="grid grid-cols-6 gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
            {STATS.map(s => (
              <button
                key={s}
                onClick={() => setModifierKey(s)}
                className={`py-2 rounded-lg font-black uppercase text-[0.6rem] transition-all ${modifierKey === s && modifierSource === 'stat'
                  ? 'bg-accent text-white'
                  : 'bg-white/5 text-text-muted hover:bg-white/10'
                  }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {modifierSource === 'save' && (
          <div className="grid grid-cols-6 gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
            {STATS.map(s => (
              <button
                key={s}
                onClick={() => setModifierKey(s)}
                className={`py-2 rounded-lg font-black uppercase text-[0.6rem] transition-all ${modifierKey === s && modifierSource === 'save'
                  ? 'bg-accent text-white'
                  : 'bg-white/5 text-text-muted hover:bg-white/10'
                  }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {modifierSource === 'skill' && (
          <div className="grid grid-cols-3 gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
            {SKILLS.map(s => (
              <button
                key={s}
                onClick={() => setModifierKey(s)}
                className={`py-1.5 px-1 rounded-lg font-bold uppercase text-[0.55rem] tracking-tighter truncate transition-all ${modifierKey === s && modifierSource === 'skill'
                  ? 'bg-accent text-white'
                  : 'bg-white/5 text-text-muted hover:bg-white/10 text-left pl-2'
                  }`}
              >
                {s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        )}

        {isWaitingForSecondRoll && (
          <div className="mt-4 p-3 bg-accent/10 border border-accent/20 rounded-xl flex items-center gap-3 animate-pulse">
            <RefreshCw size={16} className="text-accent animate-spin-slow" />
            <div className="text-[0.7rem] font-bold text-accent uppercase tracking-wider">
              Waiting for second die roll...
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="p-1">
          <span className="label-text block mb-2 font-bold uppercase tracking-wider text-xs text-text-muted">Roll Type</span>
          <Select
            options={templateOptions}
            value={selectedTemplateKey}
            onChange={handleTemplateChange}
            className="text-lg font-medium"
          />
        </div>
      </Card>
    </div>
  );
};

export default Popup;
