import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Pixel } from "@systemic-games/pixels-core-connect";
import { repeatConnect, getPixel, requestPixel } from "@systemic-games/pixels-web-connect";
import { Button, Card, BatteryIcon, Logo, DieIcon, PhysicalDie, DieRow, SignalIcon } from '../components/UI';

interface DieStatus {
  dieId: string;
  dieName: string;
  status: string;
  battery: number;
  isCharging: boolean;
  isRolling: boolean;
  rssi?: number;
  lastResult?: number | null;
}

const Bridge: React.FC = () => {
  const [activeDice, setActiveDice] = useState<Map<string, Pixel>>(new Map());
  const [isPairing, setIsPairing] = useState<boolean>(false);
  const [showBluetoothFlag, setShowBluetoothFlag] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [hubDice, setHubDice] = useState<DieStatus[]>([]);
  const [lastResults, setLastResults] = useState<Map<string, number>>(new Map());

  const hadDiceRef = useRef<boolean>(false);

  const activeDiceRef = useRef(activeDice);
  useEffect(() => {
    activeDiceRef.current = activeDice;
  }, [activeDice]);

  const updateUI = useCallback(() => {
    // Force re-render for nested property changes using functional update
    // to ensure we never use a stale activeDice Map
    setActiveDice(prev => new Map(prev));
  }, []); // Dependencies are now empty because we use prev state functional update

  const setupPixelListeners = useCallback((pixel: Pixel) => {
    // Roll event handler
    const rollHandler = (faceIndex: number) => {
      console.log('[Pixels Roll20] 🎲 Roll event received in bridge:', faceIndex);
      setLastResults(prev => {
        const next = new Map(prev);
        next.set(pixel.pixelId.toString(), faceIndex);
        return next;
      });
      setTimeout(() => {
        setLastResults(prev => {
          const next = new Map(prev);
          next.delete(pixel.pixelId.toString());
          return next;
        });
      }, 2000);
      chrome.runtime.sendMessage({
        type: 'diceRoll',
        dieId: pixel.pixelId?.toString() || 'unknown',
        face: faceIndex,
        dieType: pixel.type || 'd20'
      }).catch(err => console.error('[Pixels Roll20] Failed to send roll from bridge:', err));
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
      console.log(`[Pixels Roll20] Battery update for ${pixel.name}: ${pixel.batteryLevel}%`);
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
      console.log(`[Pixels Roll20] Die ${pixel.name} status: ${status}`);

      // Update background hub
      chrome.runtime.sendMessage({
        type: 'dieStatus',
        dieId: pixel.pixelId?.toString() || 'unknown',
        isRolling: (pixel as any).rollState === 'rolling' || (pixel as any).rollState === 'onFace',
        status: status
      }).catch(() => { });

      if (status === 'disconnected') {
        console.log(`[Pixels Roll20] Die ${pixel.name} is now disconnected (keeping in list)`);
        // We do NOT remove it from activeDice immediately anymore. 
        // We keep it there to prevent the bridge from closing during hiccups.
        // The background hub already tracks the 'disconnected' status.
      }
      updateUI();
    };
    pixel.addEventListener('statusChanged', (ev: any) => statusHandler(ev.status));

    // RSSI handler
    const rssiHandler = (ev: { rssi: number }) => {
      chrome.runtime.sendMessage({
        type: 'dieStatus',
        dieId: pixel.pixelId?.toString() || 'unknown',
        isRolling: (pixel as any).rollState === 'rolling' || (pixel as any).rollState === 'onFace',
        status: pixel.status,
        rssi: ev.rssi
      }).catch(() => { });
      updateUI();
    };
    // Note: Library uses 'rssi' event when reportRssi is active
    (pixel as any).addEventListener('rssi', rssiHandler);
  }, [updateUI]);

  const handleConnectRequest = useCallback(async (systemId: string) => {
    // Check if already in progress or connected
    if (activeDiceRef.current.has(systemId)) {
      console.log('[Pixels Roll20] Already connected to:', systemId);
      return true;
    }

    console.log('[Pixels Roll20] Connecting to:', systemId);
    let pixel: Pixel | undefined;
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        pixel = await getPixel(systemId);
        if (pixel) break;
        console.log(`[Pixels Roll20] Attempt ${attempt} failed to get pixel object`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (!pixel) {
        console.error('[Pixels Roll20] Failed to get pixel object after 3 attempts');
        return false;
      }

      console.log('[Pixels Roll20] Establishing Bluetooth connection...');
      await repeatConnect(pixel, { retries: 3 });
      console.log('[Pixels Roll20] Bluetooth connection established for:', pixel.name);

      // Verify pixelId is available
      if (!pixel.pixelId) {
        console.warn('[Pixels Roll20] pixelId not available immediately, waiting...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setActiveDice(prev => {
        const next = new Map(prev);
        next.set(systemId, pixel!);
        return next;
      });
      hadDiceRef.current = true;

      const dieIdStr = pixel.pixelId?.toString() || 'unknown';
      console.log('[Pixels Roll20] Registering die with Hub:', dieIdStr);

      chrome.runtime.sendMessage({
        type: 'registerDie',
        dieId: dieIdStr,
        dieName: pixel.name,
        dieType: (pixel as any).dieType || 'd20',
        colorway: pixel.colorway
      }).catch(err => console.error('[Pixels Roll20] Failed to send registerDie message:', err));

      // Start RSSI reporting
      pixel.reportRssi(true, 5000).catch(() => { });

      setupPixelListeners(pixel);

      chrome.runtime.sendMessage({
        type: 'dieStatus',
        dieId: dieIdStr,
        isRolling: false,
        status: pixel.status
      }).catch(() => { });

      return true;
    } catch (error) {
      console.error('[Pixels Roll20] Critical connection error:', error);
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
      if (!error.message?.includes('cancelled')) {
        alert(`Pairing failed: ${error.message}`);
      }
    } finally {
      setIsPairing(false);
    }
  };

  useEffect(() => {
    // Auto-discovery
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
      } catch (e) {
        console.error('Discovery error:', e);
      }
    };
    autoDiscover();

    // Initial Hub fetch
    chrome.runtime.sendMessage({ type: 'getDiceStatus' }, (response) => {
      if (Array.isArray(response)) setHubDice(response);
    });

    // Message listener
    const messageListener = (message: any, sender: any, sendResponse: any) => {
      if (message.type === 'diceStatusUpdate' && Array.isArray(message.dice)) {
        setHubDice(message.dice);
        return;
      }

      if (message.type === 'dieStatusChanged') {
        // Fallback for generic updates
        chrome.runtime.sendMessage({ type: 'getDiceStatus' }, (r) => {
          if (Array.isArray(r)) setHubDice(r);
        });
      }

      if (message.target !== 'offscreen' && message.target !== 'bridge') return;

      if (message.type === 'connectToPixel') {
        handleConnectRequest(message.systemId).then(success => sendResponse({ success }));
        return true;
      }

      if (message.type === 'disconnectPixel') {
        const pixel = activeDiceRef.current.get(message.systemId);
        if (pixel) {
          pixel.disconnect().catch(console.error);
          setActiveDice(prev => {
            const next = new Map(prev);
            next.delete(message.systemId);
            return next;
          });
        }
        sendResponse({ success: true });
        return false;
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [handleConnectRequest]);

  // Note: Tab lifecycle is now managed exclusively by background.ts to ensure 
  // the bridge stays alive throughout the Roll20 session and survives signal hiccups.
  // window.close() logic has been moved/removed for stability.

  const copyFlag = () => {
    const url = 'chrome://flags/#enable-web-bluetooth-new-permissions-backend';
    navigator.clipboard.writeText(url).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const urlParams = new URLSearchParams(window.location.search);
  const shouldPair = urlParams.get('action') === 'pair';

  return (
    <div className="max-w-[500px] mx-auto p-4 text-text-main text-center">
      <div className="mb-6 flex flex-col items-center gap-4">
        <Logo size={64} className="animate-pulse" />
        <div className="status-header flex items-center justify-center gap-2 text-lg font-bold text-success">
          <div className="w-2.5 h-2.5 bg-success rounded-full animate-pulse shadow-[0_0_10px_rgba(76,175,80,0.4)]"></div>
          Pixels Bridge Active
        </div>
      </div>

      <div className="space-y-3 mb-6">
        {Array.from(activeDice.values()).map(pixel => {
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
        })}
      </div>

      <Button
        onClick={startPairing}
        disabled={isPairing}
        className={`w-full py-3 mb-6 text-lg ${shouldPair ? 'shadow-[0_0_15px_#2196f3]' : ''}`}
      >
        {isPairing ? 'Pairing...' : shouldPair ? 'Click Here to Pair Your Dice' : 'Pair New Die'}
      </Button>

      {showBluetoothFlag && (
        <div className="bg-card-bg border border-border-main p-4 rounded-lg text-sm text-text-muted">
          <strong className="block mb-2 text-warning">Optional: Automatic Reconnection</strong>
          <p className="mb-3">
            To enable silent, automatic reconnection, you can enable this Chrome flag:
          </p>
          <div className="bg-black text-white p-2 rounded flex items-left justify-start font-mono text-xs mb-3">
            <div className="w-full">chrome://flags/#enable-web-bluetooth-new-permissions-backend</div>
            <button onClick={copyFlag} className="p-1 hover:bg-white/10 rounded transition-colors">
              {isCopied ? (
                <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-[0.75rem] opacity-80">Copy it to your address bar, set to <b>Enabled</b>, and restart Chrome.</p>
        </div>
      )}
    </div>
  );
};

export default Bridge;
