import { Pixel } from "@systemic-games/pixels-web-connect";

// Keep track of bridge tab initialization
let bridgeTabId: number | null = null;

async function ensureBridgeTab(): Promise<number> {
  const url = chrome.runtime.getURL('bridge.html');
  
  // 1. Check if it's already open
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('bridge.html*') });
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    bridgeTabId = tabs[0].id;
    return bridgeTabId;
  }

  // 2. Find a Roll20 tab to place the bridge next to
  const roll20Tabs = await chrome.tabs.query({ url: '*://app.roll20.net/*' });
  const activeRoll20 = roll20Tabs.find(t => t.active) || roll20Tabs[0];

  // 3. Create it as a regular tab, ideally next to Roll20
  const tab = await chrome.tabs.create({
    url,
    pinned: false,
    active: false,
    index: activeRoll20 ? activeRoll20.index + 1 : undefined,
    windowId: activeRoll20 ? activeRoll20.windowId : undefined
  });

  if (tab.id === undefined) {
    throw new Error('Failed to create bridge tab');
  }

  bridgeTabId = tab.id;
  console.log('[Pixels Roll20] Bridge tab created (unpinned) next to Roll20');
  
  // Wait a moment for the bridge to initialize its message listeners
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return bridgeTabId;
}

interface DieStatus {
  id: string;
  name: string;
  battery: number;
  dieType: string;
  isRolling?: boolean;
}

interface RegisterDieMessage {
  type: 'registerDie';
  dieId: string;
  dieName: string;
  dieType: string;
}

interface DiceRollMessage {
  type: 'diceRoll';
  dieId: string;
  face: number;
  dieType: string;
}

interface DisconnectMessage {
  type: 'disconnect';
  dieId: string;
}

interface GetStatusMessage {
  type: 'getDiceStatus';
}

interface DieStatusMessage {
  type: 'dieStatus';
  dieId: string;
  isRolling: boolean;
}

type Message = RegisterDieMessage | DiceRollMessage | DisconnectMessage | GetStatusMessage | DieStatusMessage;

class DiceManager {
  // Track registered dice (metadata only, actual Pixel objects stay in popup)
  private registeredDice: Map<string, { name: string; dieType: string; battery: number; isRolling?: boolean }> = new Map();

  registerDie(dieId: string, dieName: string, dieType: string): void {
    this.registeredDice.set(dieId, {
      name: dieName,
      dieType,
      battery: 100,
      isRolling: false
    });
    console.log(`[Pixels Roll20] Registered die: ${dieName} (${dieId})`);
  }

  updateDieStatus(dieId: string, isRolling: boolean): void {
    const die = this.registeredDice.get(dieId);
    if (die) {
      die.isRolling = isRolling;
      console.log(`[Pixels Roll20] Die ${dieId} rolling status: ${isRolling}`);

      // Notify popup of status change by querying for the popup and sending message
      chrome.runtime.sendMessage({
        type: 'dieStatusChanged',
        dieId,
        isRolling
      }, () => {
        // Ignore errors - popup may not be open
        if (chrome.runtime.lastError) {
          console.log('[Pixels Roll20] Popup not open, status change not sent');
        }
      });
    }
  }

