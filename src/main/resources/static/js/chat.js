var stompClient = null;
var nickname = null;
var currentRoomId = null;
var currentRoom = null;
var roomSubscriptions = [];
var currentRoomUsers = [];
var userActionTarget = null;
var rpsRecords = {};
var pendingRpsGameId = null;

// Canvas state
var canvasDrawing = false;
var canvasLastX = 0;
var canvasLastY = 0;
var canvasEraser = false;

// Memo state
var memos = [];
var previewMemoIndex = -1;

// Active tab tracking + unread badges
var activeTab = 'chat';
var unreadCounts = { chat: 0, poll: 0, calendar: 0, lottery: 0, canvas: 0, fortune: 0, gacha: 0 };
var tabNames = { chat: '討論', poll: '投票', calendar: '行事曆', lottery: '樂透選', canvas: '畫布', fortune: '運勢', gacha: '抽賞' };
var gachaPools = [];
var currentGachaPoolId = null;

// ========== Unread Badge ==========

function incrementUnread(tab) {
    if (tab === activeTab) return;
    unreadCounts[tab]++;
    updateTabLabel(tab);
}

function updateTabLabel(tab) {
    var tabMap = { chat: 0, poll: 1, calendar: 2, lottery: 3, canvas: 4, fortune: 5, gacha: 6 };
    var idx = tabMap[tab];
    var tabs = document.querySelectorAll('.room-tab');
    if (idx !== undefined && tabs[idx]) {
        var count = unreadCounts[tab];
        tabs[idx].innerText = count > 0 ? tabNames[tab] + ' (' + count + ')' : tabNames[tab];
    }
}

function clearUnread(tab) {
    unreadCounts[tab] = 0;
    updateTabLabel(tab);
}

function resetAllUnread() {
    for (var key in unreadCounts) {
        unreadCounts[key] = 0;
    }
}

// ========== Tab Notification (title flash + sound) ==========

var originalTitle = document.title;
var titleFlashTimer = null;
var unreadMsgCount = 0;

// Create notification sound using Web Audio API
var notifAudioCtx = null;
function playNotifSound() {
    try {
        if (!notifAudioCtx) notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = notifAudioCtx.createOscillator();
        var gain = notifAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(notifAudioCtx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.15;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, notifAudioCtx.currentTime + 0.3);
        osc.stop(notifAudioCtx.currentTime + 0.3);
    } catch (e) { /* ignore audio errors */ }
}

function notifyNewMessage(sender, content) {
    if (!document.hidden) return;
    unreadMsgCount++;
    playNotifSound();
    startTitleFlash();
}

function startTitleFlash() {
    if (titleFlashTimer) return;
    var show = true;
    titleFlashTimer = setInterval(function () {
        document.title = show ? '💬 (' + unreadMsgCount + ') 新訊息！' : originalTitle;
        show = !show;
    }, 1000);
}

function stopTitleFlash() {
    if (titleFlashTimer) {
        clearInterval(titleFlashTimer);
        titleFlashTimer = null;
    }
    unreadMsgCount = 0;
    document.title = originalTitle;
}

// Stop flashing when user returns to the tab
document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
        stopTitleFlash();
    }
});

// ========== Screen 1: Nickname ==========

var pendingAutoRoom = null;

function joinLobby() {
    var nicknameInput = document.getElementById('nickname-input');
    nickname = nicknameInput.value.trim();
    if (!nickname) return;

    document.getElementById('nickname-container').style.display = 'none';
    document.getElementById('lobby-wrapper').style.display = 'flex';
    document.getElementById('lobby-nickname').innerText = nickname;

    connectAndRegister();
}

function connectAndRegister() {
    var socket = new SockJS('/chat');
    stompClient = Stomp.over(socket);
    stompClient.debug = null;
    stompClient.connect({}, function (frame) {
        stompClient.subscribe('/topic/rooms', function (message) {
            var rooms = JSON.parse(message.body);
            updateRoomList(rooms);
            // Auto-join from invite link
            if (pendingAutoRoom) {
                var targetRoomId = pendingAutoRoom;
                pendingAutoRoom = null;
                for (var i = 0; i < rooms.length; i++) {
                    if (rooms[i].roomId === targetRoomId) {
                        enterRoom(rooms[i]);
                        return;
                    }
                }
                alert('邀請的討論區已不存在');
            }
        });

        stompClient.subscribe('/user/queue/errors', function (message) {
            var error = JSON.parse(message.body);
            showCreateRoomError(error.content);
        });

        stompClient.subscribe('/user/queue/roomCreated', function (message) {
            var room = JSON.parse(message.body);
            enterRoom(room);
        });

        // Receive accumulated history when joining a room
        stompClient.subscribe('/user/queue/roomHistory', function (message) {
            applyRoomHistory(JSON.parse(message.body));
        });

        // RPS challenge notification
        stompClient.subscribe('/user/queue/rpsChallenge', function (message) {
            var data = JSON.parse(message.body);
            showRpsChallengePopup(data.gameId, data.challenger);
        });

        stompClient.send("/app/chat.register", {}, JSON.stringify({
            sender: nickname,
            type: 'JOIN'
        }));
    });
}

// Auto-join from invite link on page load
window.addEventListener('DOMContentLoaded', function () {
    var autoRoom = document.getElementById('auto-room').value;
    var autoNickname = document.getElementById('auto-nickname').value;
    if (autoRoom && autoNickname) {
        try { nickname = decodeURIComponent(escape(atob(autoNickname))); } catch(e) { nickname = autoNickname; }
        pendingAutoRoom = autoRoom;
        document.getElementById('nickname-container').style.display = 'none';
        document.getElementById('lobby-wrapper').style.display = 'flex';
        document.getElementById('lobby-nickname').innerText = nickname;
        connectAndRegister();
    }
});

// ========== Screen 2: Lobby ==========

var allRooms = [];

function toggleCreateRoomModal() {
    var overlay = document.getElementById('create-room-overlay');
    if (overlay.style.display === 'none' || overlay.style.display === '') {
        overlay.style.display = 'flex';
        document.getElementById('ticket-number-input').value = '';
        document.getElementById('general-name-input').value = '';
        document.getElementById('create-room-modal-error').innerText = '';
        switchCreateTab('ticket');
    } else {
        overlay.style.display = 'none';
    }
}

function switchCreateTab(type) {
    var tabs = document.querySelectorAll('#create-room-type-tabs .create-tab');
    tabs.forEach(function (t) { t.classList.remove('active'); });

    document.getElementById('create-ticket-area').style.display = 'none';
    document.getElementById('create-general-area').style.display = 'none';
    document.getElementById('create-gacha-area').style.display = 'none';

    if (type === 'ticket') {
        tabs[0].classList.add('active');
        document.getElementById('create-ticket-area').style.display = 'block';
    } else if (type === 'general') {
        tabs[1].classList.add('active');
        document.getElementById('create-general-area').style.display = 'block';
    } else if (type === 'gacha') {
        tabs[2].classList.add('active');
        document.getElementById('create-gacha-area').style.display = 'block';
    }
    document.getElementById('create-room-modal-error').innerText = '';
}

function createTicketRoom() {
    var input = document.getElementById('ticket-number-input');
    var value = input.value.trim();
    if (!value) return;

    stompClient.send("/app/chat.createTicketRoom", {}, JSON.stringify({
        content: value,
        sender: nickname
    }));
    input.value = '';
    document.getElementById('create-room-overlay').style.display = 'none';
}

function createGeneralRoom() {
    var input = document.getElementById('general-name-input');
    var value = input.value.trim();
    if (!value) return;

    stompClient.send("/app/chat.createGeneralRoom", {}, JSON.stringify({
        content: value,
        sender: nickname
    }));
    input.value = '';
    document.getElementById('create-room-overlay').style.display = 'none';
}

function createGachaRoom() {
    var input = document.getElementById('gacha-room-name-input');
    var value = input.value.trim();
    if (!value) return;

    stompClient.send("/app/chat.createGachaRoom", {}, JSON.stringify({
        content: value,
        sender: nickname
    }));
    input.value = '';
    document.getElementById('create-room-overlay').style.display = 'none';
}

function showCreateRoomError(msg) {
    // Show in modal if open, otherwise in lobby
    var modalError = document.getElementById('create-room-modal-error');
    var lobbyError = document.getElementById('create-room-error');
    var overlay = document.getElementById('create-room-overlay');

    if (overlay.style.display === 'flex') {
        modalError.innerText = msg;
        setTimeout(function () { modalError.innerText = ''; }, 3000);
    } else {
        lobbyError.innerText = msg;
        lobbyError.style.display = 'block';
        setTimeout(function () { lobbyError.style.display = 'none'; }, 3000);
    }
}

function hideCreateRoomError() {
    document.getElementById('create-room-error').style.display = 'none';
}

function filterRoomList() {
    var query = document.getElementById('room-search-input').value.trim().toLowerCase();
    if (query.length < 2) {
        renderRoomList(allRooms);
        return;
    }
    var filtered = allRooms.filter(function (room) {
        return room.roomName.toLowerCase().indexOf(query) !== -1 ||
               room.creatorNickname.toLowerCase().indexOf(query) !== -1 ||
               (room.ticketNumber && room.ticketNumber.indexOf(query) !== -1);
    });
    renderRoomList(filtered);
}

function updateRoomList(rooms) {
    allRooms = rooms;
    filterRoomList();
}

function renderRoomList(rooms) {
    var roomListDiv = document.getElementById('room-list');
    roomListDiv.innerHTML = '';

    if (rooms.length === 0) {
        var query = document.getElementById('room-search-input').value.trim();
        var hint = query.length >= 2 ? '找不到符合的討論區' : '目前沒有討論區，建立一個吧！';
        roomListDiv.innerHTML = '<p class="empty-hint">' + hint + '</p>';
        return;
    }

    rooms.forEach(function (room) {
        var card = document.createElement('div');
        card.className = 'room-card';

        var info = document.createElement('div');
        info.className = 'room-info';

        var name = document.createElement('div');
        name.className = 'room-name';
        var typeTag = room.roomType === 'TICKET' ? '[Ticket] ' : (room.roomType === 'GACHA' ? '[抽賞] ' : '[Normal] ');
        name.innerText = typeTag + room.roomName;

        var meta = document.createElement('div');
        meta.className = 'room-creator';
        meta.innerText = '建立者: ' + room.creatorNickname + '　👤 ' + (room.userCount || 0) + ' 人';

        info.appendChild(name);
        info.appendChild(meta);

        var joinBtn = document.createElement('button');
        joinBtn.innerText = '加入';
        joinBtn.onclick = (function (r) {
            return function () { enterRoom(r); };
        })(room);

        card.appendChild(info);
        card.appendChild(joinBtn);
        roomListDiv.appendChild(card);
    });
}

// ========== Screen 3: Room ==========

