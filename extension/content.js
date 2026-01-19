console.log('[FP-DEBUG] Script loaded and running...');

let currentMatchId = null;
let isWindowVisible = false;
let currentPredictionData = null;
let lastSeenMatchId = null;

const networkObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        const match = entry.name.match(/(1-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
        if (match && match[1]) {
            lastSeenMatchId = match[1];
            console.log('[FP-DEBUG] NetworkObserver caught ID:', lastSeenMatchId);
        }
    }
});
networkObserver.observe({entryTypes: ['resource']});


const STORAGE_KEY = 'fp_window_settings';
let windowSettings = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
    top: '100px',
    left: '50%',
    width: '320px',
    height: 'auto',
    transform: 'translateX(-50%)'
};


function saveWindowSettings(element) {
    const rect = element.getBoundingClientRect();
    windowSettings = {
        top: rect.top + 'px',
        left: rect.left + 'px',
        width: element.style.width,
        height: element.style.height,
        transform: 'none'
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(windowSettings));
}


function createInterface() {
    if (document.getElementById('faceit-predictor-fab')) return;

    const imgUrl = chrome.runtime.getURL("logo.png");

    const fab = document.createElement('div');
    fab.id = 'faceit-predictor-fab';
    fab.innerHTML = `<img src="${imgUrl}" alt="Open Predictor">`;
    fab.onclick = toggleWindow;
    document.body.appendChild(fab);

    const windowEl = document.createElement('div');
    windowEl.id = 'faceit-predict-window';

    windowEl.style.top = windowSettings.top;
    windowEl.style.left = windowSettings.left;
    windowEl.style.width = windowSettings.width;
    windowEl.style.height = windowSettings.height;
    if (windowSettings.transform) windowEl.style.transform = windowSettings.transform;

    windowEl.innerHTML = `
        <div class="window-header" id="fp-header">
            <div class="header-left">
                <img src="${imgUrl}" class="header-logo" alt="">
                <span class="window-title">PREDICTOR</span>
            </div>
            <span class="minimize-btn no-drag" id="fp-minimize">−</span>
        </div>
        <div class="window-content" id="fp-content">
        </div>
    `;
    document.body.appendChild(windowEl);

    document.getElementById('fp-minimize').onclick = (e) => {
        e.stopPropagation();
        toggleWindow();
    };

    makeDraggable(windowEl);

    new ResizeObserver(() => {
        if (isWindowVisible) saveWindowSettings(windowEl);
    }).observe(windowEl);

    checkCurrentPage();
}


function toggleWindow() {
    const win = document.getElementById('faceit-predict-window');
    isWindowVisible = !isWindowVisible;
    win.style.display = isWindowVisible ? 'flex' : 'none';

    if (isWindowVisible) {
        checkCurrentPage();
    }
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    element.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        if (e.target.closest('.no-drag')) return;

        const rect = element.getBoundingClientRect();
        const isResizeZone = (e.clientX > rect.right - 20) && (e.clientY > rect.bottom - 20);

        if (isResizeZone) return;

        e.preventDefault();

        if (element.style.transform && element.style.transform !== 'none') {
            element.style.left = rect.left + "px";
            element.style.top = rect.top + "px";
            element.style.transform = "none";
        }

        pos3 = e.clientX;
        pos4 = e.clientY;

        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;

        element.classList.add('is-dragging');
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        let newTop = element.offsetTop - pos2;
        let newLeft = element.offsetLeft - pos1;

        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const elWidth = element.offsetWidth;
        const elHeight = element.offsetHeight;

        if (newTop < 0) {
            newTop = 0;
        } else if (newTop + elHeight > winHeight) {
            newTop = winHeight - elHeight;
        }

        if (newLeft < 0) {
            newLeft = 0;
        } else if (newLeft + elWidth > winWidth) {
            newLeft = winWidth - elWidth;
        }

        element.style.top = newTop + "px";
        element.style.left = newLeft + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        element.classList.remove('is-dragging');
        saveWindowSettings(element);
    }
}