  async onDieRoll(dieId: string, faceValue: number, dieType: string): Promise<void> {
    console.log(`[Pixels Roll20] Die rolled: ${dieType} with face ${faceValue}`);

    // 1. Get the current template selection from storage
    chrome.storage.local.get(['lastSelectedMessageType', 'customRollTemplate', 'customMessageTypes'], async (result) => {
      let rollFormula = '/roll #face_value'; // Default fallback
      const selectedType = result.lastSelectedMessageType;

      try {
        if (selectedType && selectedType !== 'custom') {
          // Check if it's a custom-defined command first
          if (result.customMessageTypes && result.customMessageTypes[selectedType]) {
            rollFormula = result.customMessageTypes[selectedType].formula;
          } else {
            // It's a built-in template, fetch it directly from the file to be safe
            try {
              const fileUrl = chrome.runtime.getURL(`messageTypes/${selectedType}.json`);
              const response = await fetch(fileUrl);
              const data = await response.json();
              const messageData = data.message || data.roll;
              if (messageData && messageData.formula) {
                rollFormula = messageData.formula;
              }
            } catch (err) {
              console.warn(`[Pixels Roll20] Could not fetch built-in template ${selectedType}, using customRollTemplate fallback`);
              rollFormula = result.customRollTemplate || rollFormula;
            }
          }
        } else if (result.customRollTemplate) {
          rollFormula = result.customRollTemplate;
        }

        // 2. Process the formula
        const rollMessage = rollFormula.replace(/#face_value/g, faceValue.toString());
        console.log(`[Pixels Roll20] Sending to Roll20:`, rollMessage.substring(0, 100) + (rollMessage.length > 100 ? '...' : ''));

        // 3. Find and send to the Roll20 tab
        chrome.tabs.query({ url: '*://app.roll20.net/*' }, async (tabs) => {
          const roll20Tab = tabs.find(t => t.url?.includes('app.roll20.net'));
          if (!roll20Tab || !roll20Tab.id) {
            console.warn('[Pixels Roll20] No Roll20 tab found open');
            return;
          }

          const tabId = roll20Tab.id;
          const message = {
            type: 'diceRoll',
            face: faceValue,
            dieType,
            rollMessage
          };

          // Try sending the message first
          chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
              // If message fails, the script might not be injected
              console.log('[Pixels Roll20] Content script not responding, attempting to inject...');
              chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
              }).then(() => {
                // Try sending again once after injection
                setTimeout(() => {
                  chrome.tabs.sendMessage(tabId, message).catch(e => console.error('[Pixels Roll20] Retry failed:', e));
                }, 100);
              }).catch(err => console.error('[Pixels Roll20] Injection failed:', err));
            }
          });
        });
      } catch (error) {
        console.error('[Pixels Roll20] Error in onDieRoll:', error);
      }
    });
  }

  getDiceStatus(): DieStatus[] {
    return Array.from(this.registeredDice.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      battery: data.battery,
      dieType: data.dieType,
      isRolling: data.isRolling || false
    }));
  }

  disconnectDie(dieId: string): void {
    this.registeredDice.delete(dieId);
    console.log(`[Pixels Roll20] Disconnected die: ${dieId}`);

    // Remove from saved dice so it doesn't auto connect
    chrome.storage.local.get(['savedDice'], (result) => {
      const saved = result.savedDice || [];
      const updated = saved.filter((id: string) => id !== dieId);
      chrome.storage.local.set({ savedDice: updated });
    });

    // Tell bridge tab
    if (bridgeTabId !== null) {
      chrome.tabs.sendMessage(bridgeTabId, {
        target: 'bridge',
        type: 'disconnectPixel',
        systemId: dieId
      }).catch(e => console.log('Bridge tab might already be closed', e));
    }
  }
}

const diceManager = new DiceManager();

// Message handler
chrome.runtime.onMessage.addListener((
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
) => {
  const msg = message as any;

  if (!msg || typeof msg !== 'object' || !msg.type) {
    return false;
  }

  switch (msg.type) {
    case 'registerDie':
      diceManager.registerDie(msg.dieId, msg.dieName, msg.dieType);
      sendResponse({ success: true });
      return false;

    case 'diceRoll':
      diceManager.onDieRoll(msg.dieId, msg.face, msg.dieType);
      return false;

    case 'dieStatus':
      diceManager.updateDieStatus(msg.dieId, msg.isRolling);
      return false;

    case 'connectDie':
      console.log('[Pixels Roll20] Background received connectDie for systemId:', msg.systemId);
      ensureBridgeTab().then((tabId) => {
        chrome.tabs.sendMessage(tabId, {
          target: 'bridge',
          type: 'connectToPixel',
          systemId: msg.systemId
        });
      });
      return false;

    case 'disconnect':
      diceManager.disconnectDie(msg.dieId);
      sendResponse({ success: true });
      return false;

    case 'getDiceStatus':
      sendResponse(diceManager.getDiceStatus());
      return false;

    default:
      return false;
  }
});

// Auto-open popup when user switches back to Roll20 tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url && tab.url.includes('app.roll20.net')) {
      console.log('[Pixels Roll20] Roll20 tab activated, opening popup');
      try {
        chrome.action.openPopup();
      } catch (error) {
        console.log('[Pixels Roll20] Could not auto-open popup:', error);
      }
    }
  });
});

// Auto connect to saved dice on startup
chrome.runtime.onStartup.addListener(autoConnectDice);
chrome.runtime.onInstalled.addListener(autoConnectDice);

function autoConnectDice() {
  chrome.storage.local.get(['savedDice'], (result) => {
    const saved = result.savedDice || [];
    if (saved.length > 0) {
      console.log('[Pixels Roll20] Auto-opening bridge for saved dice:', saved);
      ensureBridgeTab();
      // The bridge handles its own discovery via autoDiscoverDice()
    }
  });
}

// Auto-close bridge tab when all Roll20 tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // Check if we still have any Roll20 tabs
  const roll20Tabs = await chrome.tabs.query({ url: '*://app.roll20.net/*' });
  
  if (roll20Tabs.length === 0) {
    console.log('[Pixels Roll20] No Roll20 tabs left, closing bridge if open');
    const bridgeTabs = await chrome.tabs.query({ url: chrome.runtime.getURL('bridge.html*') });
    for (const tab of bridgeTabs) {
      if (tab.id) {
        chrome.tabs.remove(tab.id).catch(e => console.log('Failed to close bridge:', e));
      }
    }
    bridgeTabId = null;
  }
});