function enterRoom(room) {
    currentRoomId = room.roomId;
    currentRoom = room;

    document.getElementById('lobby-wrapper').style.display = 'none';
    document.getElementById('chat-wrapper').style.display = 'block';

    document.getElementById('room-title').innerText = room.roomName;

    // Ticket URL display & download button
    var ticketDisplay = document.getElementById('ticket-url-display');
    var downloadBtn = document.getElementById('download-chat-btn');
    var memoBtn = document.getElementById('memo-btn');
    if (room.roomType === 'TICKET' && room.ticketUrl) {
        var ticketLink = document.getElementById('room-ticket-link');
        ticketLink.href = room.ticketUrl;
        ticketLink.innerText = room.ticketUrl;
        ticketDisplay.style.display = 'block';
        downloadBtn.style.display = 'inline-block';
        memoBtn.style.display = 'inline-block';
    } else {
        ticketDisplay.style.display = 'none';
        downloadBtn.style.display = 'none';
        memoBtn.style.display = 'none';
    }

    // Clear previous content
    rpsRecords = {};
    canvasSnapshots = [];
    previewSnapshotIndex = -1;
    fortuneAnimating = false;
    document.getElementById('message-area').innerHTML = '';
    document.getElementById('user-list').innerHTML = '';
    document.getElementById('poll-list').innerHTML = '';
    document.getElementById('calendar-list').innerHTML = '';
    document.getElementById('lottery-history').innerHTML = '';
    document.getElementById('canvas-snapshots').innerHTML = '';
    document.getElementById('fortune-stick-out').style.display = 'none';
    document.getElementById('fortune-card').style.display = 'none';
    document.getElementById('fortune-draw-btn').disabled = false;
    memos = [];
    previewMemoIndex = -1;
    document.getElementById('memo-list').innerHTML = '';
    gachaPools = [];
    currentGachaPoolId = null;
    document.getElementById('gacha-pool-list').innerHTML = '';
    clearCanvasLocal();

    // Dynamic tab visibility based on room type
    var roomTabs = document.querySelectorAll('.room-tab');
    var isGacha = room.roomType === 'GACHA';
    // Tab order: 0=chat, 1=poll, 2=calendar, 3=lottery, 4=canvas, 5=fortune, 6=gacha
    if (roomTabs[1]) roomTabs[1].style.display = isGacha ? 'none' : '';  // poll
    if (roomTabs[2]) roomTabs[2].style.display = isGacha ? 'none' : '';  // calendar
    if (roomTabs[3]) roomTabs[3].style.display = isGacha ? 'none' : '';  // lottery
    if (roomTabs[4]) roomTabs[4].style.display = isGacha ? 'none' : '';  // canvas
    if (roomTabs[5]) roomTabs[5].style.display = isGacha ? 'none' : '';  // fortune
    if (roomTabs[6]) roomTabs[6].style.display = isGacha ? '' : 'none';  // gacha

    // Reset unread and switch to chat tab
    resetAllUnread();
    switchRoomTab('chat');

    // Subscribe to room topics
    var msgSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/messages', function (message) {
        var msg = JSON.parse(message.body);
        showMessage(msg);
        incrementUnread('chat');
        if (msg.type !== 'JOIN' && msg.type !== 'LEAVE' && msg.sender !== nickname) {
            notifyNewMessage(msg.sender, msg.content);
        }
    });
    var userSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/users', function (message) {
        updateUserList(JSON.parse(message.body));
    });
    var pollSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/polls', function (message) {
        renderPolls(JSON.parse(message.body));
        incrementUnread('poll');
    });
    var calSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/calendar', function (message) {
        renderCalendar(JSON.parse(message.body));
        incrementUnread('calendar');
    });
    var lotterySub = stompClient.subscribe('/topic/room/' + currentRoomId + '/lottery', function (message) {
        showLotteryResult(JSON.parse(message.body));
        incrementUnread('lottery');
    });
    var canvasSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/canvas', function (message) {
        handleCanvasMessage(JSON.parse(message.body));
        incrementUnread('canvas');
    });
    var rpsSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/rpsRecords', function (message) {
        rpsRecords = JSON.parse(message.body);
        refreshUserListRecords();
    });
    var snapshotSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/snapshots', function (message) {
        canvasSnapshots = JSON.parse(message.body);
        renderSnapshotList();
    });
    var memoSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/memos', function (message) {
        memos = JSON.parse(message.body);
        renderMemoList();
    });
    var gachaSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/gacha', function (message) {
        gachaPools = JSON.parse(message.body);
        renderGachaList();
        incrementUnread('gacha');
    });
    var gachaResultSub = stompClient.subscribe('/topic/room/' + currentRoomId + '/gachaResult', function (message) {
        showGachaAnimation(JSON.parse(message.body));
    });
    roomSubscriptions = [msgSub, userSub, pollSub, calSub, lotterySub, canvasSub, rpsSub, snapshotSub, memoSub, gachaSub, gachaResultSub];

    // Init canvas & mention
    initCanvas();
    initMentionListener();

    stompClient.send("/app/chat.joinRoom", {}, JSON.stringify({
        roomId: currentRoomId,
        sender: nickname,
        type: 'JOIN'
    }));
}

function applyRoomHistory(history) {
    // Replay chat messages
    if (history.chatHistory) {
        history.chatHistory.forEach(function (msg) {
            showMessage(msg);
        });
    }

    // Render polls
    if (history.polls) {
        renderPolls(history.polls);
    }

    // Render calendar
    if (history.calendar) {
        renderCalendar(history.calendar);
    }

    // Replay lottery results (oldest first)
    if (history.lotteryHistory) {
        // Insert in reverse order since showLotteryResult prepends
        for (var i = history.lotteryHistory.length - 1; i >= 0; i--) {
            showLotteryResult(history.lotteryHistory[i]);
        }
    }

    // Replay canvas strokes
    if (history.canvasHistory) {
        history.canvasHistory.forEach(function (stroke) {
            handleCanvasMessage(stroke);
        });
    }

    // Apply canvas snapshots
    if (history.canvasSnapshots) {
        canvasSnapshots = history.canvasSnapshots;
        renderSnapshotList();
    }

    // Apply memos
    if (history.memos) {
        memos = history.memos;
        renderMemoList();
    }

    // Apply RPS records
    if (history.rpsRecords) {
        rpsRecords = history.rpsRecords;
        refreshUserListRecords();
    }

    // Apply gacha pools
    if (history.gacha) {
        gachaPools = history.gacha;
        renderGachaList();
    }

    // Don't count history replay as unread
    resetAllUnread();
    // Re-render all tab labels to clear any counts
    for (var key in tabNames) {
        updateTabLabel(key);
    }
}

function leaveRoom() {
    if (!currentRoomId) return;

    // Check if I'm the last person in the room
    if (currentRoomUsers.length <= 1) {
        if (!confirm('你是討論區內的最後一位成員，離開後討論區內所有的紀錄（討論、投票、行事曆、樂透、畫布等）都會被刪除。\n\n確定要離開嗎？')) {
            return;
        }
    }

    stompClient.send("/app/chat.leaveRoom", {}, JSON.stringify({
        roomId: currentRoomId,
        sender: nickname,
        type: 'LEAVE'
    }));

    roomSubscriptions.forEach(function (sub) { sub.unsubscribe(); });
    roomSubscriptions = [];
    currentRoomId = null;
    currentRoom = null;

    document.getElementById('chat-wrapper').style.display = 'none';
    document.getElementById('lobby-wrapper').style.display = 'flex';
}

function switchRoomTab(tab) {
    var tabs = document.querySelectorAll('.room-tab');
    var contents = document.querySelectorAll('.tab-content');
    tabs.forEach(function (t) { t.classList.remove('active'); });
    contents.forEach(function (c) { c.classList.remove('active'); });

    activeTab = tab;
    clearUnread(tab);

    var tabMap = { chat: 0, poll: 1, calendar: 2, lottery: 3, canvas: 4, fortune: 5, gacha: 6 };
    var idx = tabMap[tab];
    if (idx !== undefined && tabs[idx]) {
        tabs[idx].classList.add('active');
    }
    var el = document.getElementById('tab-' + tab);
    if (el) el.classList.add('active');

}

// ========== Emoji Picker ==========

var emojiList = [
    '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊',
    '😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗',
    '🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮',
    '🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝',
    '🤤','😒','😓','😔','😕','🙃','🤑','😲','🙁','😖',
    '😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯',
    '😬','😰','😱','🥵','🥶','😳','🤪','😵','🥴','😠',
    '😡','🤬','😷','🤒','🤕','🤢','🤮','🥳','🥺','🤠',
    '👍','👎','👏','🙌','🤝','💪','🎉','🎊','🔥','💯',
    '❤️','💔','💀','👀','🤷','🤦','💡','⭐','✅','❌'
];

function initEmojiPicker() {
    var picker = document.getElementById('emoji-picker');
    picker.innerHTML = '';
    emojiList.forEach(function (emoji) {
        var span = document.createElement('span');
        span.className = 'emoji-item';
        span.innerText = emoji;
        span.onclick = function () {
            var input = document.getElementById('message-input');
            input.value += emoji;
            input.focus();
        };
        picker.appendChild(span);
    });
}

function toggleEmojiPicker() {
    var picker = document.getElementById('emoji-picker');
    if (picker.style.display === 'none' || picker.style.display === '') {
        if (picker.children.length === 0) initEmojiPicker();
        picker.style.display = 'flex';
    } else {
        picker.style.display = 'none';
    }
}

function toggleTipsPanel() {
    var panel = document.getElementById('tips-panel');
    panel.style.display = (panel.style.display === 'none' || panel.style.display === '') ? 'block' : 'none';
}

function toggleDevHistory() {
    var overlay = document.getElementById('dev-history-overlay');
    overlay.style.display = (overlay.style.display === 'none' || overlay.style.display === '') ? 'flex' : 'none';
}

// ========== Theme Toggle ==========