window.addEventListener('resize', () => {
    const win = document.getElementById('faceit-predict-window');
    if (!win) return;

    const rect = win.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;

    let newTop = rect.top;
    let newLeft = rect.left;
    let updated = false;

    if (rect.bottom > winHeight) {
        newTop = Math.max(0, winHeight - rect.height);
        updated = true;
    }
    if (rect.right > winWidth) {
        newLeft = Math.max(0, winWidth - rect.width);
        updated = true;
    }

    if (updated) {
        win.style.top = newTop + "px";
        win.style.left = newLeft + "px";
        if (win.style.transform === 'translateX(-50%)') {
            win.style.transform = 'none';
        }
        saveWindowSettings(win);
    }
});


function getTeamNames() {
    const nameElements = document.querySelectorAll('[class*="FactionName"]');
    if (nameElements.length >= 2) {
        return {
            t1: nameElements[0].innerText.trim().replace(/^team_/i, ''),
            t2: nameElements[1].innerText.trim().replace(/^team_/i, '')
        };
    }
    return {t1: "Team 1", t2: "Team 2"};
}


function checkCurrentPage() {
    const match = window.location.pathname.match(/room\/([a-z0-9-]+)/i);
    const contentBox = document.getElementById('fp-content');

    if (!contentBox) return;

    if (match && match[1]) {
        const newMatchId = match[1];

        if (newMatchId !== currentMatchId || contentBox.innerHTML.includes('Please go to')) {
            currentMatchId = newMatchId;
            renderLoading();
            fetchPredictions(newMatchId);
        }
    } else {
        currentMatchId = null;
        renderMessage("Please go to the match page<br>to see predictions.");
    }
}

function renderMessage(msg) {
    const contentBox = document.getElementById('fp-content');
    contentBox.innerHTML = `<div class="message-box">${msg}</div>`;
}

function renderLoading() {
    renderMessage("Fetching data...<br>Waiting for response");
}


function findTeamNames() {
    const selectors = [
        '[class*="FactionName"]',
        '.FactionsDetails__FactionName-sc-b7b973f7-5',
        'h6[class*="FactionName"]'
    ];
    for (let selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length >= 2) {
            return {t1: elements[0].innerText.trim(), t2: elements[1].innerText.trim()};
        }
    }
    return null;
}

function pollTeamNames(attempts = 0) {
    const names = findTeamNames();
    if (names) {
        const t1Display = document.querySelector('#faceit-predict-window .team-t1-name');
        const t2Display = document.querySelector('#faceit-predict-window .team-t2-name');
        if (t1Display) t1Display.innerText = names.t1;
        if (t2Display) t2Display.innerText = names.t2;
    } else if (attempts < 20) {
        setTimeout(() => pollTeamNames(attempts + 1), 500);
    }
}


async function fetchPredictions(matchId) {
    try {
        const response = await fetch(`https://fc.blalex.ru/predict/${matchId}`);
        const data = await response.json();

        currentPredictionData = data;
        injectIntoVetoList(data);

        renderPanel(data);
        pollTeamNames();
    } catch (error) {
        console.error("Predictor Error:", error);
        renderMessage("Error loading data.<br>API might be down.");
    }
}

function renderPanel(data) {
    const contentBox = document.getElementById('fp-content');

    let rowsHtml = '';
    for (const [map, prob] of Object.entries(data.predictions)) {
        if (typeof prob === 'string' && prob.startsWith('Error')) continue;

        const probT2 = parseFloat(prob).toFixed(1);
        const probT1 = (100 - parseFloat(prob)).toFixed(1);
        const isActual = map.toLowerCase() === data.actual_map?.toLowerCase();

        rowsHtml += `
            <div class="map-row ${isActual ? 'is-actual' : ''}">
                <div class="row-main">
                    <span class="pct t1 ${probT1 >= 50 ? 'win' : 'loss'}">${probT1}%</span>
                    <span class="map-name">${map.toUpperCase()}</span>
                    <span class="pct t2 ${probT2 >= 50 ? 'win' : 'loss'}">${probT2}%</span>
                </div>
                <div class="bar-container">
                    <div class="bar-fill" style="width: ${probT1}%;"></div>
                </div>
            </div>
        `;
    }

    contentBox.innerHTML = `
        <div class="header-teams">
            <span class="team-n team-t1-name">LOADING...</span>
            <span class="team-n team-t2-name">LOADING...</span>
        </div>
        <div class="panel-body">${rowsHtml}</div>
        <div class="panel-footer">
            <div class="status">● API ACTIVE</div>
            <div>${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
        </div>
    `;
}


