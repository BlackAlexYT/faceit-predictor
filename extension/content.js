let currentMatchId = null;
let isWindowVisible = false;
let currentPredictionData = null;

const STORAGE_KEY = 'fp_window_settings';
let windowSettings = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
    top: 100,
    left: window.innerWidth - 350,
    width: 320,
    height: 250
};


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
    windowEl.style.top = windowSettings.top + 'px';
    windowEl.style.left = windowSettings.left + 'px';
    windowEl.style.width = windowSettings.width + 'px';
    windowEl.style.height = windowSettings.height + 'px';

    windowEl.innerHTML = `
        <div class="resizer n"></div>
        <div class="resizer s"></div>
        <div class="resizer e"></div>
        <div class="resizer w"></div>
        <div class="resizer ne"></div>
        <div class="resizer nw"></div>
        <div class="resizer se"></div>
        <div class="resizer sw"></div>
        
        <div class="window-header" id="fp-header">
            <div class="header-left">
                <img src="${imgUrl}" class="header-logo" alt="">
                <span class="window-title">PREDICTOR</span>
            </div>
            <span class="minimize-btn no-drag" id="fp-minimize">−</span>
        </div>
        <div class="window-content" id="fp-content">
            <div class="message-box">Navigate to a match room<br>to see predictions.</div>
        </div>
        <div class="panel-footer">
            <div class="status">● READY</div>
        </div>
    `;
    document.body.appendChild(windowEl);

    document.getElementById('fp-minimize').onclick = (e) => {
        e.stopPropagation();
        toggleWindow();
    };

    initDrag(windowEl);
    initResize(windowEl);
    checkCurrentPage();
}


function toggleWindow() {
    const win = document.getElementById('faceit-predict-window');
    isWindowVisible = !isWindowVisible;
    win.style.display = isWindowVisible ? 'flex' : 'none';
    if (isWindowVisible) checkCurrentPage();
}

function saveWindowSettings(element) {
    const rect = element.getBoundingClientRect();
    windowSettings = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(windowSettings));
}

function getTeamNames() {
    const nameElements = document.querySelectorAll('[class*="FactionName"]');

    if (nameElements.length >= 2) {
        return {
            t1: nameElements[0].innerText.trim().replace(/^team_/i, ''),
            t2: nameElements[1].innerText.trim().replace(/^team_/i, '')
        };
    }
    return { t1: "", t2: "" };
}

function checkCurrentPage() {
    const match = window.location.pathname.match(/room\/([a-z0-9-]+)/i);

    if (match && match[1]) {
        const newMatchId = match[1];
        if (newMatchId !== currentMatchId) {
            currentMatchId = newMatchId;
            renderLoading();
            fetchPredictions(newMatchId);
        } else if (currentPredictionData) {
            injectIntoVetoList(currentPredictionData);
        }
    } else {
        currentMatchId = null;
        currentPredictionData = null;
        renderMessage("Go to match room");
    }
}

function renderLoading() {
    const content = document.getElementById('fp-content');
    if(content) content.innerHTML = '<div class="message-box">Loading data...</div>';
}

function renderMessage(msg) {
    const content = document.getElementById('fp-content');
    if(content) content.innerHTML = `<div class="message-box">${msg}</div>`;
}

async function fetchPredictions(matchId) {
    try {
        const response = await fetch(`https://fc.blalex.ru/predict/${matchId}`);
        const data = await response.json();
        currentPredictionData = data;

        renderPanel(data);
        injectIntoVetoList(data);

    } catch (error) {
        console.error("Predictor API Error:", error);
        renderMessage("API Error or Match not found");
    }
}

function renderPanel(data) {
    const contentBox = document.getElementById('fp-content');
    if (!contentBox) return;

    const teams = getTeamNames();
    let rowsHtml = '';
    const mapStats = data.predictions || {};

    for (const [map, prob] of Object.entries(mapStats)) {
        if (typeof prob === 'string' && prob.startsWith('Error')) continue;

        const probVal = parseFloat(prob);
        const t1Win = (100 - probVal).toFixed(0);
        const t2Win = probVal.toFixed(0);
        const isActual = data.actual_map && map.toLowerCase() === data.actual_map.toLowerCase();

        rowsHtml += `
            <div class="map-row ${isActual ? 'is-actual' : ''}">
                <span class="pct t1 ${t1Win > 50 ? 'win' : ''}">${t1Win}%</span>
                <span class="map-name">${map}</span>
                <span class="pct t2 ${t2Win > 50 ? 'win' : ''}">${t2Win}%</span>
                <div class="bar-container">
                     <div class="bar-fill" style="width: ${t1Win}%"></div>
                </div>
            </div>
        `;
    }

    const headerHtml = `
        <div style="display:flex; justify-content:space-between; padding: 0 5px 5px; font-size: 11px; color: #888; border-bottom: 1px solid #222; margin-bottom: 5px;">
            <span style="max-width: 45%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700;">${teams.t1}</span>
            <span style="max-width: 45%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700;">${teams.t2}</span>
        </div>
    `;

    contentBox.innerHTML = headerHtml + (rowsHtml || '<div class="message-box">No predictions available</div>');
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
                         <span class="fp-team-name" title="${teams.t1}">${teams.t1}</span>
                         <span class="fp-percent ${t1Win >= 50 ? 'fp-veto-win' : 'fp-veto-loss'}">${t1Win}%</span>
                    </div>
                    <div class="fp-team-block" style="justify-content: flex-end;">
                         <span class="fp-percent ${t2Win >= 50 ? 'fp-veto-win' : 'fp-veto-loss'}">${t2Win}%</span>
                         <span class="fp-team-name" title="${teams.t2}">${teams.t2}</span>
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

function initDrag(element) {
    const header = document.getElementById('fp-header');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.onmousedown = (e) => {
        if (e.target.closest('.no-drag')) return;
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = element.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        document.onmousemove = (e) => {
            if (!isDragging) return;
            element.style.left = `${initialLeft + (e.clientX - startX)}px`;
            element.style.top = `${initialTop + (e.clientY - startY)}px`;
        };
        document.onmouseup = () => {
            isDragging = false;
            document.onmousemove = null;
            document.onmouseup = null;
            saveWindowSettings(element);
        };
    };
}

function initResize(element) {
    const resizers = element.querySelectorAll('.resizer');
    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dir = resizer.className.replace('resizer ', '');
            const rect = element.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = rect.width;
            const startH = rect.height;
            const startL = rect.left;
            const startT = rect.top;

            const onMouseMove = (e) => {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                if (dir.includes('e')) element.style.width = `${Math.max(200, startW + dx)}px`;
                if (dir.includes('w')) {
                    const nw = Math.max(200, startW - dx);
                    element.style.width = `${nw}px`;
                    element.style.left = `${startL + (startW - nw)}px`;
                }
                if (dir.includes('s')) element.style.height = `${Math.max(150, startH + dy)}px`;
                if (dir.includes('n')) {
                    const nh = Math.max(150, startH - dy);
                    element.style.height = `${nh}px`;
                    element.style.top = `${startT + (startH - nh)}px`;
                }
            };
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                saveWindowSettings(element);
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}


let debounceTimer;
let lastUrl = location.href;

const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            checkCurrentPage();
            return;
        }
        if (currentMatchId && currentPredictionData) {
            injectIntoVetoList(currentPredictionData);
        }
    }, 100);
});

observer.observe(document.body, { subtree: true, childList: true });

createInterface();