function toggleThemeMenu() {
    var menu = document.getElementById('theme-menu');
    if (menu.style.display === 'none' || menu.style.display === '') {
        var current = document.documentElement.getAttribute('data-theme') || 'purple';
        var options = menu.querySelectorAll('.theme-option');
        for (var i = 0; i < options.length; i++) {
            if (options[i].getAttribute('data-theme') === current) {
                options[i].classList.add('active-theme');
            } else {
                options[i].classList.remove('active-theme');
            }
        }
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('discussion-theme', theme);
    document.getElementById('theme-menu').style.display = 'none';
}

// ========== Off-work Mode ==========

function startOffworkMode() {
    var overlay = document.getElementById('offwork-overlay');
    var scene = document.getElementById('offwork-scene');
    var text = document.getElementById('ow-text');

    overlay.style.display = 'block';
    scene.className = '';

    // Phase 1: Office — person walks out (0-4s)
    scene.classList.add('phase-office');
    text.innerText = '下班了！辛苦了～ 👋';

    // Phase 2: Flight (4-8s)
    setTimeout(function () {
        scene.className = 'phase-flight';
        text.innerText = '';
    }, 4500);

    // Phase 3: Hawaii (8s+)
    setTimeout(function () {
        scene.className = 'phase-hawaii';
        text.innerText = '🏝️ Aloha! 享受假期吧！';
    }, 8500);
}

function exitOffworkMode() {
    document.getElementById('offwork-overlay').style.display = 'none';
    document.getElementById('offwork-scene').className = '';
}

var relaxMode = false;

function toggleRelaxMode() {
    relaxMode = !relaxMode;
    if (relaxMode) {
        document.body.classList.add('relax-mode');
        document.getElementById('theme-menu').style.display = 'none';
        // Click anywhere on body to exit relax mode
        setTimeout(function () {
            document.addEventListener('click', exitRelaxOnClick);
        }, 300);
    } else {
        document.body.classList.remove('relax-mode');
        document.removeEventListener('click', exitRelaxOnClick);
    }
}

function exitRelaxOnClick(e) {
    relaxMode = false;
    document.body.classList.remove('relax-mode');
    document.removeEventListener('click', exitRelaxOnClick);
}

// Close theme menu when clicking outside
document.addEventListener('click', function (e) {
    var container = document.getElementById('theme-menu-container');
    if (container && !container.contains(e.target)) {
        document.getElementById('theme-menu').style.display = 'none';
    }
});

// Restore theme on load
(function () {
    var saved = localStorage.getItem('discussion-theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    }
})();

// ========== Geo Background Particles ==========

var geoParticles = [];
var geoAnimId = null;

function initGeoBackground() {
    var canvas = document.getElementById('geo-bg-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Create 20 particles
    geoParticles = [];
    for (var i = 0; i < 20; i++) {
        geoParticles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 1.5,
            vy: (Math.random() - 0.5) * 1.5,
            r: 3
        });
    }

    function animate() {
        if (document.documentElement.getAttribute('data-theme') !== 'geo') {
            geoAnimId = null;
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Update positions + bounce
        for (var i = 0; i < geoParticles.length; i++) {
            var p = geoParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            if (p.x <= p.r || p.x >= canvas.width - p.r) p.vx *= -1;
            if (p.y <= p.r || p.y >= canvas.height - p.r) p.vy *= -1;
            p.x = Math.max(p.r, Math.min(canvas.width - p.r, p.x));
            p.y = Math.max(p.r, Math.min(canvas.height - p.r, p.y));
        }

        // Draw connections within 200px
        for (var i = 0; i < geoParticles.length; i++) {
            for (var j = i + 1; j < geoParticles.length; j++) {
                var dx = geoParticles[i].x - geoParticles[j].x;
                var dy = geoParticles[i].y - geoParticles[j].y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 200) {
                    var alpha = 1 - dist / 200;
                    ctx.beginPath();
                    ctx.moveTo(geoParticles[i].x, geoParticles[i].y);
                    ctx.lineTo(geoParticles[j].x, geoParticles[j].y);
                    ctx.strokeStyle = 'rgba(69, 90, 100, ' + (alpha * 0.4) + ')';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        // Draw dots
        for (var i = 0; i < geoParticles.length; i++) {
            var p = geoParticles[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(69, 90, 100, 0.6)';
            ctx.fill();
        }

        geoAnimId = requestAnimationFrame(animate);
    }

    if (geoAnimId) cancelAnimationFrame(geoAnimId);
    geoAnimId = requestAnimationFrame(animate);
}

// ========== Sakura Petal Animation ==========

var sakuraAnimId = null;
var sakuraPetals = [];

function initSakuraBackground() {
    var canvas = document.getElementById('sakura-bg-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var treeImg = document.createElement('canvas');
    var tc = treeImg.getContext('2d');

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        renderTree();
    }

    function drawBranch(c, x, y, angle, length, width, depth) {
        if (depth <= 0 || width < 0.8) return;
        var endX = x + Math.cos(angle) * length;
        var endY = y + Math.sin(angle) * length;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(endX, endY);
        c.strokeStyle = depth > 4 ? '#5d4037' : depth > 2 ? '#8d6e63' : '#a1887f';
        c.lineWidth = width;
        c.lineCap = 'round';
        c.stroke();

        // Blossom clusters on tips and mid-branches
        if (depth <= 3) {
            drawBlossomCluster(c, endX, endY, width * 5 + 14);
        }

        // Always fork into 2 main sub-branches
        var spread = 0.35 + Math.random() * 0.3;
        var shrink = 0.62 + Math.random() * 0.12;
        drawBranch(c, endX, endY, angle - spread, length * shrink, width * 0.68, depth - 1);
        drawBranch(c, endX, endY, angle + spread, length * shrink, width * 0.68, depth - 1);
        // Extra branch for density
        if (depth > 2) {
            drawBranch(c, endX, endY, angle + (Math.random() - 0.5) * 0.5, length * shrink * 0.75, width * 0.5, depth - 1);
        }
        // Even more side twigs at mid depths
        if (depth > 3 && Math.random() > 0.3) {
            drawBranch(c, endX, endY, angle - spread * 1.5, length * shrink * 0.6, width * 0.4, depth - 2);
        }
    }

    function drawBlossomCluster(c, cx, cy, size) {
        var pinks = [
            [255, 183, 197], [244, 143, 177], [248, 187, 208],
            [252, 228, 236], [240, 128, 162], [255, 205, 220]
        ];
        var count = 8 + Math.floor(Math.random() * 7);
        for (var i = 0; i < count; i++) {
            var ox = (Math.random() - 0.5) * size;
            var oy = (Math.random() - 0.5) * size;
            var r = 3 + Math.random() * 5;
            var col = pinks[Math.floor(Math.random() * pinks.length)];
            var alpha = 0.6 + Math.random() * 0.35;
            c.beginPath();
            c.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
            c.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + alpha + ')';
            c.fill();
        }
        // Soft glow behind cluster
        var g = c.createRadialGradient(cx, cy, 0, cx, cy, size * 0.7);
        g.addColorStop(0, 'rgba(248, 187, 208, 0.35)');
        g.addColorStop(1, 'rgba(248, 187, 208, 0)');
        c.beginPath();
        c.arc(cx, cy, size * 0.7, 0, Math.PI * 2);
        c.fillStyle = g;
        c.fill();
    }

    function drawOneTree(c, bx, by, topRatio, scale, seed) {
        var H = canvas.height;
        var trunkTop = H * topRatio;

        // Trunk
        var hw = 16 * scale;
        c.beginPath();
        c.moveTo(bx - hw, by);
        c.bezierCurveTo(bx - hw * 1.2, by - (by - trunkTop) * 0.4, bx - hw * 1.5, by - (by - trunkTop) * 0.7, bx - hw * 0.5, trunkTop);
        c.lineTo(bx + hw * 0.4, trunkTop);
        c.bezierCurveTo(bx + hw * 1.2, by - (by - trunkTop) * 0.7, bx + hw, by - (by - trunkTop) * 0.4, bx + hw, by);
        c.closePath();
        var tg = c.createLinearGradient(bx - hw * 1.5, 0, bx + hw * 1.2, 0);
        tg.addColorStop(0, '#4e342e');
        tg.addColorStop(0.3, '#6d4c41');
        tg.addColorStop(0.7, '#795548');
        tg.addColorStop(1, '#4e342e');
        c.fillStyle = tg;
        c.fill();

        // Branches
        var origRandom = Math.random;
        Math.random = function () { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; };

        var bLen = H * 0.09 * scale;
        var bw = 10 * scale;
        drawBranch(c, bx - 3 * scale, trunkTop + 2, -Math.PI / 2 - 0.6, bLen * 1.2, bw, 6);
        drawBranch(c, bx + 2 * scale, trunkTop + 6, -Math.PI / 2 + 0.35, bLen * 1.1, bw * 0.95, 6);
        drawBranch(c, bx - 6 * scale, trunkTop + 14, -Math.PI / 2 - 0.15, bLen * 1.3, bw * 1.1, 6);
        drawBranch(c, bx + 5 * scale, trunkTop + 22, -Math.PI / 2 + 0.55, bLen, bw * 0.9, 5);
        drawBranch(c, bx - 10 * scale, trunkTop + 32, -Math.PI / 2 - 0.8, bLen * 1.0, bw * 0.9, 5);
        drawBranch(c, bx + 8 * scale, trunkTop + 42, -Math.PI / 2 + 0.75, bLen * 0.9, bw * 0.8, 5);
        drawBranch(c, bx - 14 * scale, trunkTop + 55, -Math.PI / 2 - 1.0, bLen * 0.85, bw * 0.75, 4);

        Math.random = origRandom;
    }

    function renderTree() {
        treeImg.width = canvas.width;
        treeImg.height = canvas.height;
        var W = canvas.width;
        var H = canvas.height;

        drawOneTree(tc, W - 120, H, 0.50, 1.0, 42);
    }

    resize();
    window.addEventListener('resize', resize);

    var petalColors = [
        'rgba(244,143,177,', 'rgba(248,187,208,', 'rgba(252,228,236,',
        'rgba(240,98,146,', 'rgba(255,183,197,'
    ];

    sakuraPetals = [];
    for (var i = 0; i < 40; i++) {
        sakuraPetals.push({
            x: Math.random() * canvas.width * 1.2,
            y: Math.random() * canvas.height,
            w: 4 + Math.random() * 6,
            h: 6 + Math.random() * 8,
            drift: 0.3 + Math.random() * 0.8,
            fall: 0.4 + Math.random() * 1.0,
            spin: Math.random() * 360,
            spinSpeed: (Math.random() - 0.5) * 2.5,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.01 + Math.random() * 0.02,
            alpha: 0.45 + Math.random() * 0.45,
            color: petalColors[Math.floor(Math.random() * petalColors.length)]
        });
    }

    function animate() {
        if (document.documentElement.getAttribute('data-theme') !== 'sakura') {
            sakuraAnimId = null;
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(treeImg, 0, 0);

        for (var i = 0; i < sakuraPetals.length; i++) {
            var p = sakuraPetals[i];
            p.y += p.fall;
            p.sway += p.swaySpeed;
            p.x -= p.drift + Math.sin(p.sway) * 0.5;
            p.spin += p.spinSpeed;

            if (p.y > canvas.height + 20 || p.x < -40) {
                p.y = -10 - Math.random() * 60;
                p.x = canvas.width * 0.4 + Math.random() * canvas.width * 0.65;
            }

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.spin * Math.PI / 180);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(p.w * 0.8, -p.h * 0.3, p.w, p.h * 0.5, 0, p.h);
            ctx.bezierCurveTo(-p.w, p.h * 0.5, -p.w * 0.8, -p.h * 0.3, 0, 0);
            ctx.fillStyle = p.color + p.alpha + ')';
            ctx.fill();
            ctx.restore();
        }

        sakuraAnimId = requestAnimationFrame(animate);
    }

    if (sakuraAnimId) cancelAnimationFrame(sakuraAnimId);
    sakuraAnimId = requestAnimationFrame(animate);
}

// Start/stop background animations when theme changes
var _origSetTheme = setTheme;
setTheme = function (theme) {
    _origSetTheme(theme);
    if (theme === 'geo') {
        initGeoBackground();
    } else if (theme === 'sakura') {
        initSakuraBackground();
    }
};

// Init on load if saved theme needs animation
window.addEventListener('DOMContentLoaded', function () {
    var savedTheme = document.documentElement.getAttribute('data-theme');
    if (savedTheme === 'geo') {
        initGeoBackground();
    } else if (savedTheme === 'sakura') {
        initSakuraBackground();
    }
});

// ========== Invite ==========

function generateInviteLinks() {
    var input = document.getElementById('invite-emails');
    var raw = input.value.trim();
    if (!raw) return;
    var emails = raw.split(',').map(function (e) { return e.trim(); }).filter(function (e) { return e.length > 0; });
    if (emails.length === 0) return;

    var baseUrl = window.location.protocol + '//' + window.location.host;
    var linksArea = document.getElementById('invite-links');
    linksArea.innerHTML = '';

    emails.forEach(function (email) {
        var url = baseUrl + '/join?room=' + encodeURIComponent(currentRoomId) + '&nickname=' + encodeURIComponent(btoa(unescape(encodeURIComponent(email))));
        var div = document.createElement('div');
        div.className = 'invite-link-row';

        var label = document.createElement('span');
        label.className = 'invite-link-label';
        label.innerText = email;

        var linkInput = document.createElement('input');
        linkInput.type = 'text';
        linkInput.className = 'invite-link-url';
        linkInput.value = url;
        linkInput.readOnly = true;
        linkInput.onclick = function () { this.select(); };

        var copyBtn = document.createElement('button');
        copyBtn.className = 'invite-copy-btn';
        copyBtn.innerText = '複製';
        copyBtn.onclick = (function (u, btn) {
            return function () {
                copyToClipboard(u);
                btn.innerText = '已複製 ✓';
                btn.classList.add('copied');
                setTimeout(function () { btn.innerText = '複製'; btn.classList.remove('copied'); }, 2000);
            };
        })(url, copyBtn);

        div.appendChild(label);
        div.appendChild(linkInput);
        div.appendChild(copyBtn);
        linksArea.appendChild(div);
    });

    linksArea.style.display = 'block';
    if (emails.length > 1) {
        document.getElementById('copy-all-btn').style.display = 'block';
    }
    input.value = '';
}

function copyAllInviteLinks() {
    var links = document.querySelectorAll('.invite-link-url');
    var all = [];
    links.forEach(function (el) { all.push(el.value); });
    if (all.length > 0) {
        copyToClipboard(all.join('\n'));
        var btn = document.getElementById('copy-all-btn');
        btn.innerText = '全部已複製 ✓';
        btn.classList.add('copied');
        setTimeout(function () { btn.innerText = '一鍵複製全部'; btn.classList.remove('copied'); }, 2000);
    }
}

function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
    } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

// ========== Image Upload ==========

function uploadImage(input) {
    var file = input.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert('File too large (max 5MB)');
        input.value = '';
        return;
    }

    var formData = new FormData();
    formData.append('file', file);

    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (data.error) {
            alert(data.error);
            return;
        }
        if (data.url && stompClient && currentRoomId) {
            stompClient.send("/app/chat.sendMessage", {}, JSON.stringify({
                content: '![image](' + data.url + ')',
                sender: nickname,
                roomId: currentRoomId,
                type: 'CHAT'
            }));
        }
    })
    .catch(function () {
        alert('Upload failed');
    });

    input.value = '';
}

// ========== @ Mention ==========

function initMentionListener() {
    var input = document.getElementById('message-input');
    input.addEventListener('input', handleMentionInput);
    input.addEventListener('keydown', handleMentionKeydown);
}

var mentionActive = false;
var mentionStartIdx = -1;
var mentionSelectedIdx = 0;

function handleMentionInput() {
    var input = document.getElementById('message-input');
    var val = input.value;
    var cursor = input.selectionStart;

    // Find the last '@' before cursor
    var atIdx = -1;
    for (var i = cursor - 1; i >= 0; i--) {
        if (val[i] === '@') { atIdx = i; break; }
        if (val[i] === ' ') break;
    }

    if (atIdx >= 0) {
        var query = val.substring(atIdx + 1, cursor).toLowerCase();
        var matches = currentRoomUsers.filter(function (u) {
            return u.nickname !== nickname && u.nickname.toLowerCase().indexOf(query) !== -1;
        });

        if (matches.length > 0) {
            mentionActive = true;
            mentionStartIdx = atIdx;
            mentionSelectedIdx = 0;
            showMentionDropdown(matches);
            return;
        }
    }

    hideMentionDropdown();
}

function handleMentionKeydown(e) {
    if (!mentionActive) return;

    var dropdown = document.getElementById('mention-dropdown');
    var items = dropdown.querySelectorAll('.mention-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionSelectedIdx = Math.min(mentionSelectedIdx + 1, items.length - 1);
        updateMentionSelection(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionSelectedIdx = Math.max(mentionSelectedIdx - 1, 0);
        updateMentionSelection(items);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (mentionActive && items.length > 0) {
            e.preventDefault();
            var selected = items[mentionSelectedIdx];
            insertMention(selected.getAttribute('data-nickname'));
        }
    } else if (e.key === 'Escape') {
        hideMentionDropdown();
    }
}

function updateMentionSelection(items) {
    for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('selected', i === mentionSelectedIdx);
    }
}

function showMentionDropdown(users) {
    var dropdown = document.getElementById('mention-dropdown');
    dropdown.innerHTML = '';
    users.forEach(function (user, idx) {
        var div = document.createElement('div');
        div.className = 'mention-item' + (idx === 0 ? ' selected' : '');
        div.setAttribute('data-nickname', user.nickname);
        div.innerText = '@' + user.nickname;
        div.onmousedown = function (e) {
            e.preventDefault();
            insertMention(user.nickname);
        };
        dropdown.appendChild(div);
    });
    dropdown.style.display = 'block';
}

function hideMentionDropdown() {
    mentionActive = false;
    mentionStartIdx = -1;
    document.getElementById('mention-dropdown').style.display = 'none';
}

function insertMention(name) {
    var input = document.getElementById('message-input');
    var val = input.value;
    var cursor = input.selectionStart;
    var before = val.substring(0, mentionStartIdx);
    var after = val.substring(cursor);
    input.value = before + '@' + name + ' ' + after;
    var newPos = mentionStartIdx + name.length + 2;
    input.setSelectionRange(newPos, newPos);
    input.focus();
    hideMentionDropdown();
}

// ========== Chat ==========

function sendMessage() {
    var messageInput = document.getElementById('message-input');
    var messageContent = messageInput.value.trim();
    if (messageContent && stompClient && currentRoomId) {
        stompClient.send("/app/chat.sendMessage", {}, JSON.stringify({
            content: messageContent,
            sender: nickname,
            roomId: currentRoomId,
            type: 'CHAT'
        }));
        messageInput.value = '';
        messageInput.focus();
    }
}

function renderMarkdown(text) {
    // Highlight @mentions before markdown parsing
    var mentionNames = currentRoomUsers.map(function (u) { return u.nickname; });
    var processed = text;
    mentionNames.forEach(function (name) {
        var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var regex = new RegExp('@' + escaped + '(?=\\s|$|[,.:;!?])', 'g');
        processed = processed.replace(regex, '**`@' + name + '`**');
    });

    var html = marked.parse(processed, { breaks: true });
    var sanitized = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
    // Wrap images in links to open full-size
    var div = document.createElement('div');
    div.innerHTML = sanitized;
    var imgs = div.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!img.parentElement || img.parentElement.tagName !== 'A') {
            var a = document.createElement('a');
            a.href = img.src;
            a.target = '_blank';
            img.parentElement.insertBefore(a, img);
            a.appendChild(img);
        }
    }
    return div.innerHTML;
}

