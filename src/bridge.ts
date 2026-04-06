import { Pixel } from "@systemic-games/pixels-core-connect";
import { repeatConnect, getPixel, requestPixel } from "@systemic-games/pixels-web-connect";

// Keep track of connected dice
const activeDice = new Map<string, Pixel>();

console.log('[Pixels Roll20] Bridge tab initialized');

// Basic UI update function
function updateUI() {
    const list = document.getElementById('diceList');
    if (!list) return;
    
    list.innerHTML = '';
    activeDice.forEach((pixel, id) => {
        const item = document.createElement('div');
        item.className = 'die-item';
        
        const battLevel = pixel.batteryLevel;
        const isCharging = pixel.isCharging;
        let battClass = '';
        if (isCharging) battClass = 'battery-charging';
        else if (battLevel <= 15) battClass = 'battery-critical';
        else if (battLevel <= 30) battClass = 'battery-low';

        item.innerHTML = `
            <div class="die-info">
                <span class="die-name">${pixel.name || 'Pixel'}</span>
                <div class="battery-container">
                    <div class="battery-icon">
                        <div class="battery-fill ${battClass}" style="width: ${battLevel}%"></div>
                    </div>
                    <span>${battLevel}%${isCharging ? ' ⚡' : ''}</span>
                </div>
            </div>
            <span class="tag">${pixel.status}</span>
        `;
        list.appendChild(item);
    });

    // Auto-close if no dice are left and we previously had some
    if (activeDice.size === 0 && (window as any).hadDice) {
        console.log('[Pixels Roll20] No dice left, auto-closing bridge...');
        window.close();
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // We target 'offscreen' messages for backward compatibility in routing, 
  // or we can use 'bridge'. Let's support both for now.
  if (message.target !== 'offscreen' && message.target !== 'bridge') return;

  if (message.type === 'connectToPixel') {
    handleConnectRequest(message.systemId).then(success => {
      sendResponse({ success });
      updateUI();
    }).catch(err => {
      console.error('[Pixels Roll20] Error in bridge connect:', err);
      sendResponse({ success: false, error: err?.message });
    });
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'disconnectPixel') {
    const pixel = activeDice.get(message.systemId);
    if (pixel) {
      pixel.disconnect().catch(console.error);
      activeDice.delete(message.systemId);
      updateUI();
    }
    sendResponse({ success: true });
    return false;
  }
});

