console.log('[FP-DEBUG] Script loaded and running...');

let currentMatchId = null;
let isWindowVisible = false;
let currentPredictionData = null;
let lastSeenMatchId = null;
let currentView = 'prediction';
let showMapsMode = false;


const DEFAULT_CONFIG = {
    rows: {
        life: false,
        rec50: true,
        rec5: true
    },
    columns: {
        matches: true,
        wr: true,
        kd: true,
        adr: true,
        avg_k: true,
        avg_a: false,
        avg_d: false,
        hs: false,
        rating: true
    },
    maps: {
        dust2: true,
        mirage: true,
        nuke: true,
        ancient: true,
        inferno: true,
        overpass: true,
        anubis: true,
    }
};

let userConfig = JSON.parse(localStorage.getItem('fp_user_config')) || DEFAULT_CONFIG;

const COLUMN_LABELS = {
    matches: "M",
    wr: "WR%",
    kd: "K/D",
    adr: "ADR",
    avg_k: "AVG K",
    avg_a: "AVG A",
    avg_d: "AVG D",
    hs: "HS%",
    rating: ""
};

const STAT_AVERAGES = {
    matches: 1000,
    wr: 47,
    kd: 1.05,
    adr: 70,
    hs: 44,
    avg_k: 14.5,
    avg_a: 4,
    avg_d: 14.5
};

const MAP_AVERAGES = {
    ancient: 92,
    anubis: 60,
    dust2: 114,
    inferno: 55,
    mirage: 161,
    nuke: 42,
    overpass: 18,
};

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
    fab.innerHTML = `<img src="${imgUrl}" alt="FP">`;
    fab.onclick = toggleWindow;
    document.body.appendChild(fab);

    const windowEl = document.createElement('div');
    windowEl.id = 'faceit-predict-window';

    windowEl.style.top = windowSettings.top;
    windowEl.style.left = windowSettings.left;
    windowEl.style.width = windowSettings.width;
    windowEl.style.height = windowSettings.height;
    if (windowSettings.transform) windowEl.style.transform = windowSettings.transform;

    const settingsIcon = `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`;
    const closeIcon = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

    windowEl.innerHTML = `
        <div class="window-header">
            <div class="header-left">
                <img src="${imgUrl}" class="header-logo" alt="">
                <span class="window-title">PREDICTOR</span>
            </div>
            <div class="header-controls">
                <div class="control-btn no-drag" id="fp-settings" title="Settings">${settingsIcon}</div>
                <div class="control-btn no-drag" id="fp-close" title="Close">${closeIcon}</div>
            </div>
        </div>
        <div class="window-content" id="fp-content"></div>
    `;
    document.body.appendChild(windowEl);

    document.getElementById('fp-close').onclick = (e) => {
        e.stopPropagation();
        toggleWindow();
    };
    document.getElementById('fp-settings').onclick = (e) => {
        e.stopPropagation();
        toggleSettingsView();
    };

    makeDraggable(windowEl);

    new ResizeObserver(() => {
        if (isWindowVisible) saveWindowSettings(windowEl);
    }).observe(windowEl);

    checkCurrentPage();
}

function toggleSettingsView() {
    currentView = currentView === 'prediction' ? 'settings' : 'prediction';
    if (currentView === 'settings') renderSettings();
    else {
        if (currentPredictionData) {
            renderPanel(currentPredictionData);
            injectPlayerStats(currentPredictionData);
        } else checkCurrentPage();
    }
}

function renderSettings() {
    const contentBox = document.getElementById('fp-content');

    const createCheckboxes = (obj, sectionKey) => {
        return Object.keys(obj).map(key => {
            let label = key.replace(/_/g, ' ').toUpperCase();
            if (COLUMN_LABELS[key]) label = COLUMN_LABELS[key];
            return `
            <label class="checkbox-row">
                <input type="checkbox" data-section="${sectionKey}" data-key="${key}" ${obj[key] ? 'checked' : ''}>
                ${label}
            </label>`;
        }).join('');
    };

    contentBox.innerHTML = `
        <div class="settings-view">
            <div class="settings-section">
                <h4>Displayed Rows</h4>
                <div class="settings-grid">
                    ${createCheckboxes(userConfig.rows, 'rows')}
                </div>
            </div>
            <div class="settings-section">
                <h4>Data Columns</h4>
                <div class="settings-grid">
                    ${createCheckboxes(userConfig.columns, 'columns')}
                </div>
            </div>
            <div class="settings-section">
                <h4>Maps to Show</h4>
                <div class="settings-grid">
                    ${createCheckboxes(userConfig.maps, 'maps')}
                </div>
            </div>
        </div>
    `;

    const inputs = contentBox.querySelectorAll('input[type="checkbox"]');
    inputs.forEach(input => {
        input.onchange = () => {
            const sec = input.dataset.section;
            const key = input.dataset.key;
            if (userConfig[sec]) userConfig[sec][key] = input.checked;
            localStorage.setItem('fp_user_config', JSON.stringify(userConfig));

            if (currentPredictionData) {
                injectPlayerStats(currentPredictionData);
            }
        };
    });
}