function showMessage(message) {
    var messageArea = document.getElementById('message-area');
    var el = document.createElement('div');
    el.classList.add('message');
    if (message.type === 'JOIN' || message.type === 'LEAVE') {
        el.classList.add('system');
        el.innerText = message.content;
    } else {
        var senderSpan = document.createElement('span');
        senderSpan.className = 'message-sender';
        senderSpan.innerText = message.sender + ': ';

        var contentSpan = document.createElement('span');
        contentSpan.className = 'message-content';
        contentSpan.innerHTML = renderMarkdown(message.content);

        el.appendChild(senderSpan);
        el.appendChild(contentSpan);
    }
    messageArea.appendChild(el);
    messageArea.scrollTop = messageArea.scrollHeight;
}

function downloadChat() {
    if (!currentRoom || currentRoom.roomType !== 'TICKET') return;

    var messages = document.getElementById('message-area').children;
    var lines = [];
    lines.push('討論區: ' + currentRoom.roomName);
    lines.push('Ticket: ' + currentRoom.ticketUrl);
    lines.push('匯出時間: ' + new Date().toLocaleString());
    lines.push('---');

    for (var i = 0; i < messages.length; i++) {
        lines.push(messages[i].innerText);
    }

    var content = lines.join('\n');
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'Ticket_' + currentRoom.ticketNumber + '_chat.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ========== Memo ==========

function saveMemo() {
    var input = document.getElementById('message-input');
    var text = input.value.trim();
    if (!text || !stompClient || !currentRoomId) return;

    stompClient.send("/app/memo.save", {}, JSON.stringify({
        roomId: currentRoomId,
        text: text,
        time: new Date().toLocaleTimeString()
    }));

    input.value = '';
    input.focus();
}

function renderMemoList() {
    var container = document.getElementById('memo-list');
    container.innerHTML = '';
    memos.forEach(function (memo, idx) {
        var wrapper = document.createElement('div');
        wrapper.className = 'memo-thumb';
        wrapper.onclick = (function (i) {
            return function () { openMemoPreview(i); };
        })(idx);

        var preview = document.createElement('div');
        preview.className = 'memo-thumb-text';
        preview.innerText = memo.text.length > 40 ? memo.text.substring(0, 40) + '...' : memo.text;

        var meta = document.createElement('span');
        meta.className = 'memo-thumb-meta';
        meta.innerText = '#' + (idx + 1) + ' ' + (memo.author || '') + ' ' + memo.time;

        var delBtn = document.createElement('button');
        delBtn.className = 'memo-delete-btn';
        delBtn.innerText = '✕';
        delBtn.title = '刪除';
        delBtn.onclick = (function (i) {
            return function (e) {
                e.stopPropagation();
                deleteMemoByIndex(i);
            };
        })(idx);

        wrapper.appendChild(preview);
        wrapper.appendChild(meta);
        wrapper.appendChild(delBtn);
        container.appendChild(wrapper);
    });
}

function openMemoPreview(idx) {
    previewMemoIndex = idx;
    var memo = memos[idx];
    document.getElementById('memo-preview-meta').innerText = '#' + (idx + 1) + '　' + (memo.author || '') + '　' + memo.time;
    document.getElementById('memo-preview-text').innerText = memo.text;
    document.getElementById('memo-preview-modal').style.display = 'flex';
}

function closeMemoPreview() {
    document.getElementById('memo-preview-modal').style.display = 'none';
    document.getElementById('memo-copy-status').innerText = '';
    previewMemoIndex = -1;
}

function copyMemo() {
    if (previewMemoIndex < 0) return;
    var text = memos[previewMemoIndex].text;
    copyToClipboard(text);
    var status = document.getElementById('memo-copy-status');
    status.innerText = '已複製！';
    setTimeout(function () { status.innerText = ''; }, 2000);
}

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text);
    } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

function deleteMemo() {
    if (previewMemoIndex < 0) return;
    deleteMemoByIndex(previewMemoIndex);
}

function deleteMemoByIndex(idx) {
    stompClient.send("/app/memo.delete", {}, JSON.stringify({
        roomId: currentRoomId,
        index: idx
    }));
    if (previewMemoIndex === idx) {
        closeMemoPreview();
    } else if (previewMemoIndex > idx) {
        previewMemoIndex--;
    }
}

function updateUserList(users) {
    currentRoomUsers = users;
    var userList = document.getElementById('user-list');
    userList.innerHTML = '';
    users.forEach(function (user) {
        var li = document.createElement('li');
        li.className = 'user-list-item';
        li.setAttribute('data-nickname', user.nickname);

        var nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        nameSpan.innerText = user.nickname + ' (' + user.ip + ')';

        li.appendChild(nameSpan);

        // RPS record badge
        var rec = rpsRecords[user.nickname];
        if (rec && (rec.wins > 0 || rec.losses > 0 || rec.draws > 0)) {
            var badge = document.createElement('span');
            badge.className = 'rps-record';
            badge.innerText = rec.wins + '勝 ' + rec.losses + '敗 ' + rec.draws + '平';
            li.appendChild(badge);
        }

        if (user.nickname !== nickname) {
            li.classList.add('clickable');
            li.onclick = (function (u) {
                return function (e) { showUserActionMenu(u.nickname, e); };
            })(user);
        }
        userList.appendChild(li);
    });
}

function refreshUserListRecords() {
    var items = document.querySelectorAll('#user-list .user-list-item');
    for (var i = 0; i < items.length; i++) {
        var li = items[i];
        var name = li.getAttribute('data-nickname');
        // Remove existing record badge
        var existing = li.querySelector('.rps-record');
        if (existing) li.removeChild(existing);

        var rec = rpsRecords[name];
        if (rec && (rec.wins > 0 || rec.losses > 0 || rec.draws > 0)) {
            var badge = document.createElement('span');
            badge.className = 'rps-record';
            badge.innerText = rec.wins + '勝 ' + rec.losses + '敗 ' + rec.draws + '平';
            li.appendChild(badge);
        }
    }
}

// ========== User Interaction Menu ==========

function showUserActionMenu(targetNickname, event) {
    userActionTarget = targetNickname;
    var menu = document.getElementById('user-action-menu');
    document.getElementById('user-action-target').innerText = targetNickname;

    // Position near the clicked element
    var rect = event.target.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    menu.style.display = 'flex';

    event.stopPropagation();
}

function hideUserActionMenu() {
    document.getElementById('user-action-menu').style.display = 'none';
    document.getElementById('user-action-buttons').style.display = 'flex';
    document.getElementById('rps-choice-area').style.display = 'none';
    userActionTarget = null;
}

function userAction(type) {
    if (!userActionTarget || !stompClient || !currentRoomId) return;

    var messages = {
        hi:        nickname + ' 對 ' + userActionTarget + ' 說聲 Hi 👋',
        handshake: nickname + ' 對 ' + userActionTarget + ' 握手 🤝',
        love:      nickname + ' 對 ' + userActionTarget + ' 表示愛心 ❤️',
        angry:     nickname + ' 對 ' + userActionTarget + ' 表示不高興 😠',
        poke:      nickname + ' 戳了 ' + userActionTarget + ' 一下 👉'
    };

    var content = messages[type];
    if (content) {
        stompClient.send("/app/chat.sendMessage", {}, JSON.stringify({
            content: content,
            sender: '互動',
            roomId: currentRoomId,
            type: 'CHAT'
        }));
    }

    hideUserActionMenu();
}

// ========== Rock Paper Scissors ==========

function showRpsChoice() {
    document.getElementById('user-action-buttons').style.display = 'none';
    document.getElementById('rps-choice-area').style.display = 'block';
}

function sendRpsChallenge(choice) {
    if (!userActionTarget || !stompClient || !currentRoomId) return;

    stompClient.send("/app/rps.challenge", {}, JSON.stringify({
        roomId: currentRoomId,
        target: userActionTarget,
        choice: choice
    }));

    hideUserActionMenu();
}

function showRpsChallengePopup(gameId, challenger) {
    pendingRpsGameId = gameId;
    document.getElementById('rps-challenger-name').innerText = challenger;
    document.getElementById('rps-challenge-popup').style.display = 'flex';
}

function respondRps(choice) {
    if (!pendingRpsGameId || !stompClient) return;

    stompClient.send("/app/rps.respond", {}, JSON.stringify({
        gameId: pendingRpsGameId,
        choice: choice
    }));

    pendingRpsGameId = null;
    document.getElementById('rps-challenge-popup').style.display = 'none';
}

// Close menu when clicking elsewhere (but not when clicking inside the menu)
document.addEventListener('click', function (e) {
    var menu = document.getElementById('user-action-menu');
    if (!menu.contains(e.target)) {
        hideUserActionMenu();
    }
});

// ========== Poll ==========

function createPoll() {
    var questionInput = document.getElementById('poll-question');
    var optionsInput = document.getElementById('poll-options');
    var question = questionInput.value.trim();
    var optionsStr = optionsInput.value.trim();
    if (!question || !optionsStr || !currentRoomId) return;

    stompClient.send("/app/poll.create", {}, JSON.stringify({
        roomId: currentRoomId,
        question: question,
        options: optionsStr
    }));
    questionInput.value = '';
    optionsInput.value = '';
}

