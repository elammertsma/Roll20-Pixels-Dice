import { Pixel, requestPixel } from "@systemic-games/pixels-web-connect";

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