function getColor(val, type, mapName = null) {
    let avg;
    let isInverse = false;

    if (type === 'matches' && mapName) {
        avg = MAP_AVERAGES[mapName.toLowerCase()] || 100;
    } else {
        switch (type) {
            case 'matches':
                avg = STAT_AVERAGES.matches;
                break;
            case 'wr':
                avg = STAT_AVERAGES.wr;
                break;
            case 'kd':
                avg = STAT_AVERAGES.kd;
                break;
            case 'adr':
                avg = STAT_AVERAGES.adr;
                break;
            case 'hs':
                avg = STAT_AVERAGES.hs;
                break;
            case 'avg_k':
                avg = STAT_AVERAGES.avg_k;
                break;
            case 'avg_a':
                avg = STAT_AVERAGES.avg_a;
                break;
            case 'avg_d':
                avg = STAT_AVERAGES.avg_d;
                isInverse = true;
                break;
            case 'rating':
                avg = 10;
                break;
            default:
                avg = 0;
        }
    }

    if (!avg || val === null || val === undefined) return '#ccc';

    let score = 0;
    const diff = val - avg;

    if (type === 'wr') score = diff / 10;
    else if (type === 'kd') score = diff / 0.3;
    else if (type === 'adr') score = diff / 15;
    else if (type === 'hs') score = diff / 10;
    else if (type.includes('avg')) score = diff / 4;
    else if (type === 'matches') score = diff / (mapName ? (avg * 0.8) : 800);
    else if (type === 'rating') score = diff / 1.5;

    if (isInverse) score *= -1;

    score = Math.max(-1, Math.min(1, score));

    if (score >= 0) {
        const factor = score;
        const r = Math.round(255 + (34 - 255) * factor);
        const g = Math.round(215 + (197 - 215) * factor);
        const b = Math.round((94) * factor);
        return `rgb(${r},${g},${b})`;
    } else {
        const factor = Math.abs(score);
        const r = Math.round(255 + (239 - 255) * factor);
        const g = Math.round(215 + (68 - 215) * factor);
        const b = Math.round((68) * factor);
        return `rgb(${r},${g},${b})`;
    }
}