function renderPolls(polls) {
    var container = document.getElementById('poll-list');
    container.innerHTML = '';

    if (polls.length === 0) {
        container.innerHTML = '<p class="empty-hint">目前沒有投票</p>';
        return;
    }

    polls.forEach(function (poll) {
        var card = document.createElement('div');
        card.className = 'poll-card';

        var header = document.createElement('div');
        header.className = 'poll-question';
        header.innerText = poll.question;

        var meta = document.createElement('div');
        meta.className = 'poll-meta';
        meta.innerText = '發起人: ' + poll.creator;

        card.appendChild(header);
        card.appendChild(meta);

        var hasVoted = poll.votedUsers && poll.votedUsers.indexOf(nickname) !== -1;
        var totalVotes = 0;
        for (var key in poll.votes) {
            totalVotes += poll.votes[key];
        }

        poll.options.forEach(function (option) {
            var optionDiv = document.createElement('div');
            optionDiv.className = 'poll-option';

            var count = poll.votes[option] || 0;
            var pct = totalVotes > 0 ? Math.round(count / totalVotes * 100) : 0;

            if (hasVoted) {
                var bar = document.createElement('div');
                bar.className = 'poll-bar';

                var fill = document.createElement('div');
                fill.className = 'poll-bar-fill';
                fill.style.width = pct + '%';

                var label = document.createElement('span');
                label.className = 'poll-bar-label';
                label.innerText = option + ' — ' + count + ' 票 (' + pct + '%)';

                bar.appendChild(fill);
                bar.appendChild(label);
                optionDiv.appendChild(bar);
            } else {
                var btn = document.createElement('button');
                btn.className = 'poll-vote-btn';
                btn.innerText = option;
                btn.onclick = (function (pId, opt) {
                    return function () { votePoll(pId, opt); };
                })(poll.pollId, option);
                optionDiv.appendChild(btn);
            }

            card.appendChild(optionDiv);
        });

        container.appendChild(card);
    });
}

function votePoll(pollId, option) {
    if (!currentRoomId) return;
    stompClient.send("/app/poll.vote", {}, JSON.stringify({
        roomId: currentRoomId,
        pollId: pollId,
        option: option
    }));
}

// ========== Calendar ==========

function addCalendarEvent() {
    var titleInput = document.getElementById('event-title');
    var dateInput = document.getElementById('event-date');
    var timeInput = document.getElementById('event-time');
    var title = titleInput.value.trim();
    var date = dateInput.value;
    if (!title || !date || !currentRoomId) return;

    stompClient.send("/app/calendar.add", {}, JSON.stringify({
        roomId: currentRoomId,
        title: title,
        date: date,
        time: timeInput.value || null
    }));
    titleInput.value = '';
    dateInput.value = '';
    timeInput.value = '';
}

function renderCalendar(events) {
    var container = document.getElementById('calendar-list');
    container.innerHTML = '';

    if (events.length === 0) {
        container.innerHTML = '<p class="empty-hint">目前沒有事件</p>';
        return;
    }

    events.forEach(function (event) {
        var card = document.createElement('div');
        card.className = 'calendar-card';

        var info = document.createElement('div');
        info.className = 'calendar-info';

        var title = document.createElement('div');
        title.className = 'calendar-title';
        title.innerText = event.title;

        var datetime = document.createElement('div');
        datetime.className = 'calendar-datetime';
        datetime.innerText = event.date + (event.time ? ' ' + event.time : '');

        var creator = document.createElement('div');
        creator.className = 'calendar-creator';
        creator.innerText = '建立者: ' + event.creator;

        info.appendChild(title);
        info.appendChild(datetime);
        info.appendChild(creator);

        var removeBtn = document.createElement('button');
        removeBtn.className = 'calendar-remove-btn';
        removeBtn.innerText = '刪除';
        removeBtn.onclick = (function (eId) {
            return function () { removeCalendarEvent(eId); };
        })(event.eventId);

        card.appendChild(info);
        card.appendChild(removeBtn);
        container.appendChild(card);
    });
}

function removeCalendarEvent(eventId) {
    if (!currentRoomId) return;
    stompClient.send("/app/calendar.remove", {}, JSON.stringify({
        roomId: currentRoomId,
        eventId: eventId
    }));
}

// ========== Lottery ==========

function drawLottery() {
    var input = document.getElementById('lottery-options');
    var optionsStr = input.value.trim();
    if (!optionsStr || !currentRoomId) return;

    var options = optionsStr.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    if (options.length < 2) return;

    stompClient.send("/app/lottery.draw", {}, JSON.stringify({
        roomId: currentRoomId,
        options: optionsStr
    }));
    input.value = '';
}

var wheelColors = ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40','#7BC8A4','#E7E9ED','#F67280','#C06C84'];

function showLotteryResult(data) {
    if (data.animate && typeof data.resultIndex === 'number') {
        showWheelAnimation(data);
    } else {
        appendLotteryCard(data);
    }
}

function appendLotteryCard(data) {
    var container = document.getElementById('lottery-history');

    var card = document.createElement('div');
    card.className = 'lottery-card';

    var header = document.createElement('div');
    header.className = 'lottery-header';
    header.innerText = data.drawer + ' 發起了樂透選';

    var optionsDiv = document.createElement('div');
    optionsDiv.className = 'lottery-options-list';
    optionsDiv.innerText = '選項: ' + data.options.join(', ');

    var resultDiv = document.createElement('div');
    resultDiv.className = 'lottery-result';
    resultDiv.innerText = data.result;

    card.appendChild(header);
    card.appendChild(optionsDiv);
    card.appendChild(resultDiv);

    container.insertBefore(card, container.firstChild);
}

