import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Card, Input, TextArea, Logo, Select, Modal, SupportButton } from '../components/UI';
import { Plus, Edit3, Copy, Download, Trash2, AlertTriangle, FileJson, Lightbulb, X } from 'lucide-react';

interface CustomCommand {
  name: string;
  formula: string;
}

interface RollTemplate {
  name: string;
  formula: string;
}

const Options: React.FC = () => {
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
      // Load built-in templates dynamically
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

      // Load custom commands
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
    
    // If we renamed it, delete the old one
    if (editingKey && editingKey !== commandKey) {
      delete newCommands[editingKey];
    }
    
    newCommands[commandKey] = { name, formula };
    await chrome.storage.local.set({ customMessageTypes: newCommands });
    setCommands(newCommands);
    setEditingKey(null);
    setEditName('');
    setEditFormula('');
    // No alert for success, just a UI transition
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
          content: 'Failed to parse JSON file. Please ensure it is a valid Pixels roll template.',
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
      // Silent load
    } else if (type === 'builtin' && builtInTemplates.has(key)) {
      const template = builtInTemplates.get(key)!;
      setEditingKey(null); // Treat as new if loading from built-in
      setEditName(template.name);
      setEditFormula(template.formula);
      // Silent load
    }
  };

  return (
    <div className="max-w-[800px] mx-auto p-12 text-text-main pb-24">
      <div className="flex items-center justify-between mb-12">
        <h1 className="text-4xl font-black tracking-tighter flex items-center gap-4 italic text-accent">
          <Logo size={64} />
          Roll Templates
        </h1>
        <Button onClick={handleNew} className="bg-success hover:bg-green-600 px-6 py-3 font-bold uppercase tracking-widest text-sm shadow-lg shadow-success/20">
          <Plus size={18} strokeWidth={3} />
          New Command
        </Button>
      </div>
      
      <div className="space-y-12">
        {/* Editor Card */}
        <Card className="border-accent/30 shadow-2xl shadow-accent/5 backdrop-blur-md bg-surface/80">
          <h2 className="text-xl font-black mb-6 uppercase tracking-widest text-accent flex items-center gap-2">
            {editingKey ? 'edit Template' : 'Create Template'}
            <span className="h-px flex-1 bg-accent/20"></span>
          </h2>
          
          <div className="space-y-6">
            <div className="bg-accent/5 p-4 rounded-xl border border-accent/20 mb-8">
              <span className="label-text block mb-2 font-bold uppercase tracking-wider text-xs text-accent">Load from Library</span>
              <Select 
                value=""
                onChange={handleTemplateLoad}
                options={allAvailableTypes}
                className="bg-surface/50 border-accent/30"
              />
              <p className="text-[0.7rem] text-text-muted mt-2 opacity-60">Select an existing template to load its formula into the editor below.</p>
            </div>

            <div>
              <span className="label-text block mb-2 font-bold uppercase tracking-wider text-xs text-text-muted">Display Name</span>
              <Input 
                value={editName} 
                onChange={(e) => setEditName(e.target.value)} 
                placeholder="e.g. Fireball Damage"
                maxLength={32}
                className="text-lg font-bold"
              />
            </div>
            
            <div>
              <span className="label-text block mb-2 font-bold uppercase tracking-wider text-xs text-text-muted">Roll Formula</span>
              <TextArea 
                value={editFormula}
                onChange={(e) => setEditFormula(e.target.value)}
                placeholder="/roll #face_value"
                className="h-32 font-mono text-[1.1rem] leading-relaxed bg-black/20"
              />
              <div className="bg-accent/10 border border-accent/20 p-4 rounded-xl mt-4 text-sm text-text-muted flex gap-3 items-start">
                <Lightbulb size={20} className="text-accent shrink-0 mt-0.5" />
                <div>
                  <p className="mb-2"><b>Variables:</b> Use these placeholder keys to inject real-time data from your dice:</p>
                  <div className="flex flex-wrap gap-2">
                    <code className="bg-surface px-2 py-1 rounded border border-border-main text-accent">#face_value</code>
                    <code className="bg-surface px-2 py-1 rounded border border-border-main text-accent">#die_type</code>
                    <code className="bg-surface px-2 py-1 rounded border border-border-main text-accent">#die_name</code>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="pt-4 flex gap-4">
              <Button onClick={handleSave} className="flex-1 py-4 bg-success hover:bg-green-600 shadow-xl shadow-success/20">
                {editingKey ? 'Update Command' : 'Save New Command'}
              </Button>
              {editingKey && (
                <Button variant="secondary" onClick={handleNew} className="px-8">Cancel</Button>
              )}
            </div>
          </div>
        </Card>

        {/* List Card */}
        <Card className="border-border-main/50">
          <h2 className="text-xl font-black mb-8 uppercase tracking-widest text-text-muted flex items-center gap-2">
            Your Library
            <span className="h-px flex-1 bg-border-main/20"></span>
          </h2>
          
          <div className="space-y-4">
            {Object.entries(commands).length === 0 ? (
              <div className="text-center py-16 bg-card-bg/50 rounded-2xl border-2 border-dashed border-border-main/30">
                <p className="text-text-muted text-lg italic italic">Your command library is empty.</p>
                <p className="text-sm opacity-60 mt-2">Use the editor above or import a file to get started.</p>
              </div>
            ) : (
              Object.entries(commands).map(([key, cmd]) => (
                <div key={key} className="bg-card-bg/70 p-5 rounded-2xl flex justify-between items-center border border-border-main hover:border-accent transition-all group">
                  <div className="flex-1 min-w-0 pr-4 text-left">
                    <div className="font-black text-xl text-accent mb-1 tracking-tight">{cmd.name || key}</div>
                    <div className="text-sm font-mono text-text-muted truncate bg-black/10 px-3 py-1 rounded-lg inline-block max-w-full">
                      {cmd.formula}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Button variant="secondary" className="p-2 hover:text-accent" title="Edit" onClick={() => handleEdit(key)}>
                      <Edit3 size={18} />
                    </Button>
                    <Button variant="secondary" className="p-2 hover:text-accent" title="Duplicate" onClick={() => handleDuplicate(key)}>
                      <Copy size={18} />
                    </Button>
                    <Button variant="secondary" className="p-2 hover:text-accent" title="Export" onClick={() => handleExport(key)}>
                      <Download size={18} />
                    </Button>
                    <div className="w-px h-6 bg-border-main/50 mx-1"></div>
                    <Button variant="danger" className="p-2 opacity-50 hover:opacity-100" title="Delete" onClick={() => handleDelete(key)}>
                      <Trash2 size={18} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Tools Card */}
        <Card className="border-warning/20 bg-warning/5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-lg text-warning mb-1">Advanced Tools</h3>
              <p className="text-sm text-text-muted">Import existing commands or wipe your library.</p>
            </div>
            <div className="flex gap-4">
              <Button onClick={handleImportClick} variant="secondary" className="bg-warning/10 border-warning text-warning hover:bg-warning hover:text-white">
                <FileJson size={18} />
                Import JSON
              </Button>
              <Button variant="danger" onClick={() => {
                setModal({
                  isOpen: true,
                  title: 'Wipe Library?',
                  content: 'This will permanently delete all custom commands. This action cannot be undone.',
                  variant: 'danger',
                  onConfirm: handleClearAll
                });
              }}>
                <Trash2 size={18} />
                Clear All
              </Button>
            </div>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".json" 
            className="hidden" 
          />
        </Card>
      </div>
      
      <Modal
        isOpen={modal.isOpen}
        onClose={() => setModal({ ...modal, isOpen: false })}
        title={modal.title}
        variant={modal.variant}
        actions={
          modal.onConfirm ? (
            <>
              <Button variant={modal.variant === 'danger' ? 'danger' : 'primary'} onClick={modal.onConfirm}>Confirm</Button>
              <Button variant="secondary" onClick={() => setModal({ ...modal, isOpen: false })}>Cancel</Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setModal({ ...modal, isOpen: false })}>Close</Button>
          )
        }
      >
        {modal.content}
      </Modal>
      <SupportButton />
    </div>
  );
};

export default Options;
