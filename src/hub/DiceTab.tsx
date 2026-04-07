import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Pixel } from "@systemic-games/pixels-core-connect";
import { repeatConnect, getPixel, requestPixel } from "@systemic-games/pixels-web-connect";
import { Button, Card, PhysicalDie, DieRow, SignalIcon, Logo, Modal } from '../components/UI';
import { Plus, Bluetooth, Info, ShieldAlert, CheckCircle2, RefreshCw } from 'lucide-react';

const DiceTab: React.FC = () => {
  const [activeDice, setActiveDice] = useState<Map<string, Pixel>>(new Map());
  const [isPairing, setIsPairing] = useState<boolean>(false);
  const [showBluetoothFlag, setShowBluetoothFlag] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [hubDice, setHubDice] = useState<any[]>([]);
  const [connectError, setConnectError] = useState<string | null>(null);
  
  const activeDiceRef = useRef(activeDice);
  useEffect(() => {
    activeDiceRef.current = activeDice;
  }, [activeDice]);

  const updateUI = useCallback(() => {
    setActiveDice(prev => new Map(prev));
  }, []);

  const setupPixelListeners = useCallback((pixel: Pixel) => {
    // Roll event handler
    const rollHandler = (faceIndex: number) => {
      console.log('[Pixels Roll20 Hub] 🎲 Roll event received:', faceIndex);
      chrome.runtime.sendMessage({
        type: 'diceRoll',
        dieId: pixel.pixelId?.toString() || 'unknown',
        face: faceIndex,
        dieType: pixel.type || 'd20'
      }).catch(err => console.error('[Pixels Roll20] Failed to send roll:', err));
    };
    pixel.addEventListener('roll', rollHandler);

    // Roll state handler
    const rollStateHandler = (rollState: any) => {
      const state = rollState?.state;
      const isRolling = state === 'rolling' || state === 'handling';
      
      chrome.runtime.sendMessage({
        type: 'dieStatus',
        dieId: pixel.pixelId?.toString() || 'unknown',
        isRolling,
        status: state === 'crooked' ? 'crooked' : pixel.status
      }).catch(() => { });
    };
    pixel.addEventListener('rollState', rollStateHandler);

    // Battery handler
    const batteryHandler = () => {
      chrome.runtime.sendMessage({
        type: 'updateDieBattery',
        dieId: pixel.pixelId?.toString() || 'unknown',
        battery: pixel.batteryLevel,
        isCharging: pixel.isCharging
      }).catch(() => { });
      updateUI();
    };
    pixel.addEventListener('battery', batteryHandler);

    // Status handler
    const statusHandler = (status: string) => {
      chrome.runtime.sendMessage({
        type: 'dieStatus',
        dieId: pixel.pixelId?.toString() || 'unknown',
        isRolling: (pixel as any).rollState === 'rolling',
        status: status
      }).catch(() => { });
      updateUI();
    };
    pixel.addEventListener('statusChanged', (ev: any) => statusHandler(ev.status));

    // RSSI handler
    const rssiHandler = (ev: { rssi: number }) => {
      chrome.runtime.sendMessage({
        type: 'dieStatus',
        dieId: pixel.pixelId?.toString() || 'unknown',
        status: pixel.status,
        rssi: ev.rssi
      }).catch(() => { });
      updateUI();
    };
    (pixel as any).addEventListener('rssi', rssiHandler);
  }, [updateUI]);

  const handleConnectRequest = useCallback(async (systemId: string) => {
    if (activeDiceRef.current.has(systemId)) {
      console.log('[Pixels Roll20] Already connected to:', systemId);
      return true;
    }

    console.log('[Pixels Roll20 Hub] Connecting to:', systemId);
    let pixel: Pixel | undefined;
    try {
      pixel = await getPixel(systemId);
      if (!pixel) return false;

      await repeatConnect(pixel, { retries: 3 });
      
      setActiveDice(prev => {
        const next = new Map(prev);
        next.set(systemId, pixel!);
        return next;
      });

      const dieIdStr = pixel.pixelId?.toString() || 'unknown';
      chrome.runtime.sendMessage({
        type: 'registerDie',
        dieId: dieIdStr,
        dieName: pixel.name,
        dieType: (pixel as any).dieType || 'd20',
        colorway: pixel.colorway
      }).catch(() => { });

      pixel.reportRssi(true, 5000).catch(() => { });
      setupPixelListeners(pixel);

      chrome.runtime.sendMessage({
        type: 'dieStatus',
        dieId: dieIdStr,
        isRolling: false,
        status: pixel.status
      }).catch(() => { });

      return true;
    } catch (error: any) {
      console.error('[Pixels Roll20] Connection error:', error);
      let errorMsg = error.message || String(error);
      if (errorMsg.includes('out of range') || errorMsg.includes('code 19')) {
        errorMsg = "Your Pixel is out of range or turned off. Please bring it closer and try again.";
      }
      setConnectError(errorMsg);
      return false;
    }
  }, [setupPixelListeners]);

  const handleDisconnect = useCallback((systemId: string) => {
    const pixel = activeDice.get(systemId);
    if (pixel) {
      pixel.disconnect().catch(console.error);
      setActiveDice(prev => {
        const next = new Map(prev);
        next.delete(systemId);
        return next;
      });
      chrome.runtime.sendMessage({
        type: 'disconnect',
        dieId: pixel.pixelId.toString()
      });
    }
  }, [activeDice]);

  const startPairing = async () => {
    setIsPairing(true);
    try {
      const pixel = await requestPixel();
      if (pixel) {
        const result = await chrome.storage.local.get(['savedDice']);
        const saved = result.savedDice || [];
        if (!saved.includes(pixel.systemId)) {
          saved.push(pixel.systemId);
          await chrome.storage.local.set({ savedDice: saved });
        }
        await handleConnectRequest(pixel.systemId);
      }
    } catch (error: any) {
      console.error('[Pixels Roll20] Pairing failed:', error);
    } finally {
      setIsPairing(false);
    }
  };

  useEffect(() => {
    const autoDiscover = async () => {
      const nav = navigator as any;
      if (!nav.bluetooth || !nav.bluetooth.getDevices) {
        setShowBluetoothFlag(true);
        return;
      }
      try {
        const authorized = await nav.bluetooth.getDevices();
        for (const device of authorized) {
          if (!activeDiceRef.current.has(device.id)) {
            handleConnectRequest(device.id);
          }
        }
      } catch (e) { }
    };
    autoDiscover();

    chrome.runtime.sendMessage({ type: 'getDiceStatus' }, (response) => {
      if (Array.isArray(response)) setHubDice(response);
    });

    const messageListener = (message: any, sender: any, sendResponse: any) => {
      if (message.type === 'diceStatusUpdate' && Array.isArray(message.dice)) {
        setHubDice(message.dice);
        return;
      }
      if (message.type === 'dieStatusChanged') {
        chrome.runtime.sendMessage({ type: 'getDiceStatus' }, (r) => {
          if (Array.isArray(r)) setHubDice(r);
        });
      }
      if (message.type === 'connectToPixel') {
        handleConnectRequest(message.systemId).then(success => sendResponse({ success }));
        return true;
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [handleConnectRequest]);

  const copyFlag = () => {
    const url = 'chrome://flags/#enable-web-bluetooth-new-permissions-backend';
    navigator.clipboard.writeText(url).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-12">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight mb-2">Connected Dice</h2>
          <p className="text-text-muted opacity-60">Manage your Pixels and track their real-time state.</p>
        </div>
        <Button onClick={startPairing} className="bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20 px-6 py-3 font-black uppercase tracking-widest text-sm flex items-center gap-2">
          {isPairing ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} strokeWidth={3} />}
          Pair New Die
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from(activeDice.values()).length === 0 ? (
          <div className="col-span-2 text-center py-20 bg-surface/30 rounded-3xl border-2 border-dashed border-white/5">
            <Bluetooth size={48} className="mx-auto text-text-muted opacity-20 mb-4" />
            <p className="text-text-muted italic">No dice connected in this hub session.</p>
          </div>
        ) : (
          Array.from(activeDice.values()).map(pixel => {
            const hubDie = hubDice.find(d => d.dieId === pixel.pixelId.toString());
            const mergedDie = {
              ...hubDie,
              dieId: pixel.pixelId.toString(),
              name: pixel.name,
              dieType: (pixel as any).dieType || 'd20',
              battery: pixel.batteryLevel,
              isCharging: pixel.isCharging,
              rssi: (pixel as any).rssi,
              status: hubDie?.status || pixel.status,
              colorway: pixel.colorway
            };

            return (
              <DieRow
                key={pixel.systemId}
                die={mergedDie}
                onDisconnect={() => handleDisconnect(pixel.systemId)}
                showSignal={true}
              />
            );
          })
        )}
      </div>

      {showBluetoothFlag && (
        <Card className="bg-warning/5 border-warning/20">
          <div className="flex gap-4">
            <Info className="text-warning shrink-0" size={24} />
            <div className="text-sm">
              <strong className="block mb-1 text-warning uppercase font-black text-xs tracking-widest">Optional: Automatic Reconnection</strong>
              <p className="text-text-muted leading-relaxed mb-4">
                To enable silent, automatic reconnection, you can enable this Chrome flag:
              </p>
              <div className="bg-black/50 p-3 rounded-xl flex items-center justify-between font-mono text-xs mb-3 border border-white/5">
                <span className="truncate mr-4 opacity-70 italic">chrome://flags/#enable-web-bluetooth-new-permissions-backend</span>
                <button onClick={copyFlag} className="p-2 hover:bg-white/10 rounded-lg transition-colors shrink-0 text-accent" title="Copy Flag URL">
                  {isCopied ? <CheckCircle2 size={16} /> : <Plus size={16} className="rotate-45" />}
                </button>
              </div>
              <p className="text-[0.7rem] opacity-50">Copy to your address bar, set to <b>Enabled</b>, and restart Chrome.</p>
            </div>
          </div>
        </Card>
      )}

      <Modal
        isOpen={!!connectError}
        onClose={() => setConnectError(null)}
        title="Connection Error"
        variant="warning"
        actions={<Button onClick={() => setConnectError(null)}>Retry</Button>}
      >
        <p>{connectError}</p>
      </Modal>
    </div>
  );
};

export default DiceTab;