function drawWheel(canvas, options, rotation) {
    var ctx = canvas.getContext('2d');
    var cx = canvas.width / 2;
    var cy = canvas.height / 2;
    var r = cx - 10;
    var n = options.length;
    var arc = (2 * Math.PI) / n;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    for (var i = 0; i < n; i++) {
        var startAngle = i * arc;
        var endAngle = startAngle + arc;

        // Draw segment
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = wheelColors[i % wheelColors.length];
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw text
        ctx.save();
        ctx.rotate(startAngle + arc / 2);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + Math.min(16, Math.floor(120 / n)) + 'px sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 3;
        var label = options[i].length > 6 ? options[i].substring(0, 5) + '…' : options[i];
        ctx.fillText(label, r - 12, 5);
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    ctx.restore();

    // Center circle
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function showWheelAnimation(data) {
    var overlay = document.getElementById('lottery-wheel-overlay');
    var canvas = document.getElementById('lottery-wheel-canvas');
    var resultText = document.getElementById('wheel-result-text');

    overlay.style.display = 'flex';
    resultText.style.display = 'none';

    var options = data.options;
    var n = options.length;
    var arc = (2 * Math.PI) / n;

    // The pointer is at the top (- PI/2). We want the winning segment centered at the top.
    // Segment i spans from i*arc to (i+1)*arc. Its center is (i+0.5)*arc.
    // We need rotation so that: rotation + (resultIndex + 0.5) * arc ≡ -PI/2 + fullSpins
    var fullSpins = 5 * 2 * Math.PI;
    var targetAngle = fullSpins + ((-Math.PI / 2) - (data.resultIndex + 0.5) * arc);

    var startTime = null;
    var duration = 4000; // 4 seconds

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function animate(timestamp) {
        if (!startTime) startTime = timestamp;
        var elapsed = timestamp - startTime;
        var progress = Math.min(elapsed / duration, 1);
        var eased = easeOutCubic(progress);
        var currentAngle = eased * targetAngle;

        drawWheel(canvas, options, currentAngle);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Animation done — show result
            resultText.innerText = '🎉 ' + data.result + ' 🎉';
            resultText.style.display = 'block';

            // Only the drawer sends the chat notification after animation
            if (data.drawer === nickname && stompClient && currentRoomId) {
                stompClient.send("/app/lottery.notify", {}, JSON.stringify({
                    roomId: currentRoomId,
                    result: data.result
                }));
            }

            setTimeout(function () {
                overlay.style.display = 'none';
                appendLotteryCard(data);
            }, 2000);
        }
    }

    requestAnimationFrame(animate);
}

// ========== Fortune ==========

var fortuneData = [
    {name:"第1籤 甲子",type:"上上",poem:"日出便見風雲散\n光明清淨照世間\n一向前途通大道\n萬事清吉保平安",interp:"雲開見日，前途光明，萬事順遂，平安大吉。"},
    {name:"第2籤 甲寅",type:"上吉",poem:"於今此景正當時\n看看欲吐百花魁\n若能遇得春色到\n一洒清吉脫塵埃",interp:"時機已到，好運將臨，把握當下，脫胎換骨。"},
    {name:"第3籤 甲辰",type:"上吉",poem:"勸君把定心莫虛\n天註衣祿自有餘\n和合重重常吉慶\n時來終遇得明珠",interp:"安定心神，福祿天定，吉慶連連，終得所願。"},
    {name:"第4籤 甲午",type:"上吉",poem:"風恬浪靜可行舟\n恰是中秋月一輪\n凡事不須多憂慮\n福祿自有慶家門",interp:"風平浪靜，圓滿如月，無須憂慮，福祿自來。"},
    {name:"第5籤 甲申",type:"中平",poem:"只恐前途命有變\n勸君作急可宜先\n且守長江無大事\n命逢太白守身邊",interp:"前途有變，宜早準備，安守本分，自有庇護。"},
    {name:"第6籤 甲戌",type:"下下",poem:"風雲致雨落洋洋\n天災時氣必有傷\n命內此事難和合\n更逢一足出外鄉",interp:"風雨飄搖，災厄難免，事難圓滿，宜忍耐等待。"},
    {name:"第7籤 乙丑",type:"上吉",poem:"雲開月出正分明\n不須進退問前程\n婚姻皆由天註定\n和合清吉萬事成",interp:"撥雲見月，前程分明，姻緣天定，萬事亨通。"},
    {name:"第8籤 乙卯",type:"上上",poem:"禾稻看看結成完\n此事必定兩相全\n回到家中寬心坐\n妻兒鼓舞樂團圓",interp:"豐收在望，兩全其美，闔家歡樂，團圓美滿。"},
    {name:"第9籤 乙巳",type:"中平",poem:"龍虎相隨在深山\n君爾何須背後看\n不知此去相愛愉\n他日與我卻無干",interp:"各有前程，不必回顧，順其自然，各奔東西。"},
    {name:"第10籤 乙未",type:"下下",poem:"花開結子一半枯\n可惜今年汝虛度\n漸漸日落西山去\n勸君不用向前途",interp:"成果折半，時光虛度，日薄西山，暫勿前行。"},
    {name:"第11籤 乙酉",type:"中吉",poem:"靈雞漸漸見分明\n凡事且看子丑寅\n雲開月出照天下\n郎君即便見太平",interp:"漸入佳境，靜待時機，雲開月明，終見太平。"},
    {name:"第12籤 乙亥",type:"中吉",poem:"長江風浪漸漸靜\n于今得進可安寧\n必有貴人相扶助\n凶事脫出見太平",interp:"風浪漸息，安寧可期，貴人相助，逢凶化吉。"},
    {name:"第13籤 丙子",type:"下下",poem:"命中正逢羅孛關\n用盡心機總未休\n作福問神難得過\n恰是行舟上高灘",interp:"命逢劫難，費盡心思也難過關，宜靜待時機。"},
    {name:"第14籤 丙寅",type:"中吉",poem:"財中漸漸見分明\n花開花謝結子成\n寬心且看月中桂\n郎君即便見太平",interp:"財運漸明，花開結果，寬心等待，好運將至。"},
    {name:"第15籤 丙辰",type:"中平",poem:"八十原來是太公\n看看晚景遇文王\n目下緊事休相問\n勸君且守待運通",interp:"大器晚成，如太公遇文王，眼前勿急，守待好運。"},
    {name:"第16籤 丙午",type:"下下",poem:"不須作福不須求\n用盡心機總未休\n陽世不知陰世事\n官法如爐不自由",interp:"求之不得，心機白費，世事難料，身不由己。"},
    {name:"第17籤 丙申",type:"中平",poem:"舊恨重重未改為\n家中禍患不臨身\n須當謹防宜作福\n龍蛇交會得和合",interp:"舊事未了，需謹慎防範，多行善事，方得和合。"},
    {name:"第18籤 丙戌",type:"上吉",poem:"君問中間此言因\n看看祿馬拱前程\n若得貴人多得利\n和合自有兩分明",interp:"祿馬拱照，前程似錦，貴人相助，利益分明。"},
    {name:"第19籤 丁丑",type:"中平",poem:"富貴由命天註定\n心高必然誤君期\n不然且回依舊路\n雲開月出自分明",interp:"富貴天定，勿好高騖遠，回歸本分，自會明朗。"},
    {name:"第20籤 丁卯",type:"下下",poem:"前途功名未得意\n只恐命內有交加\n兩家必定防損失\n勸君且退莫咨嗟",interp:"功名未就，禍事交加，宜退守防損，勿嘆息。"},
    {name:"第21籤 丁巳",type:"上吉",poem:"十方佛法有靈通\n大難禍患不相同\n紅日當空常照耀\n還有貴人到家堂",interp:"佛法庇佑，災禍遠離，紅日高照，貴人臨門。"},
    {name:"第22籤 丁未",type:"上上",poem:"太公家業八十成\n月出光輝四海明\n命內自然逢大吉\n茅屋中間百事亨",interp:"大器晚成，光輝四海，命逢大吉，百事亨通。"},
    {name:"第23籤 丁酉",type:"中平",poem:"欲去長江水闊茫\n前途未遂運未通\n如今絲綸常在手\n只恐魚水不相逢",interp:"前途茫茫，運勢未通，雖有準備，恐難如願。"},
    {name:"第24籤 丁亥",type:"上吉",poem:"月出光輝四海明\n前途祿位見太平\n浮雲掃退終無事\n可保禍患不臨身",interp:"光明普照，祿位太平，掃除障礙，禍患不侵。"},
    {name:"第25籤 戊子",type:"下下",poem:"總是前途莫心勞\n求神問聖枉是多\n但看雞犬日過後\n不須作福事如何",interp:"前途勞心無用，求神問卜也枉然，靜待時過。"},
    {name:"第26籤 戊寅",type:"上上",poem:"選出牡丹第一枝\n勸君折取莫遲疑\n世間若問相知處\n萬事逢春正及時",interp:"機會難得如牡丹，把握良機莫遲疑，萬事逢春。"},
    {name:"第27籤 戊辰",type:"上吉",poem:"君爾寬心且自由\n門庭清吉家無憂\n財寶自然終吉利\n凡事無傷不用求",interp:"寬心自在，家門清吉，財運亨通，無須強求。"},
    {name:"第28籤 戊午",type:"下下",poem:"於今莫作此當時\n虎落平陽被犬欺\n世間凡事何難定\n千山萬水也遲疑",interp:"時運不濟，虎落平陽，世事難定，舉步維艱。"},
    {name:"第29籤 戊申",type:"中平",poem:"枯木可惜未逢春\n如今反在暗中藏\n寬心且守風霜退\n還君依舊作乾坤",interp:"枯木待春，暫居暗處，忍耐風霜，終見天日。"},
    {name:"第30籤 戊戌",type:"中平",poem:"漸漸看此月中和\n過後須防未得高\n改變顏色前途去\n凡事必定見重勞",interp:"月盈則虧，需防高處跌落，前途多勞，宜謹慎。"},
    {name:"第31籤 己丑",type:"上吉",poem:"綠柳蒼蒼正當時\n任君此去作乾坤\n花果結實無殘謝\n福祿自有慶家門",interp:"生機盎然，大展身手，花果豐盛，福祿滿門。"},
    {name:"第32籤 己卯",type:"下下",poem:"龍虎相交在門前\n此事必定兩相連\n黃金忽然變成鐵\n何用作福問神仙",interp:"看似美好卻生變，金變為鐵，求神也無用。"},
    {name:"第33籤 己巳",type:"中吉",poem:"欲去長江水闊茫\n行舟把定未遭風\n戶內用心再作福\n看看魚水得相逢",interp:"長江雖闊，行舟穩定，用心行善，終得所願。"},
    {name:"第34籤 己未",type:"中吉",poem:"危險高山行過盡\n莫嫌此路有重重\n若見蘭桂漸漸發\n長蛇反轉變成龍",interp:"歷經險阻，終見光明，蛇化為龍，否極泰來。"},
    {name:"第35籤 己酉",type:"中吉",poem:"此事何須用心機\n前途變怪自然知\n看看此去得和合\n漸漸脫出見太平",interp:"不必費心機，順其自然，漸漸和合，終見太平。"},
    {name:"第36籤 己亥",type:"上上",poem:"福如東海壽如山\n君爾何須嘆苦難\n命內自然逢大吉\n祈保分明自平安",interp:"福壽雙全，無須嘆息，命逢大吉，平安自來。"},
    {name:"第37籤 庚子",type:"上吉",poem:"運逢得意身顯變\n君爾身中皆有益\n一向前途無難事\n決意之中保清吉",interp:"運勢得意，身心受益，前途無阻，決斷吉利。"},
    {name:"第38籤 庚寅",type:"中吉",poem:"名顯有意在中央\n不須祈禱心自安\n看看早晚日過後\n即時得意在其間",interp:"名利在望，不須祈求，時候一到，自然得意。"},
    {name:"第39籤 庚辰",type:"中吉",poem:"意中若問神仙路\n勸爾且退望高樓\n寬心且守寬心坐\n必然遇得貴人扶",interp:"勿急躁冒進，退守寬心，貴人自會來扶持。"},
    {name:"第40籤 庚午",type:"上上",poem:"平生富貴成祿位\n君家門戶定光輝\n此中必定無損失\n夫妻百歲喜相隨",interp:"富貴天成，門庭光輝，無損無失，百年好合。"},
    {name:"第41籤 庚申",type:"中吉",poem:"今行到此實難推\n歌歌暢飲自徘徊\n雞犬相聞消息近\n婚姻夙世結成雙",interp:"事已至此順勢而行，好消息將近，姻緣天定。"},
    {name:"第42籤 庚戌",type:"下下",poem:"一重江水一重山\n誰知此去路又難\n任他改求終不過\n是非終久未得安",interp:"重重阻礙，路途艱難，反覆求索也難安寧。"},
    {name:"第43籤 辛丑",type:"中吉",poem:"一年作事急如飛\n君爾寬心莫遲疑\n貴人還在千里外\n音信月中漸漸知",interp:"事情進展快速，寬心莫疑，貴人雖遠，消息將至。"},
    {name:"第44籤 辛卯",type:"中吉",poem:"客到前途多得利\n君爾何故兩相疑\n雖是中間逢進退\n月出光輝得運時",interp:"前途得利，勿多疑慮，雖有波折，終見光明。"},
    {name:"第45籤 辛巳",type:"上上",poem:"花開今已結成果\n富貴榮華終到老\n君子小人相會合\n萬事清吉莫煩惱",interp:"花開結果，富貴一生，貴賤皆合，萬事無憂。"},
    {name:"第46籤 辛未",type:"上上",poem:"功名得意與君顯\n前途富貴喜安然\n若遇一輪明月照\n十五團圓光滿天",interp:"功名得意，富貴安然，明月團圓，光芒萬丈。"},
    {name:"第47籤 辛酉",type:"中吉",poem:"君爾何須問聖跡\n自己心中皆有益\n於今且看月中旬\n凶事脫出化成吉",interp:"不須外求，心中自有答案，逢凶化吉。"},
    {name:"第48籤 辛亥",type:"下下",poem:"陽世作事未和同\n雲遮月色正朦朧\n心中意欲前途去\n只恐命內運未通",interp:"事事不順，前途朦朧，欲進不得，運勢不通。"},
    {name:"第49籤 壬子",type:"中平",poem:"言語雖多不可從\n風雲靜處未行龍\n暗中終得明消息\n君爾何須問重重",interp:"多言無益，龍未出淵，暗中自有消息，不必多問。"},
    {name:"第50籤 壬寅",type:"中吉",poem:"佛前發誓無異心\n且看前途得好音\n此物原來本是鐵\n也能變化得成金",interp:"誠心不移，前途好音將至，鐵也能煉成金。"},
    {name:"第51籤 壬辰",type:"中平",poem:"東西南北不堪行\n前途此事正可當\n勸君把定莫煩惱\n家門自有保安康",interp:"四方不利，安守家中，勿煩勿惱，自保安康。"},
    {name:"第52籤 壬午",type:"上吉",poem:"功名事業本由天\n不須掛念意懸懸\n若問中間遲與速\n風雲際會在眼前",interp:"功名天定，不須掛念，風雲際會，好運在即。"},
    {name:"第53籤 壬申",type:"上上",poem:"看君來問心中事\n積善之家慶有餘\n運亨財子雙雙至\n指日喜氣溢門閭",interp:"積善之家必有餘慶，運通財子雙至，喜氣盈門。"},
    {name:"第54籤 壬戌",type:"中吉",poem:"孤燈寂寂夜沉沉\n萬事清吉萬事成\n若逢陰中有善果\n燒得好香達神明",interp:"靜夜孤燈中自省，誠心行善，萬事可成。"},
    {name:"第55籤 癸丑",type:"中平",poem:"須知進退總言虛\n看看發暗未必全\n珠玉深藏還未變\n心中但得枉徒然",interp:"進退難定，暗中未明，珠玉藏深，徒勞無功。"},
    {name:"第56籤 癸卯",type:"中平",poem:"病中若得苦心勞\n到底完全總未遭\n去後不須回頭問\n心中事務盡消磨",interp:"苦中掙扎，最終無恙，去後勿回頭，煩事自消。"},
    {name:"第57籤 癸巳",type:"上吉",poem:"勸君把定心莫虛\n前途清吉得運時\n到底中間無大事\n又遇神仙守安居",interp:"安定心志，前途清吉，無大波折，安居樂業。"},
    {name:"第58籤 癸未",type:"下下",poem:"蛇身意欲變成龍\n只恐命內運未通\n久病且作寬心坐\n言語雖多不可從",interp:"志高運低，欲化龍而不能，宜寬心靜待。"},
    {name:"第59籤 癸酉",type:"上吉",poem:"有心作福莫遲疑\n求名清吉正當時\n此事必能成會合\n財寶自然喜相隨",interp:"行善莫疑，求名正是時候，事成財至，喜氣相隨。"},
    {name:"第60籤 癸亥",type:"中吉",poem:"月出光輝本清吉\n浮雲總是蔽陰色\n戶內用心再作福\n當官分理便有益",interp:"本為吉兆但有浮雲遮蔽，用心行善，自有好處。"}
];

var fortuneAnimating = false;

function drawFortune() {
    if (fortuneAnimating || !stompClient || !currentRoomId) return;
    fortuneAnimating = true;

    var idx = Math.floor(Math.random() * fortuneData.length);
    var fortune = fortuneData[idx];
    var tube = document.getElementById('fortune-tube');
    var stickOut = document.getElementById('fortune-stick-out');
    var card = document.getElementById('fortune-card');
    var btn = document.getElementById('fortune-draw-btn');

    btn.disabled = true;
    card.style.display = 'none';
    stickOut.style.display = 'none';

    // Phase 1: Shake the tube (2.5s)
    tube.classList.add('shaking');

    setTimeout(function () {
        tube.classList.remove('shaking');

        // Phase 2: Stick slides out beside tube (1.5s)
        stickOut.innerText = fortune.name;
        stickOut.style.display = 'block';
        stickOut.classList.add('slide-out');

        setTimeout(function () {
            stickOut.classList.remove('slide-out');

            // Phase 3: Show fortune card
            card.style.display = 'block';
            card.classList.add('fade-in');
            document.getElementById('fortune-number').innerText = fortune.name;
            document.getElementById('fortune-type').innerText = fortune.type;
            document.getElementById('fortune-type').className = 'fortune-type-' + getFortuneClass(fortune.type);
            document.getElementById('fortune-poem').innerText = fortune.poem;
            document.getElementById('fortune-interp').innerText = '📜 ' + fortune.interp;

            // Send chat notification after animation
            if (stompClient && currentRoomId) {
                stompClient.send("/app/fortune.notify", {}, JSON.stringify({
                    roomId: currentRoomId,
                    fortuneName: fortune.name,
                    fortuneType: fortune.type
                }));
            }

            setTimeout(function () {
                card.classList.remove('fade-in');
                fortuneAnimating = false;
                btn.disabled = false;
            }, 500);
        }, 1500);
    }, 2500);
}

function getFortuneClass(type) {
    if (type === '上上') return 'best';
    if (type === '上吉') return 'great';
    if (type === '中吉') return 'good';
    if (type === '中平') return 'neutral';
    return 'bad';
}

// ========== Gacha (抽賞) ==========

function addPrizeRow() {
    var container = document.getElementById('gacha-prize-inputs');
    var row = document.createElement('div');
    row.className = 'gacha-prize-row';
    row.innerHTML = '<input type="text" placeholder="獎賞名稱" class="prize-name">' +
        '<input type="number" placeholder="數量" class="prize-qty" min="1" value="1">' +
        '<button class="prize-remove-btn" onclick="removePrizeRow(this)" title="移除">✕</button>';
    container.appendChild(row);
}

function removePrizeRow(btn) {
    var container = document.getElementById('gacha-prize-inputs');
    if (container.children.length > 1) {
        btn.parentElement.remove();
    }
}

function createGachaPool() {
    if (!stompClient || !currentRoomId) return;
    var poolName = document.getElementById('gacha-pool-name').value.trim();
    if (!poolName) { alert('請輸入抽賞名稱'); return; }

    var rows = document.querySelectorAll('.gacha-prize-row');
    var prizes = [];
    rows.forEach(function (row) {
        var name = row.querySelector('.prize-name').value.trim();
        var qty = parseInt(row.querySelector('.prize-qty').value) || 1;
        if (name) prizes.push({ name: name, qty: qty });
    });
    if (prizes.length === 0) { alert('請至少新增一個獎賞'); return; }

    var ipLimit = parseInt(document.getElementById('gacha-ip-limit').value) || 0;

    stompClient.send("/app/gacha.create", {}, JSON.stringify({
        roomId: currentRoomId,
        poolName: poolName,
        maxDrawPerIp: ipLimit,
        prizes: prizes
    }));

    // Reset form
    document.getElementById('gacha-pool-name').value = '';
    document.getElementById('gacha-ip-limit').value = '0';
    var container = document.getElementById('gacha-prize-inputs');
    container.innerHTML = '<div class="gacha-prize-row">' +
        '<input type="text" placeholder="獎賞名稱" class="prize-name">' +
        '<input type="number" placeholder="數量" class="prize-qty" min="1" value="1">' +
        '<button class="prize-remove-btn" onclick="removePrizeRow(this)" title="移除">✕</button></div>';
}

function renderGachaList() {
    var list = document.getElementById('gacha-pool-list');
    list.innerHTML = '';
    if (gachaPools.length === 0) {
        list.innerHTML = '<p class="gacha-empty">尚未建立任何抽賞</p>';
        return;
    }
    gachaPools.forEach(function (pool) {
        var totalRemaining = 0;
        var totalAll = 0;
        pool.prizes.forEach(function (p) {
            totalRemaining += p.remaining;
            totalAll += p.total;
        });
        var card = document.createElement('div');
        card.className = 'gacha-pool-card';
        if (totalRemaining === 0) card.classList.add('gacha-depleted');
        card.innerHTML = '<div class="gacha-pool-name">🎰 ' + pool.poolName + '</div>' +
            '<div class="gacha-pool-info">建立者: ' + pool.creator + ' | 剩餘: ' + totalRemaining + '/' + totalAll + '</div>';
        card.onclick = (function (p) {
            return function () { openGachaDetail(p.poolId); };
        })(pool);
        list.appendChild(card);
    });
}

function openGachaDetail(poolId) {
    var pool = null;
    for (var i = 0; i < gachaPools.length; i++) {
        if (gachaPools[i].poolId === poolId) { pool = gachaPools[i]; break; }
    }
    if (!pool) return;
    currentGachaPoolId = poolId;

    document.getElementById('gacha-detail-title').innerText = '🎰 ' + pool.poolName;
    document.getElementById('gacha-detail-creator').innerText = '建立者: ' + pool.creator;
    document.getElementById('gacha-detail-limit').innerText = '每 IP 抽獎上限: ' + (pool.maxDrawPerIp > 0 ? pool.maxDrawPerIp + ' 次' : '無限制');

    var tbody = document.querySelector('#gacha-detail-prizes tbody');
    tbody.innerHTML = '';
    pool.prizes.forEach(function (p) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + p.name + '</td><td>' + p.total + '</td><td>' +
            (p.remaining > 0 ? p.remaining : '<span class="gacha-sold-out">已抽完</span>') + '</td>';
        tbody.appendChild(tr);
    });

    // Check remaining prizes
    var totalRemaining = 0;
    pool.prizes.forEach(function (p) { totalRemaining += p.remaining; });

    // Check IP draw limit
    var myIp = '';
    for (var j = 0; j < currentRoomUsers.length; j++) {
        if (currentRoomUsers[j].nickname === nickname) {
            myIp = currentRoomUsers[j].ip;
            break;
        }
    }
    var myDrawCount = (pool.ipDrawCount && myIp && pool.ipDrawCount[myIp]) ? pool.ipDrawCount[myIp] : 0;
    var ipLimitReached = pool.maxDrawPerIp > 0 && myDrawCount >= pool.maxDrawPerIp;

    // Show draw count info
    var limitInfo = document.getElementById('gacha-detail-limit');
    if (pool.maxDrawPerIp > 0) {
        limitInfo.innerText = '每 IP 抽獎上限: ' + pool.maxDrawPerIp + ' 次（你已抽 ' + myDrawCount + ' 次）';
    } else {
        limitInfo.innerText = '每 IP 抽獎上限: 無限制';
    }

    // Draw button state
    var drawBtn = document.getElementById('gacha-draw-btn');
    if (totalRemaining === 0) {
        drawBtn.disabled = true;
        drawBtn.innerText = '🚫 已抽完';
    } else if (ipLimitReached) {
        drawBtn.disabled = true;
        drawBtn.innerText = '🚫 已達抽獎上限';
    } else {
        drawBtn.disabled = false;
        drawBtn.innerText = '🎰 抽！';
    }

    // Delete button — only creator can see
    var deleteBtn = document.getElementById('gacha-delete-btn');
    deleteBtn.style.display = (pool.creator === nickname) ? 'inline-block' : 'none';

    document.getElementById('gacha-detail-overlay').style.display = 'flex';
}

