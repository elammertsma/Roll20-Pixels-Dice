import React, { useState, useEffect } from 'react';
import { Logo, Modal, Button, SupportButton } from '../components/UI';
import { Dice5, ScrollText, Settings as SettingsIcon, LayoutDashboard, ExternalLink, ShieldAlert, Zap } from 'lucide-react';
import DiceTab from './DiceTab';
import TemplatesTab from './TemplatesTab';
import SettingsTab from './SettingsTab';
import ModifiersTab from './ModifiersTab';

const Hub: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dice' | 'templates' | 'settings' | 'modifiers'>('dice');
  const [connectedCount, setConnectedCount] = useState(0);

  // Handle URL parameters for tab selection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'dice' || tab === 'templates' || tab === 'settings' || tab === 'modifiers') {
      setActiveTab(tab);
    }
  }, []);

  // Update connected count
  useEffect(() => {
    const updateCount = () => {
      chrome.runtime.sendMessage({ type: 'getDiceStatus' }, (response) => {
        if (Array.isArray(response)) {
          const connected = response.filter(d => d.status === 'ready' || d.status === 'rolling' || d.status === 'onFace').length;
          setConnectedCount(connected);
        }
      });
    };

    updateCount();
    const interval = setInterval(updateCount, 2000);
    return () => clearInterval(interval);
  }, []);

  // Warning before closing the tab
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only warn if dice are actually connected!
      if (connectedCount > 0) {
        e.preventDefault();
        e.returnValue = ''; // Browsers show a generic message anyway
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [connectedCount]);

  const TabButton: React.FC<{ 
    id: typeof activeTab, 
    icon: React.ReactNode, 
    label: string,
    badge?: number 
  }> = ({ id, icon, label, badge }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
        activeTab === id 
          ? 'bg-accent text-white shadow-lg shadow-accent/20' 
          : 'text-text-muted hover:bg-white/5 hover:text-text-main'
      }`}
    >
      <div className={`${activeTab === id ? 'text-white' : 'text-accent group-hover:scale-110 transition-transform'}`}>
        {icon}
      </div>
      <span className="font-bold tracking-tight">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className={`ml-auto text-[0.7rem] font-black px-2 py-0.5 rounded-full ${
          activeTab === id ? 'bg-white text-accent' : 'bg-accent text-white'
        }`}>
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-text-main flex font-sans">
      {/* Sidebar */}
      <aside className="w-72 border-r border-white/5 p-6 flex flex-col gap-8 bg-surface/50 backdrop-blur-xl sticky top-0 h-screen">
        <div className="flex items-center gap-3 px-2">
          <Logo size={40} className="drop-shadow-glow" />
          <div>
            <h1 className="text-xl font-black italic tracking-tighter text-accent leading-none">PIXELS HUB</h1>
            <p className="text-[0.65rem] uppercase tracking-widest font-bold text-text-muted mt-1 opacity-50">Roll20 Integration</p>
          </div>
        </div>

        <nav className="flex flex-col gap-2">
          <TabButton id="dice" icon={<Dice5 size={20} />} label="My Dice" badge={connectedCount} />
          <TabButton id="templates" icon={<ScrollText size={20} />} label="Roll Templates" />
          <TabButton id="modifiers" icon={<Zap size={20} />} label="Custom Modifiers" />
          <TabButton id="settings" icon={<SettingsIcon size={20} />} label="Settings" />
        </nav>

        <div className="mt-auto">
          <a 
            href="https://app.roll20.net" 
            target="_blank" 
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-text-muted hover:text-text-main hover:bg-white/5 transition-all text-sm font-bold"
          >
            <ExternalLink size={18} />
            Back to Roll20
          </a>
          
          <div className="mt-4 p-4 rounded-2xl bg-warning/5 border border-warning/10">
            <div className="flex items-center gap-2 text-warning mb-1">
              <ShieldAlert size={14} />
              <span className="text-[0.7rem] font-black uppercase tracking-wider">Keep this tab open</span>
            </div>
            <p className="text-[0.65rem] text-text-muted leading-relaxed">
              Dice connectivity requires this tab to remain active in your browser.
            </p>
          </div>
        </div>
      </aside>

      {/* Content Area */}
      <main className="flex-1 p-12 overflow-y-auto">
        <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'dice' && <DiceTab />}
          {activeTab === 'templates' && <TemplatesTab />}
          {activeTab === 'modifiers' && <ModifiersTab />}
          {activeTab === 'settings' && <SettingsTab />}
          <SupportButton />
        </div>
      </main>
    </div>
  );
};

export default Hub;