async function handleConnectRequest(systemId: string): Promise<boolean> {
  console.log(`[Pixels Roll20] Bridge attempting to connect to systemId: ${systemId}`);
  
  if (activeDice.has(systemId)) {
    console.log('[Pixels Roll20] Die is already actively managed by bridge');
    return true;
  }

  // Diagnostic: Log what the browser actually sees for authorized devices
  const nav = navigator as any;
  if (nav.bluetooth && nav.bluetooth.getDevices) {
    const authorized = await nav.bluetooth.getDevices();
    console.log(`[Pixels Roll20] Internal authorized devices count: ${authorized.length}`);
    authorized.forEach((d: any) => console.log(` - Name: "${d.name || 'Unnamed'}", ID: "${d.id}"`));
  }

  // Retry loop for resolving the Pixel
  let pixel: Pixel | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    pixel = await getPixel(systemId);
    if (pixel) break;
    
    console.log(`[Pixels Roll20] getPixel returned undefined (attempt ${attempt}/3). Retrying in 1s...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  if (!pixel) {
    console.error(`[Pixels Roll20] Bridge could not resolve Pixel for systemId: ${systemId}`);
    return false;
  }

  try {
    console.log(`[Pixels Roll20] Found pixel ${pixel.name}. Entering repeatConnect...`);
    await repeatConnect(pixel, { retries: 3 });
    console.log('[Pixels Roll20] ✅ Die connected and ready in bridge!');
    
    activeDice.set(systemId, pixel);
    (window as any).hadDice = true;
    updateUI();
    
    // Register the die with background
    chrome.runtime.sendMessage({
      type: 'registerDie',
      dieId: pixel.pixelId.toString(),
      dieName: pixel.name,
      dieType: pixel.type || 'd20'
    }).catch(err => console.error('[Pixels Roll20] Bridge failed to register die:', err));

    setupPixelListeners(pixel);
    
    // Send initial status
    chrome.runtime.sendMessage({
      type: 'dieStatus',
      dieId: pixel.pixelId.toString(),
      isRolling: false
    });
    
    return true;
  } catch (error) {
    console.error('[Pixels Roll20] Bridge failed to establish connection:', error);
    throw error;
  }
}

function setupPixelListeners(pixel: Pixel) {
  // Set up roll event listener
  const rollHandler = (faceIndex: number) => {
    console.log('[Pixels Roll20] 🎲 Roll event received in bridge:', faceIndex);
    chrome.runtime.sendMessage({
      type: 'diceRoll',
      dieId: pixel.pixelId.toString(),
      face: faceIndex,
      dieType: pixel.type || 'd20'
    }).catch(err => console.error('[Pixels Roll20] Failed to send roll from bridge:', err));
  };
  pixel.addEventListener('roll', rollHandler);

  // Track rolling status using rollState event
  const rollStateHandler = (rollState: any) => {
    const isRolling = rollState?.state === 'rolling' || rollState?.state === 'onFace';
    chrome.runtime.sendMessage({
      type: 'dieStatus',
      dieId: pixel.pixelId.toString(),
      isRolling
    }).catch(err => console.error('[Pixels Roll20] Failed to send rolling status from bridge:', err));
  };
  pixel.addEventListener('rollState', rollStateHandler);

  // Track battery status
  const batteryHandler = (battery: { level: number; isCharging: boolean }) => {
    console.log(`[Pixels Roll20] Battery update for ${pixel.name}: ${battery.level}%`);
    updateUI();
  };
  pixel.addEventListener('battery', batteryHandler);

  // Track connection status for auto-close
  const statusHandler = (status: string) => {
    if (status === 'disconnected') {
      console.log(`[Pixels Roll20] Die ${pixel.name} disconnected, removing from bridge`);
      activeDice.delete(pixel.systemId);
      updateUI();
    }
  };
  pixel.addEventListener('statusChanged', (ev: any) => statusHandler(ev.status));
}

async function autoDiscoverDice() {
  console.log('[Pixels Roll20] Checking for authorized dice...');
  const nav = navigator as any;
  const warnBox = document.getElementById('experimentalWarn');

  if (!nav.bluetooth || !nav.bluetooth.getDevices) {
    console.warn('[Pixels Roll20] Web Bluetooth getDevices is not supported in this browser version');
    if (warnBox) warnBox.style.display = 'block';
    return;
  }

  try {
    const authorized = await nav.bluetooth.getDevices();
    console.log(`[Pixels Roll20] Found ${authorized.length} authorized devices in browser`);
    
    for (const device of authorized) {
      if (activeDice.has(device.id)) continue;
      console.log(`[Pixels Roll20] Auto-connecting to known device: ${device.name || 'Unnamed'} (${device.id})`);
      // We use the device.id directly as the systemId for getPixel
      handleConnectRequest(device.id).catch(err => {
        console.error(`[Pixels Roll20] Failed auto-connect for ${device.id}:`, err);
      });
    }
  } catch (error) {
    console.error('[Pixels Roll20] Error during auto-discovery:', error);
  }
}

// Pairing button handler
const pairBtn = document.getElementById('pairBtn');
async function startPairing() {
  if (pairBtn) (pairBtn as HTMLButtonElement).disabled = true;
  try {
    const pixel = await requestPixel();
    if (pixel) {
      console.log(`[Pixels Roll20] Paired successfully in bridge: ${pixel.name}`);
      
      // Save this die to known dice so we can auto-connect later
      const result = await chrome.storage.local.get(['savedDice']);
      const saved = result.savedDice || [];
      if (!saved.includes(pixel.systemId)) {
        saved.push(pixel.systemId);
        await chrome.storage.local.set({ savedDice: saved });
      }
      
      await handleConnectRequest(pixel.systemId);
    }
  } catch (error: any) {
    console.error('[Pixels Roll20] Pairing failed in bridge:', error);
    if (!error.message?.includes('cancelled')) {
      alert(`Pairing failed: ${error.message}`);
    }
  } finally {
    if (pairBtn) (pairBtn as HTMLButtonElement).disabled = false;
  }
}

if (pairBtn) {
  pairBtn.addEventListener('click', startPairing);
}

// Handle auto-pairing on load if coming from popup
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('action') === 'pair') {
  console.log('[Pixels Roll20] Triggered pairing via URL parameter');
  // We can't automatically trigger the picker without a gesture,
  // but we can highlight the button or just wait for the user to click.
  if (pairBtn) {
    (pairBtn as HTMLButtonElement).style.boxShadow = '0 0 15px #2196f3';
    (pairBtn as HTMLButtonElement).textContent = '👉 Click Here to Pair Your Dice';
  }
}

// Start auto-discovery immediately
autoDiscoverDice();

// Set favicon dynamically to ensure it works in all browser contexts
function forceFavicon() {
  const existingLinks = document.querySelectorAll("link[rel*='icon']");
  existingLinks.forEach(link => link.parentNode?.removeChild(link));
  
  const link = document.createElement('link');
  link.type = 'image/png';
  link.rel = 'icon';
  link.href = chrome.runtime.getURL('images/logo-64.png');
  document.head.appendChild(link);
  console.log('[Pixels Roll20] Favicon forced to:', link.href);
}

// Initial set and then repeat every 10s
forceFavicon();
setInterval(forceFavicon, 10000);

// Copy button logic
const copyBtn = document.getElementById('copyFlagBtn');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    const url = 'chrome://flags/#enable-web-bluetooth-new-permissions-backend';
    navigator.clipboard.writeText(url).then(() => {
      // Simple feedback
      const originalSvg = copyBtn.innerHTML;
      copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
      setTimeout(() => {
        copyBtn.innerHTML = originalSvg;
      }, 1500);
    }).catch(err => console.error('Failed to copy:', err));
  });
}