function injectIntoVetoList(data) {
    if (!data || !data.predictions) return;

    const teams = getTeamNames();
    const container = document.querySelector('.VetoList__Container-sc-33cc227e-0') ||
        document.querySelector('[class*="VetoList__Container"]');

    if (!container) return;

    const cards = container.querySelectorAll('[data-testid="matchPreference"]');

    cards.forEach(card => {
        const nameEl = card.querySelector('[class*="Name"]');
        if (!nameEl) return;

        const mapName = nameEl.innerText.trim();
        const prob = data.predictions[mapName] || data.predictions[mapName.toLowerCase()];

        if (prob !== undefined && typeof prob !== 'string') {
            const probVal = parseFloat(prob);
            const t1Win = (100 - probVal).toFixed(0);
            const t2Win = probVal.toFixed(0);

            let statBlock = card.querySelector('.fp-veto-stats');
            const stateKey = `${t1Win}-${teams.t1}-${teams.t2}`;

            if (statBlock && statBlock.dataset.state === stateKey) return;

            const isT2Winning = parseFloat(t2Win) > parseFloat(t1Win);
            const fillWidth = isT2Winning ? t2Win : t1Win;
            const barStyle = isT2Winning ? 'margin-left: auto;' : 'margin-right: auto;';

            const contentHtml = `
                <div class="fp-veto-row">
                    <div class="fp-team-block" style="justify-content: flex-start;">
                         <span class="fp-percent ${t1Win >= 50 ? 'fp-veto-win' : 'fp-veto-loss'}">${t1Win}%</span>
                    </div>
                    <div class="fp-team-block" style="justify-content: flex-end;">
                         <span class="fp-percent ${t2Win >= 50 ? 'fp-veto-win' : 'fp-veto-loss'}">${t2Win}%</span>
                    </div>
                </div>
                <div class="fp-veto-bar-bg">
                    <div class="fp-veto-bar-fill" style="width: ${fillWidth}%; ${barStyle}"></div>
                </div>
            `;

            if (!statBlock) {
                statBlock = document.createElement('div');
                statBlock.className = 'fp-veto-stats';
                const textHolder = card.querySelector('[class*="TextHolder"]');
                if (textHolder) {
                    textHolder.appendChild(statBlock);
                }
            }

            statBlock.innerHTML = contentHtml;
            statBlock.dataset.state = stateKey;
        }
    });
}


let processedModal = null;

function checkForMatchReadyModal() {
    const modal = document.querySelector('div[data-dialog-type="MODAL"]');

    if (!modal) {
        processedModal = null;
        return;
    }
    if (modal === processedModal) return;

    const hasMatchReadyText = Array.from(modal.querySelectorAll('*')).some(el => {
        if (!el.innerText) return false;
        const text = el.innerText.toLowerCase();
        return text.includes('match ready') || text.includes('матч') || text.includes('match');
    });

    if (!hasMatchReadyText) return;

    console.log('[FP-DEBUG] Match Ready modal DETECTED!');
    processedModal = modal;

    const lastDiv = modal.lastElementChild;
    const infoBox = document.createElement('div');
    infoBox.className = 'fp-modal-info';
    infoBox.innerHTML = '<div class="fp-modal-loading">Scanning network for Match ID...</div>';

    if (lastDiv) {
        modal.insertBefore(infoBox, lastDiv);
    } else {
        modal.appendChild(infoBox);
    }

    findAndFetchMatchInfo(infoBox);
}