function injectPlayerStats(data, attempt = 0) {
    if (!data || !data.match_data) return;

    const activeCols = Object.keys(userConfig.columns).filter(k => userConfig.columns[k]);
    const gridTemplate = `60px repeat(${activeCols.length}, 1fr)`;

    const fmt = (val, type, mapName = null) => {
        if (val === undefined || val === null) return '-';
        const num = parseFloat(val);

        const color = getColor(num, type, mapName);

        let text = num.toFixed(0);
        if (type === 'wr' || type === 'hs') text = num.toFixed(0) + '%';
        else if (type === 'kd') text = num.toFixed(2);
        else if (type.includes('avg')) text = num.toFixed(1);

        return `<span style="color:${color}">${text}</span>`;
    };

    const buildRow = (label, dataPrefix, dataObj, isMapRow = false) => {
        let cells = `<div class="fp-cell label">${label}</div>`;
        const mapNameForColor = isMapRow ? label : null;

        activeCols.forEach(colKey => {
            if (colKey === 'rating') {
                const valKD = parseFloat(dataObj[`${dataPrefix}kd`] || STAT_AVERAGES.kd);
                const valWR = parseFloat(dataObj[`${dataPrefix}wr`] || STAT_AVERAGES.wr);
                const valADR = parseFloat(dataObj[`${dataPrefix}adr`] || STAT_AVERAGES.adr);
                const valK = parseFloat(dataObj[`${dataPrefix}k`] || STAT_AVERAGES.avg_k);
                const valM = parseFloat(dataObj[`${dataPrefix}matches`] || 0);

                let avgMatches = STAT_AVERAGES.matches;
                let includeMatches = true;

                if (label === 'LAST 5' || label === 'LAST 50') {
                    includeMatches = false;
                }
                else if (isMapRow && MAP_AVERAGES[label.toLowerCase()]) {
                    avgMatches = MAP_AVERAGES[label.toLowerCase()];
                }

                let totalScore = 0;

                totalScore += (valKD - STAT_AVERAGES.kd) / 0.3;

                totalScore += (valWR - STAT_AVERAGES.wr) / 10;

                totalScore += (valADR - STAT_AVERAGES.adr) / 15;

                totalScore += (valK - STAT_AVERAGES.avg_k) / 4;

                if (includeMatches) {
                    totalScore += (valM - avgMatches) / (avgMatches * 2);
                }

                const finalRating = 10 + totalScore;

                const color = getColor(finalRating, 'rating');

                cells += `<div class="fp-cell"><div class="fp-rating-square" style="background:${color}" title="Rating: ${finalRating.toFixed(2)}"></div></div>`;
                return;
            }

            let apiSuffix = '';
            switch (colKey) {
                case 'matches':
                    apiSuffix = 'matches';
                    break;
                case 'wr':
                    apiSuffix = 'wr';
                    break;
                case 'kd':
                    apiSuffix = 'kd';
                    break;
                case 'adr':
                    apiSuffix = 'adr';
                    break;
                case 'hs':
                    apiSuffix = 'hs';
                    break;
                case 'avg_k':
                    apiSuffix = 'k';
                    break;
                case 'avg_a':
                    apiSuffix = 'a';
                    break;
                case 'avg_d':
                    apiSuffix = 'd';
                    break;
            }

            let val = dataObj[`${dataPrefix}${apiSuffix}`];

            cells += `<div class="fp-cell">${fmt(val, colKey, mapNameForColor)}</div>`;
        });

        return `<div class="fp-table-row" style="grid-template-columns: ${gridTemplate}">${cells}</div>`;
    };

    const buildHeader = () => {
        const iconSvg = showMapsMode
            ? `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>` // List
            : `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>`; // Map

        let cells = `<div class="fp-col-header first">
                        <div class="fp-stats-toggle-btn" title="Toggle Maps/Stats">${iconSvg}</div>
                     </div>`;

        activeCols.forEach(col => {
            cells += `<div class="fp-col-header">${COLUMN_LABELS[col]}</div>`;
        });
        return `<div class="fp-table-header" style="grid-template-columns: ${gridTemplate}">${cells}</div>`;
    };

    const getTableHtml = (t, p) => {
        const d = data.match_data;
        const prefix = `t${t}_p${p}_`;
        let html = `<div class="fp-player-stats-table">`;
        html += buildHeader();

        if (!showMapsMode) {
            if (userConfig.rows.life) html += buildRow('LIFE', `${prefix}life_`, d);
            if (userConfig.rows.rec50) html += buildRow('LAST 50', `${prefix}rec50_`, d);
            if (userConfig.rows.rec5) html += buildRow('LAST 5', `${prefix}rec5_`, d);
        } else {
            const activeMaps = Object.keys(userConfig.maps).filter(m => userConfig.maps[m]);
            activeMaps.forEach(mapName => {
                const mapMatches = d[`${prefix}${mapName}_matches`];
                if (mapMatches && mapMatches > 0) {
                    const fullMapName = mapName.charAt(0).toUpperCase() + mapName.slice(1);
                    const shortName = mapName.substring(0, 3).toUpperCase();
                    html += `<div class="fp-row-map">${buildRow(shortName, `${prefix}${mapName}_`, d, fullMapName)}</div>`;
                }
            });
        }

        html += `</div>`;
        return html;
    };

    const roster1 = document.querySelector('div[name="roster1"]');
    const roster2 = document.querySelector('div[name="roster2"]');

    if ((!roster1 || !roster2) && attempt < 10) {
        setTimeout(() => injectPlayerStats(data, attempt + 1), 500);
        return;
    }

    const injectToRoster = (rosterEl, teamId) => {
        if (!rosterEl) return;
        const playerRows = rosterEl.querySelectorAll('[class*="ListContentPlayer__Background"]');
        playerRows.forEach((row, index) => {
            if (index > 4) return;

            const oldTable = row.querySelector('.fp-player-stats-table');
            if (oldTable) oldTable.remove();

            row.insertAdjacentHTML('beforeend', getTableHtml(teamId, index));

            const newTable = row.querySelector('.fp-player-stats-table');
            if (newTable) {
                const stopEvent = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                };
                newTable.addEventListener('click', stopEvent);
                newTable.addEventListener('mousedown', stopEvent);
                newTable.addEventListener('dblclick', stopEvent);

                const toggleBtn = newTable.querySelector('.fp-stats-toggle-btn');
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        showMapsMode = !showMapsMode;
                        if (currentPredictionData) {
                            injectPlayerStats(currentPredictionData);
                        }
                    });
                    toggleBtn.addEventListener('mousedown', (e) => e.stopPropagation());
                }
            }
        });
    };

    injectToRoster(roster1, 1);
    injectToRoster(roster2, 2);
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
        injectPlayerStats(data);

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

    const currentNames = getTeamNames();

    contentBox.innerHTML = `
        <div class="header-teams">
            <span class="team-n team-t1-name">${currentNames.t1}</span>
            <span class="team-n team-t2-name">${currentNames.t2}</span>
        </div>
        <div class="panel-body">${rowsHtml}</div>
        <div class="panel-footer">
            <div class="status">● API ACTIVE</div>
            <div>${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
        </div>
    `;

    pollTeamNames()
}


function injectIntoVetoList(data, attempt = 0) {
    if (!data || !data.predictions) return;

    const teams = getTeamNames();
    const container = document.querySelector('.VetoList__Container-sc-33cc227e-0') ||
        document.querySelector('[class*="VetoList__Container"]');

    if ((!container) && attempt < 10) {
        console.log(`[FP-DEBUG] Veto list not found. Retrying in 3s... (Attempt ${attempt + 1}/10)`);
        setTimeout(() => injectIntoVetoList(data, attempt + 1), 500);
        return;
    }

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