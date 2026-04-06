import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Card, Input, TextArea, Logo, Select, Modal } from '../components/UI';
import { Plus, Edit3, Copy, Download, Trash2, AlertTriangle, FileJson, Lightbulb, Search, RefreshCw, Layers, ScrollText } from 'lucide-react';

interface CustomCommand {
  name: string;
  formula: string;
}

interface RollTemplate {
  name: string;
  formula: string;
}

const TemplatesTab: React.FC = () => {
  const [commands, setCommands] = useState<Record<string, CustomCommand>>({});
  const [builtInTemplates, setBuiltInTemplates] = useState<Map<string, RollTemplate>>(new Map());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editFormula, setEditFormula] = useState<string>('');
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    content: React.ReactNode;
    variant?: 'info' | 'warning' | 'danger' | 'success';
    onConfirm?: () => void;
  }>({ isOpen: false, title: '', content: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
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
          } catch (e) {}
        }
      }
      setBuiltInTemplates(templates);

      const result = await chrome.storage.local.get(['customMessageTypes']);
      setCommands(result.customMessageTypes || {});
    } catch (error) {
      console.error('[Pixels Roll20] Error loading data:', error);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    const name = editName.trim();
    const formula = editFormula.trim();

    if (!name || !formula) {
      setModal({
        isOpen: true,
        title: 'Missing Information',
        content: 'Please enter both a name and a roll template.',
        variant: 'warning'
      });
      return;
    }

    const commandKey = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const newCommands = { ...commands };
    
    if (editingKey && editingKey !== commandKey) {
      delete newCommands[editingKey];
    }
    
    newCommands[commandKey] = { name, formula };
    await chrome.storage.local.set({ customMessageTypes: newCommands });
    setCommands(newCommands);
    setEditingKey(null);
    setEditName('');
    setEditFormula('');
  };

  const handleEdit = (key: string) => {
    const cmd = commands[key];
    if (cmd) {
      setEditingKey(key);
      setEditName(cmd.name);
      setEditFormula(cmd.formula);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNew = () => {
    setEditingKey(null);
    setEditName('');
    setEditFormula('Rolled a #face_value');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (key: string) => {
    setModal({
      isOpen: true,
      title: 'Delete Command',
      content: `Are you sure you want to delete command "${key}"? This action cannot be undone.`,
      variant: 'danger',
      onConfirm: async () => {
        const newCommands = { ...commands };
        delete newCommands[key];
        await chrome.storage.local.set({ customMessageTypes: newCommands });
        setCommands(newCommands);
        if (editingKey === key) handleNew();
        setModal({ isOpen: false, title: '', content: '' });
      }
    });
  };

  const handleDuplicate = (key: string) => {
    const cmd = commands[key];
    if (cmd) {
      setEditingKey(null);
      setEditName(`${cmd.name} (Copy)`);
      setEditFormula(cmd.formula);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleExport = (key: string) => {
    const command = commands[key];
    if (!command) return;
    const json = JSON.stringify({ roll: command }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${key}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const command = json.roll || json.message;

        if (!command || !command.name || !command.formula) {
          setModal({
            isOpen: true,
            title: 'Import Failed',
            content: 'Invalid command file format. Must have "name" and "formula" fields.',
            variant: 'danger'
          });
          return;
        }

        const commandName = command.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const newCommands = { ...commands, [commandName]: { name: command.name, formula: command.formula } };
        await chrome.storage.local.set({ customMessageTypes: newCommands });
        setCommands(newCommands);
      } catch (error) {
        setModal({
          isOpen: true,
          title: 'Import Failed',
          content: 'Failed to parse JSON file.',
          variant: 'danger'
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClearAll = async () => {
    await chrome.storage.local.set({ customMessageTypes: {} });
    setCommands({});
    handleNew();
    setModal({
      isOpen: true,
      title: 'Library Cleared',
      content: 'All custom commands have been permanently deleted.',
      variant: 'success'
    });
  };

  const allAvailableTypes = [
    { value: '', label: '-- Select a template to load --' },
    ...Array.from(builtInTemplates.entries()).map(([key, t]) => ({
      value: `builtin:${key}`,
      label: t.name
    })),
    ...Object.entries(commands).map(([key, cmd]) => ({
      value: `custom:${key}`,
      label: `Custom: ${cmd.name || key}`
    }))
  ];

  const handleTemplateLoad = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (!value) return;

    const [type, key] = value.split(':');

    if (type === 'custom' && commands[key]) {
      setEditingKey(key);
      setEditName(commands[key].name);
      setEditFormula(commands[key].formula);
    } else if (type === 'builtin' && builtInTemplates.has(key)) {
      const template = builtInTemplates.get(key)!;
      setEditingKey(null);
      setEditName(template.name);
      setEditFormula(template.formula);
    }
  };

  return (
    <div className="space-y-12">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight mb-2">Roll Templates</h2>
          <p className="text-text-muted opacity-60">Customize how your Pixels rolls look in Roll20 chat.</p>
        </div>
        <Button onClick={handleNew} className="bg-success hover:bg-green-600 px-6 py-3 font-black uppercase tracking-widest text-sm flex items-center gap-2">
          <Plus size={18} strokeWidth={3} />
          New Command
        </Button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
        {/* Editor */}
        <div className="lg:col-span-3">
          <Card className="border-accent/20 bg-surface/40 backdrop-blur-sm sticky top-12">
            <h3 className="text-lg font-black uppercase tracking-widest text-accent mb-6 flex items-center gap-2">
              {editingKey ? <Edit3 size={18} /> : <Layers size={18} />}
              {editingKey ? 'Edit Template' : 'Create Template'}
            </h3>

            <div className="space-y-6">
              <div className="bg-accent/5 p-4 rounded-2xl border border-accent/10">
                <span className="label-text block mb-2 font-black uppercase tracking-widest text-[0.65rem] text-accent opacity-60">Quick Start</span>
                <Select 
                  value=""
                  onChange={handleTemplateLoad}
                  options={allAvailableTypes}
                  className="bg-transparent border-accent/20 text-sm"
                />
              </div>

              <div>
                <span className="label-text block mb-2 font-black uppercase tracking-widest text-[0.65rem] text-text-muted opacity-60">Display Name</span>
                <Input 
                  value={editName} 
                  onChange={(e) => setEditName(e.target.value)} 
                  placeholder="e.g. Verpine Sniper Rifle"
                  maxLength={32}
                  className="text-lg font-bold bg-white/5"
                />
              </div>

              <div>
                <span className="label-text block mb-2 font-black uppercase tracking-widest text-[0.65rem] text-text-muted opacity-60">Roll Formula</span>
                <TextArea 
                  value={editFormula}
                  onChange={(e) => setEditFormula(e.target.value)}
                  placeholder="&{template:default} {{name=Pixel Die}} {{Result=#face_value}}"
                  className="h-40 font-mono text-sm leading-relaxed bg-black/40 border-white/5 rounded-2xl p-4"
                />
                
                <div className="flex gap-4 mt-6">
                  <Button onClick={handleSave} className="flex-1 py-4 bg-success hover:bg-green-600 shadow-xl shadow-success/10 font-black uppercase">
                    {editingKey ? 'Update Library' : 'Save To Library'}
                  </Button>
                  {editingKey && (
                    <Button variant="secondary" onClick={handleNew} className="px-8">Cancel</Button>
                  )}
                </div>
              </div>

              <div className="bg-white/5 p-4 rounded-xl flex gap-3 items-start border border-white/5">
                <Lightbulb size={20} className="text-accent shrink-0 mt-0.5" />
                <div className="text-[0.7rem] leading-relaxed text-text-muted">
                  <p className="mb-1"><b>Variable Support:</b> Use <code>#face_value</code>, <code>#die_type</code>, and <code>#die_name</code> to inject real-time die data into your formulas.</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Library */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-black uppercase tracking-widest text-text-muted/40 mb-4 px-2">Saved Formulas</h3>
          {Object.keys(commands).length === 0 ? (
            <div className="text-center py-12 bg-white/2 rounded-3xl border-2 border-dashed border-white/5 opacity-40">
              <ScrollText size={32} className="mx-auto mb-2" />
              <p className="text-xs italic">Library empty.</p>
            </div>
          ) : (
            Object.entries(commands).map(([key, cmd]) => (
              <div key={key} className="bg-surface p-4 rounded-2xl border border-white/5 hover:border-accent group transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div className="font-bold text-accent truncate pr-4">{cmd.name || key}</div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleEdit(key)} className="p-1.5 hover:bg-white/10 rounded-lg text-text-muted"><Edit3 size={14} /></button>
                    <button onClick={() => handleDuplicate(key)} className="p-1.5 hover:bg-white/10 rounded-lg text-text-muted"><Copy size={14} /></button>
                    <button onClick={() => handleDelete(key)} className="p-1.5 hover:bg-white/10 rounded-lg text-danger"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="text-[0.65rem] font-mono text-text-muted/50 truncate bg-black/20 p-2 rounded-lg">
                  {cmd.formula}
                </div>
              </div>
            ))
          )}

          <div className="pt-8 space-y-3">
            <h3 className="text-xs font-black uppercase tracking-widest text-text-muted/40 px-2">Utility</h3>
            <Button onClick={handleImportClick} variant="secondary" className="w-full text-xs font-black py-3 bg-white/5 border-white/5 hover:bg-white/10 flex items-center justify-center gap-2">
              <FileJson size={14} /> Import JSON
            </Button>
            <Button 
              variant="danger" 
              onClick={() => setModal({
                isOpen: true,
                title: 'Wipe Library?',
                content: 'This will permanently delete all custom commands. <b>This cannot be undone.</b>',
                variant: 'danger',
                onConfirm: handleClearAll
              })}
              className="w-full text-xs font-black py-3 bg-danger/5 text-danger border-danger/10 hover:bg-danger hover:text-white"
            >
              <Trash2 size={14} /> Clear Library
            </Button>
          </div>
        </div>
      </div>

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" className="hidden" />

      <Modal
        isOpen={modal.isOpen}
        onClose={() => setModal({ ...modal, isOpen: false })}
        title={modal.title}
        variant={modal.variant}
        actions={
          modal.onConfirm ? (
            <div className="flex gap-3">
              <Button onClick={() => setModal({ ...modal, isOpen: false })} variant="secondary">Cancel</Button>
              <Button onClick={modal.onConfirm} variant={modal.variant === 'danger' ? 'danger' : 'primary'}>Confirm</Button>
            </div>
          ) : (
            <Button onClick={() => setModal({ ...modal, isOpen: false })} variant="primary">Close</Button>
          )
        }
      >
        <div dangerouslySetInnerHTML={{ __html: String(modal.content) }} className="text-sm opacity-80" />
      </Modal>
    </div>
  );
};

export default TemplatesTab;