function findAndFetchMatchInfo(infoBox) {
    let attempts = 0;
    const maxAttempts = 60;

    const scanInterval = setInterval(async () => {
        attempts++;
        const matchId = getMatchIdFromPerformance();

        if (matchId) {
            clearInterval(scanInterval);
            console.log(`[FP-DEBUG] FOUND Match ID: ${matchId}`);
            infoBox.innerHTML = '<div class="fp-modal-loading">ID found. Fetching data...</div>';
            await fetchAndDisplayData(matchId, infoBox);
        } else {
            if (attempts >= maxAttempts) {
                clearInterval(scanInterval);
                infoBox.innerHTML = '<div class="fp-modal-loading">Info not available (ID not found)</div>';
            }
        }
    }, 500);
}

function getMatchIdFromPerformance() {
    if (lastSeenMatchId) return lastSeenMatchId;

    const urlMatch = window.location.pathname.match(/(1-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    if (urlMatch) return urlMatch[1];

    const resources = performance.getEntriesByType('resource');
    for (let i = resources.length - 1; i >= 0; i--) {
        const url = resources[i].name;
        const match = url.match(/(1-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
        if (match && match[1]) {
            lastSeenMatchId = match[1];
            return match[1];
        }
    }

    const modalLinks = document.querySelectorAll('a[href*="/room/"]');
    for (let link of modalLinks) {
        const m = link.href.match(/(1-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
        if (m) return m[1];
    }

    return null;
}

async function fetchAndDisplayData(matchId, infoBox) {
    const apiUrl = `https://www.faceit.com/api/match/v2/match/${matchId}`;

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

        const json = await res.json();
        const payload = json.payload;
        if (!payload) throw new Error('No payload in JSON');

        let locationNames = [];
        if (payload.locations && Array.isArray(payload.locations)) {
            locationNames = payload.locations.map(l => l.name);
        }
        const locationDisplayStr = locationNames.length > 0 ? locationNames.join(', ') : "Unknown";

        const tags = payload.tags || [];
        const maps = [];
        const otherTags = [];

        tags.forEach(tag => {
            if (tag.includes('de_')) {
                const parts = tag.split(',');
                parts.forEach(p => {
                    const cleanP = p.trim();
                    if (cleanP.startsWith('de_')) {
                        maps.push(cleanP.replace(/^de_/i, '').toUpperCase());
                    }
                });
            } else {
                const tagParts = tag.split(',').map(t => t.trim());

                const isLocationTag = locationNames.length > 0 && tagParts.every(part => locationNames.includes(part));

                if (!isLocationTag && tag !== locationDisplayStr) {
                    otherTags.push(tag);
                }
            }
        });

        let mapsDisplay = maps.length > 0 ? maps.join(', ') : '<span style="color:#888">VETO / Unknown</span>';

        let tagsHtml = `<span class="fp-tag loc-tag" title="${locationDisplayStr}">${locationDisplayStr}</span>`;

        tagsHtml += otherTags.slice(0, 10).map(t => `<span class="fp-tag">${t}</span>`).join('');

        infoBox.innerHTML = `
            <div class="fp-info-row">
                <span class="fp-label">Maps:</span>
                <div class="fp-value" style="word-break: break-word;">
                     ${mapsDisplay}
                </div>
            </div>
            <div class="fp-info-row">
                <span class="fp-label">Info:</span>
                <div class="fp-tags-container">
                    ${tagsHtml}
                </div>
            </div>
        `;

    } catch (e) {
        console.error('[FP-DEBUG] API Fetch Error:', e);
        infoBox.innerHTML = `<div class="fp-modal-loading" style="color: #ef4444">Error loading data: ${e.message}</div>`;
    }
}


let debounceTimer;
let lastUrl = location.href;

const observer = new MutationObserver(() => {
    checkForMatchReadyModal();

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (location.href !== lastUrl) {
            console.log('[FP-DEBUG] URL Changed to:', location.href);
            lastUrl = location.href;
            checkCurrentPage();
        }

        if (currentMatchId && currentPredictionData) {
            injectIntoVetoList(currentPredictionData);
        }
    }, 200);
});

observer.observe(document.body, {subtree: true, childList: true});

createInterface();