function closeGachaDetail() {
    document.getElementById('gacha-detail-overlay').style.display = 'none';
    currentGachaPoolId = null;
}

function drawGacha() {
    if (!stompClient || !currentRoomId || !currentGachaPoolId) return;
    stompClient.send("/app/gacha.draw", {}, JSON.stringify({
        roomId: currentRoomId,
        poolId: currentGachaPoolId
    }));
    closeGachaDetail();
}

function deleteGachaPool() {
    if (!stompClient || !currentRoomId || !currentGachaPoolId) return;
    if (!confirm('確定要刪除這個抽賞嗎？')) return;
    stompClient.send("/app/gacha.delete", {}, JSON.stringify({
        roomId: currentRoomId,
        poolId: currentGachaPoolId
    }));
    closeGachaDetail();
}

function showGachaAnimation(data) {
    if (!data.success) return;
    var overlay = document.getElementById('gacha-animation-overlay');
    var ballContainer = document.getElementById('gacha-ball-container');
    var resultText = document.getElementById('gacha-result-text');

    var colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#e67e22','#1abc9c','#e84393','#00bcd4','#ff5722'];
    var ballCount = 8;

    resultText.style.display = 'none';
    resultText.className = '';
    ballContainer.innerHTML = '';
    ballContainer.className = '';

    // Create orbiting balls
    for (var i = 0; i < ballCount; i++) {
        var ball = document.createElement('div');
        ball.className = 'gacha-orbit-ball';
        ball.style.backgroundColor = colors[i % colors.length];
        ball.style.setProperty('--orbit-start', (i * (360 / ballCount)) + 'deg');
        ball.style.setProperty('--orbit-delay', '0s');
        ball.style.setProperty('--orbit-duration', '0.8s');
        ballContainer.appendChild(ball);
    }

    overlay.style.display = 'flex';

    // Phase 1: Fast spin (2s)
    ballContainer.classList.add('gacha-spinning');

    // Phase 2: Slow down (1.5s)
    setTimeout(function () {
        ballContainer.classList.remove('gacha-spinning');
        var balls = ballContainer.querySelectorAll('.gacha-orbit-ball');
        for (var j = 0; j < balls.length; j++) {
            balls[j].style.setProperty('--orbit-duration', '3s');
        }
        ballContainer.classList.add('gacha-slowing');
    }, 2000);

    // Phase 3: Stop, show winner ball in center (after 3.5s total)
    setTimeout(function () {
        ballContainer.classList.remove('gacha-slowing');
        ballContainer.innerHTML = '';

        var winBall = document.createElement('div');
        winBall.className = 'gacha-winner-center';
        winBall.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        winBall.innerText = '🎉';
        ballContainer.appendChild(winBall);

        // Phase 4: Show result text
        setTimeout(function () {
            resultText.innerHTML = '<div class="gacha-result-prize">' + data.prizeName + '</div>' +
                '<div class="gacha-result-drawer">' + data.drawer + ' 抽到了！</div>';
            resultText.style.display = 'block';
            resultText.className = 'gacha-result-visible';

            if (data.drawer === nickname && stompClient && currentRoomId) {
                stompClient.send("/app/gacha.notify", {}, JSON.stringify({
                    roomId: currentRoomId,
                    poolName: data.poolName,
                    prizeName: data.prizeName
                }));
            }

            setTimeout(function () {
                overlay.style.display = 'none';
            }, 2500);
        }, 800);
    }, 3500);
}

// ========== Canvas ==========

function getCanvasCoords(canvas, e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function initCanvas() {
    var canvas = document.getElementById('shared-canvas');
    var ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    canvas.onmousedown = function (e) {
        canvasDrawing = true;
        var pos = getCanvasCoords(canvas, e);
        canvasLastX = pos.x;
        canvasLastY = pos.y;
    };

    canvas.onmousemove = function (e) {
        if (!canvasDrawing || !currentRoomId) return;
        var pos = getCanvasCoords(canvas, e);
        var color = canvasEraser ? '#FFFFFF' : document.getElementById('canvas-color').value;
        var width = parseInt(document.getElementById('canvas-width').value);

        stompClient.send("/app/canvas.draw", {}, JSON.stringify({
            roomId: currentRoomId,
            fromX: canvasLastX,
            fromY: canvasLastY,
            toX: pos.x,
            toY: pos.y,
            color: color,
            width: width
        }));

        canvasLastX = pos.x;
        canvasLastY = pos.y;
    };

    canvas.onmouseup = function () { canvasDrawing = false; };
    canvas.onmouseleave = function () { canvasDrawing = false; };

    // Update eraser cursor when width slider changes
    document.getElementById('canvas-width').addEventListener('input', function () {
        if (canvasEraser) updateEraserCursor();
    });
}

function toggleEraser() {
    canvasEraser = !canvasEraser;
    var btn = document.getElementById('eraser-btn');
    if (canvasEraser) {
        btn.classList.add('active');
        updateEraserCursor();
    } else {
        btn.classList.remove('active');
        document.getElementById('shared-canvas').style.cursor = 'crosshair';
    }
}

function updateEraserCursor() {
    var width = parseInt(document.getElementById('canvas-width').value);
    var canvas = document.getElementById('shared-canvas');
    var rect = canvas.getBoundingClientRect();
    // Scale from canvas pixels to CSS pixels for cursor display
    var cssSize = Math.max(width * (rect.width / canvas.width), 6);
    var size = Math.ceil(cssSize) + 2;
    var cur = document.createElement('canvas');
    cur.width = size;
    cur.height = size;
    var ctx = cur.getContext('2d');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, cssSize / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    var half = Math.floor(size / 2);
    canvas.style.cursor = 'url(' + cur.toDataURL() + ') ' + half + ' ' + half + ', auto';
}

function handleCanvasMessage(data) {
    if (data.type === 'clear') {
        clearCanvasLocal();
        return;
    }

    var canvas = document.getElementById('shared-canvas');
    var ctx = canvas.getContext('2d');
    ctx.strokeStyle = data.color || '#000000';
    ctx.lineWidth = data.width || 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(data.fromX, data.fromY);
    ctx.lineTo(data.toX, data.toY);
    ctx.stroke();
}

function clearCanvas() {
    if (!currentRoomId) return;
    stompClient.send("/app/canvas.clear", {}, JSON.stringify({
        roomId: currentRoomId
    }));
}

function clearCanvasLocal() {
    var canvas = document.getElementById('shared-canvas');
    if (canvas) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// ========== Random Line Art ==========

var lineArtTemplates = [
    { name: '貓', paths: [
        // head
        {pts:[[180,180],[170,160],[165,140],[170,120],[180,110],[200,105],[220,105],[240,110],[250,120],[255,140],[250,160],[240,180]]},
        // left ear
        {pts:[[170,120],[155,85],[180,110]]},
        // right ear
        {pts:[[250,120],[265,85],[240,110]]},
        // eyes
        {pts:[[190,140],[195,138],[200,140],[195,142],[190,140]]},
        {pts:[[220,140],[225,138],[230,140],[225,142],[220,140]]},
        // nose
        {pts:[[210,152],[207,157],[213,157],[210,152]]},
        // mouth
        {pts:[[210,157],[205,165]]},
        {pts:[[210,157],[215,165]]},
        // whiskers
        {pts:[[160,148],[190,150]]},
        {pts:[[158,158],[188,157]]},
        {pts:[[230,150],[260,148]]},
        {pts:[[232,157],[262,158]]},
        // body
        {pts:[[180,180],[160,220],[155,260],[160,300],[180,320],[210,330],[240,320],[260,300],[265,260],[260,220],[240,180]]},
        // tail
        {pts:[[260,290],[290,270],[310,250],[330,260],[340,280]]}
    ]},
    { name: '花', paths: [
        // stem
        {pts:[[210,380],[210,250]]},
        // left leaf
        {pts:[[210,320],[180,300],[170,310],[190,330],[210,320]]},
        // right leaf
        {pts:[[210,290],[240,270],[250,280],[230,300],[210,290]]},
        // petals
        {pts:[[210,250],[195,220],[180,210],[185,195],[200,200],[210,210]]},
        {pts:[[210,210],[220,200],[235,195],[240,210],[225,220],[210,250]]},
        {pts:[[210,210],[225,195],[230,180],[220,170],[205,175],[200,190],[210,210]]},
        {pts:[[210,210],[195,175],[190,170],[200,180],[210,210]]},
        {pts:[[210,210],[185,200],[175,190],[180,180],[195,185],[210,210]]},
        // center
        {pts:[[203,205],[207,200],[213,200],[217,205],[215,210],[205,210],[203,205]]}
    ]},
    { name: '星星', paths: [
        {pts:[[210,100],[225,170],[295,170],[238,215],[258,285],[210,242],[162,285],[182,215],[125,170],[195,170],[210,100]]}
    ]},
    { name: '房子', paths: [
        // roof
        {pts:[[120,200],[210,120],[300,200]]},
        // walls
        {pts:[[140,200],[140,320],[280,320],[280,200]]},
        // door
        {pts:[[190,320],[190,260],[230,260],[230,320]]},
        // door knob
        {pts:[[222,290],[225,290]]},
        // window
        {pts:[[150,220],[150,260],[180,260],[180,220],[150,220]]},
        {pts:[[165,220],[165,260]]},
        {pts:[[150,240],[180,240]]},
        // chimney
        {pts:[[250,160],[250,110],[275,110],[275,180]]}
    ]},
    { name: '魚', paths: [
        // body
        {pts:[[130,210],[160,180],[200,170],[250,175],[280,190],[290,210],[280,230],[250,245],[200,250],[160,240],[130,210]]},
        // tail
        {pts:[[130,210],[100,180],[95,165]]},
        {pts:[[130,210],[100,240],[95,255]]},
        {pts:[[100,180],[100,240]]},
        // eye
        {pts:[[245,200],[250,197],[255,200],[250,203],[245,200]]},
        // fin top
        {pts:[[200,170],[190,140],[215,165]]},
        // fin bottom
        {pts:[[200,250],[195,270],[215,248]]},
        // mouth
        {pts:[[285,205],[295,210],[285,215]]},
        // scales
        {pts:[[180,200],[195,190],[210,200],[195,210],[180,200]]},
        {pts:[[210,195],[225,185],[240,195],[225,205],[210,195]]}
    ]},
    { name: '蝴蝶', paths: [
        // body
        {pts:[[210,160],[210,280]]},
        // antennae
        {pts:[[210,160],[190,130],[185,120]]},
        {pts:[[210,160],[230,130],[235,120]]},
        // left wing top
        {pts:[[210,180],[180,160],[150,165],[140,190],[150,210],[180,210],[210,200]]},
        // left wing bottom
        {pts:[[210,210],[185,220],[165,240],[170,265],[190,270],[210,255]]},
        // right wing top
        {pts:[[210,180],[240,160],[270,165],[280,190],[270,210],[240,210],[210,200]]},
        // right wing bottom
        {pts:[[210,210],[235,220],[255,240],[250,265],[230,270],[210,255]]},
        // wing patterns
        {pts:[[170,185],[180,180],[190,190],[180,195],[170,185]]},
        {pts:[[250,185],[240,180],[230,190],[240,195],[250,185]]}
    ]},
    { name: '樹', paths: [
        // trunk
        {pts:[[195,380],[195,250],[190,240]]},
        {pts:[[225,380],[225,250],[230,240]]},
        // canopy
        {pts:[[140,250],[150,210],[170,185],[190,170],[210,160],[230,170],[250,185],[270,210],[280,250],[260,240],[240,225],[210,218],[180,225],[160,240],[140,250]]},
        // branch left
        {pts:[[195,280],[170,260]]},
        // branch right
        {pts:[[225,270],[250,255]]}
    ]},
    { name: '愛心', paths: [
        {pts:[[210,300],[150,240],[130,200],[135,170],[155,150],[180,150],[210,175],[240,150],[265,150],[285,170],[290,200],[270,240],[210,300]]}
    ]},
    { name: '太陽', paths: [
        // circle
        {pts:[[240,190],[248,173],[260,162],[275,157],[290,160],[302,170],[310,183],[312,200],[310,217],[302,230],[290,240],[275,243],[260,238],[248,227],[240,210],[240,190]]},
        // rays
        {pts:[[275,155],[275,125]]},
        {pts:[[310,170],[335,150]]},
        {pts:[[318,200],[348,200]]},
        {pts:[[310,230],[335,250]]},
        {pts:[[275,245],[275,275]]},
        {pts:[[240,230],[215,250]]},
        {pts:[[232,200],[202,200]]},
        {pts:[[240,170],[215,150]]}
    ]},
    { name: '月亮', paths: [
        {pts:[[230,130],[215,145],[205,170],[200,200],[205,230],[215,255],[230,270],[250,280],[245,265],[238,245],[235,220],[235,200],[238,175],[245,155],[255,140],[250,132],[240,128],[230,130]]}
    ]},
    { name: '雲朵', paths: [
        {pts:[[150,220],[155,200],[170,188],[190,185],[200,190],[210,182],[230,178],[250,182],[265,192],[272,205],[275,220],[270,232],[255,238],[230,240],[200,240],[175,238],[158,232],[150,220]]}
    ]},
    { name: '雨傘', paths: [
        // canopy
        {pts:[[120,200],[130,170],[155,148],[185,138],[210,135],[235,138],[265,148],[290,170],[300,200],[270,190],[240,185],[210,190],[180,185],[150,190],[120,200]]},
        // handle
        {pts:[[210,135],[210,300]]},
        // hook
        {pts:[[210,300],[215,315],[225,320],[230,315]]}
    ]},
    { name: '鑽石', paths: [
        {pts:[[210,100],[160,170],[210,310],[260,170],[210,100]]},
        {pts:[[160,170],[260,170]]},
        {pts:[[175,100],[160,170]]},
        {pts:[[245,100],[260,170]]},
        {pts:[[175,100],[245,100]]},
        {pts:[[175,100],[210,170]]},
        {pts:[[245,100],[210,170]]},
        {pts:[[210,170],[210,310]]}
    ]},
    { name: '音符', paths: [
        // note head 1
        {pts:[[180,260],[175,268],[178,278],[188,282],[198,278],[200,268],[195,260],[185,258],[180,260]]},
        // stem 1
        {pts:[[200,265],[200,150]]},
        // note head 2
        {pts:[[240,240],[235,248],[238,258],[248,262],[258,258],[260,248],[255,240],[245,238],[240,240]]},
        // stem 2
        {pts:[[260,245],[260,130]]},
        // beam
        {pts:[[200,150],[260,130]]},
        {pts:[[200,165],[260,145]]}
    ]},
    { name: '杯子', paths: [
        // cup body
        {pts:[[155,150],[150,300],[270,300],[265,150]]},
        // rim
        {pts:[[150,150],[270,150]]},
        // handle
        {pts:[[270,180],[295,185],[305,210],[300,240],[270,250]]},
        // steam
        {pts:[[190,150],[185,130],[192,115]]},
        {pts:[[210,150],[210,125],[215,110]]},
        {pts:[[230,150],[228,132],[233,118]]}
    ]},
    { name: '船', paths: [
        // hull
        {pts:[[120,250],[140,290],[280,290],[300,250]]},
        // deck
        {pts:[[120,250],[300,250]]},
        // mast
        {pts:[[210,250],[210,130]]},
        // sail left
        {pts:[[210,140],[150,200],[210,240]]},
        // sail right
        {pts:[[210,145],[265,200],[210,235]]},
        // flag
        {pts:[[210,130],[235,140],[210,150]]},
        // water
        {pts:[[100,295],[120,290],[140,295],[160,290],[180,295],[200,290],[220,295],[240,290],[260,295],[280,290],[300,295],[320,290]]}
    ]},
    { name: '鈴鐺', paths: [
        // bell body
        {pts:[[160,260],[165,210],[175,175],[190,155],[210,148],[230,155],[245,175],[255,210],[260,260]]},
        // rim
        {pts:[[145,260],[275,260]]},
        // top
        {pts:[[200,148],[205,135],[215,135],[220,148]]},
        // loop
        {pts:[[205,135],[200,125],[205,118],[215,118],[220,125],[215,135]]},
        // clapper
        {pts:[[210,260],[210,280],[205,288],[215,288],[210,280]]}
    ]},
    { name: '蘋果', paths: [
        // body
        {pts:[[210,280],[185,275],[162,260],[148,238],[142,210],[148,182],[162,162],[180,150],[195,148],[205,155],[210,155],[215,155],[225,148],[240,150],[258,162],[272,182],[278,210],[272,238],[258,260],[235,275],[210,280]]},
        // stem
        {pts:[[210,155],[215,130],[220,118]]},
        // leaf
        {pts:[[220,125],[240,118],[252,125],[242,135],[225,130]]}
    ]},
    { name: '閃電', paths: [
        {pts:[[220,100],[175,200],[215,200],[170,320],[245,195],[205,195],[250,100],[220,100]]}
    ]}
];

function randomLineArt() {
    if (!stompClient || !currentRoomId) return;
    var art = lineArtTemplates[Math.floor(Math.random() * lineArtTemplates.length)];
    var color = '#333333';
    var width = 2;

    art.paths.forEach(function (path) {
        var pts = path.pts;
        for (var i = 0; i < pts.length - 1; i++) {
            stompClient.send("/app/canvas.draw", {}, JSON.stringify({
                roomId: currentRoomId,
                fromX: pts[i][0],
                fromY: pts[i][1],
                toX: pts[i + 1][0],
                toY: pts[i + 1][1],
                color: color,
                width: width
            }));
        }
    });
}

// ========== Canvas Snapshots ==========

var canvasSnapshots = [];
var previewSnapshotIndex = -1;

function saveCanvasSnapshot() {
    var canvas = document.getElementById('shared-canvas');
    if (!canvas) return;
    // Check if canvas is blank
    var ctx = canvas.getContext('2d');
    var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    var blank = true;
    for (var i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 0) { blank = false; break; }
    }
    if (blank) return;

    var dataUrl = canvas.toDataURL('image/png');
    stompClient.send("/app/canvas.saveSnapshot", {}, JSON.stringify({
        roomId: currentRoomId,
        dataUrl: dataUrl,
        time: new Date().toLocaleTimeString()
    }));
}

function renderSnapshotList() {
    var container = document.getElementById('canvas-snapshots');
    container.innerHTML = '';
    canvasSnapshots.forEach(function (snap, idx) {
        var wrapper = document.createElement('div');
        wrapper.className = 'snapshot-thumb';
        wrapper.title = '儲存於 ' + snap.time;
        wrapper.onclick = (function (i) {
            return function () { openCanvasPreview(i); };
        })(idx);

        var img = document.createElement('img');
        img.src = snap.dataUrl;

        var label = document.createElement('span');
        label.innerText = '#' + (idx + 1);

        var delBtn = document.createElement('button');
        delBtn.className = 'snapshot-delete-btn';
        delBtn.innerText = '✕';
        delBtn.title = '刪除';
        delBtn.onclick = (function (i) {
            return function (e) {
                e.stopPropagation();
                deleteSnapshot(i);
            };
        })(idx);

        wrapper.appendChild(img);
        wrapper.appendChild(label);
        wrapper.appendChild(delBtn);
        container.appendChild(wrapper);
    });
}

function deleteSnapshot(idx) {
    stompClient.send("/app/canvas.deleteSnapshot", {}, JSON.stringify({
        roomId: currentRoomId,
        index: idx
    }));
    if (previewSnapshotIndex === idx) {
        closeCanvasPreview();
    } else if (previewSnapshotIndex > idx) {
        previewSnapshotIndex--;
    }
}

function openCanvasPreview(idx) {
    previewSnapshotIndex = idx;
    var snap = canvasSnapshots[idx];
    document.getElementById('canvas-preview-img').src = snap.dataUrl;
    document.getElementById('canvas-preview-modal').style.display = 'flex';
}

function closeCanvasPreview() {
    document.getElementById('canvas-preview-modal').style.display = 'none';
    previewSnapshotIndex = -1;
}

function downloadSnapshot() {
    if (previewSnapshotIndex < 0) return;
    var snap = canvasSnapshots[previewSnapshotIndex];
    var a = document.createElement('a');
    a.href = snap.dataUrl;
    a.download = 'canvas_' + (previewSnapshotIndex + 1) + '_' + snap.time.replace(/:/g, '') + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function restoreSnapshot() {
    if (previewSnapshotIndex < 0) return;
    var snap = canvasSnapshots[previewSnapshotIndex];
    var canvas = document.getElementById('shared-canvas');
    var ctx = canvas.getContext('2d');
    var img = new Image();
    img.onload = function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
    img.src = snap.dataUrl;
    closeCanvasPreview();
}
