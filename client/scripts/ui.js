const $ = query => document.getElementById(query);
const $$ = query => document.body.querySelector(query);
const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
window.isDownloadSupported = (typeof document.createElement('a').download !== 'undefined');
window.isProductionEnvironment = !window.location.host.startsWith('localhost');
window.iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// set display name
let _me;

function setupDisplayName(me) {
    _me = me;
    const $displayName = document.getElementById('displayName') || document.querySelector('footer .font-subheading');
    if (!$displayName) return;
    
    const savedName = window.localStorage.getItem('santhushare-name');
    if (savedName && savedName !== _me.displayName) {
        Events.fire('update-name', savedName);
    }
    
    $displayName.textContent = 'You are known as ' + _me.displayName;
    $displayName.title = _me.deviceName;
    
    if (!$displayName.dataset.bound) {
        $displayName.style.cursor = 'pointer';
        $displayName.style.textDecoration = 'underline';
        $displayName.title = 'Click to change your name';
        $displayName.addEventListener('click', () => {
            Events.fire('show-name-dialog');
        });
        $displayName.dataset.bound = true;
    }
}

Events.on('display-name', e => {
    setupDisplayName(e.detail.message || e.detail);
});

class PeersUI {

    constructor() {
        Events.on('peer-joined', e => this._onPeerJoined(e.detail));
        Events.on('peer-updated', e => this._onPeerUpdated(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('file-progress', e => this._onFileProgress(e.detail));
        Events.on('paste', e => this._onPaste(e));
    }

    _onPeerJoined(peer) {
        if ($(peer.id)) return; // peer already exists
        const peerUI = new PeerUI(peer);
        $$('x-peers').appendChild(peerUI.$el);
        setTimeout(e => window.animateBackground(false), 1750); // Stop animation
    }

    _onPeerUpdated(peer) {
        const $peer = document.getElementById(peer.id);
        if ($peer) {
            if ($peer.ui) $peer.ui._peer = peer;
            const nameEl = $peer.querySelector('.name');
            if (nameEl) nameEl.textContent = peer.name.displayName;
            Events.fire('peer-name-changed', peer);
        }
    }

    _onPeers(peers) {
        this._clearPeers();
        peers.forEach(peer => this._onPeerJoined(peer));
    }

    _onPeerLeft(peerId) {
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.remove();
    }

    _onFileProgress(progress) {
        const peerId = progress.sender || progress.recipient;
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.ui.setProgress(progress.progress, progress.bytes, progress.total);
    }

    _clearPeers() {
        const $peers = $$('x-peers').innerHTML = '';
    }

    _onPaste(e) {
        const files = e.clipboardData.files || e.clipboardData.items
            .filter(i => i.type.indexOf('image') > -1)
            .map(i => i.getAsFile());
        const peers = document.querySelectorAll('x-peer');
        // send the pasted image content to the only peer if there is one
        // otherwise, select the peer somehow by notifying the client that
        // "image data has been pasted, click the client to which to send it"
        // not implemented
        if (files.length > 0 && peers.length === 1) {
            Events.fire('files-selected', {
                files: files,
                to: $$('x-peer').id
            });
        }
    }
}

class PeerUI {

    html() {
        return `
            <div style="position:relative;">
                <label class="column center" title="Click to send files">
                    <input type="file" multiple class="file-input">
                    <x-icon shadow="1">
                        <svg class="icon"><use xlink:href="#"/></svg>
                    </x-icon>
                    <div class="progress">
                      <div class="circle"></div>
                      <div class="circle right"></div>
                    </div>
                    <div class="name font-subheading"></div>
                    <div class="device-name font-body2"></div>
                    <div class="transfer-stats font-body2" style="font-size: 0.75rem; margin-top: 4px; display: none; color: var(--text-color-muted, #888);"></div>
                    <progress class="file-progress" max="1" value="0" style="display:none; width: 80%; margin-top: 8px; height: 6px; border-radius: 4px;"></progress>
                    <div class="status font-body2"></div>
                </label>
                <button class="chat-button icon-button" title="Open Chat" style="position: absolute; top: 35px; right: 0px; z-index: 10; cursor: pointer;">
                    <svg viewBox="0 0 24 24" style="width:24px; height:24px; fill:var(--text-color);"><use xlink:href="#chat"/></svg>
                </button>
            </div>`
    }

    constructor(peer) {
        this._peer = peer;
        this._initDom();
        this._bindListeners(this.$el);
    }

    _initDom() {
        const el = document.createElement('x-peer');
        el.id = this._peer.id;
        el.innerHTML = this.html();
        el.ui = this;
        el.querySelector('svg use').setAttribute('xlink:href', this._icon());
        el.querySelector('.name').textContent = this._displayName();
        el.querySelector('.device-name').textContent = this._deviceName();
        this.$el = el;
        this.$progress = el.querySelector('.progress');
        this.$fileProgress = el.querySelector('.file-progress');
        this.$transferStats = el.querySelector('.transfer-stats');
    }

    _bindListeners(el) {
        el.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', e => this._onFilesSelected(e));
        });
        el.querySelector('.chat-button').addEventListener('click', e => this._onChatClick(e));
        el.addEventListener('drop', e => this._onDrop(e));
        el.addEventListener('dragend', e => this._onDragEnd(e));
        el.addEventListener('dragleave', e => this._onDragEnd(e));
        el.addEventListener('dragover', e => this._onDragOver(e));
        el.addEventListener('touchstart', e => this._onTouchStart(e));
        el.addEventListener('touchend', e => this._onTouchEnd(e));
        // prevent browser's default file drop behavior
        Events.on('dragover', e => e.preventDefault());
        Events.on('drop', e => e.preventDefault());
    }

    _displayName() {
        return this._peer.name.displayName;
    }

    _deviceName() {
        return this._peer.name.deviceName;
    }

    _icon() {
        const device = this._peer.name.device || this._peer.name;
        if (device.type === 'mobile') {
            return '#phone-iphone';
        }
        if (device.type === 'tablet') {
            return '#tablet-mac';
        }
        return '#desktop-mac';
    }

    async _onFilesSelected(e) {
        const $input = e.target;
        const files = $input.files;
        
        if (files.length > 0 && $input.classList.contains('folder-input')) {
            this.$el.querySelector('.status').textContent = 'Zipping folder...';
            const zip = new JSZip();
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const path = file.webkitRelativePath || file.name;
                zip.file(path, file);
            }
            this.$el.querySelector('.status').textContent = 'Generating zip...';
            const blob = await zip.generateAsync({ type: 'blob' });
            blob.name = 'shared-folder.zip';
            Events.fire('files-selected', {
                files: [blob],
                to: this._peer.id
            });
            this.$el.querySelector('.status').textContent = '';
        } else if (files.length > 0) {
            Events.fire('files-selected', {
                files: files,
                to: this._peer.id
            });
        }
        $input.value = null; // reset input
    }

    setProgress(progress, bytes, total) {
        if (progress > 0 && progress < 1) {
            this.$el.setAttribute('transfer', '1');
            this.$fileProgress.style.display = 'block';
            this.$fileProgress.value = progress;
            
            if (bytes && total) {
                const now = Date.now();
                if (!this._transferStartTime) {
                    this._transferStartTime = now;
                    this._lastBytes = 0;
                    this._lastTime = now;
                    this._speedStats = [];
                    this.$transferStats.style.display = 'block';
                }
                
                const timeDiff = (now - this._lastTime) / 1000;
                if (timeDiff >= 0.5) { // update every 500ms
                    const bytesDiff = bytes - this._lastBytes;
                    let speed = bytesDiff / timeDiff; // bytes per second
                    
                    this._speedStats.push(speed);
                    if (this._speedStats.length > 5) this._speedStats.shift();
                    const avgSpeed = this._speedStats.reduce((a, b) => a + b, 0) / this._speedStats.length;
                    
                    this.$transferStats.textContent = this._formatSpeedAndRemaining(avgSpeed, total - bytes);
                    
                    this._lastTime = now;
                    this._lastBytes = bytes;
                }
            }
        } else if (progress === 0 && this.$el.hasAttribute('transfer')) {
            // handle the end of transfer
            this.$fileProgress.style.display = 'none';
            this.$fileProgress.value = 0;
            this.$el.removeAttribute('transfer');
            if (this.$transferStats) {
                this.$transferStats.style.display = 'none';
                this.$transferStats.textContent = '';
                this._transferStartTime = null;
            }
        } else if (progress >= 1) {
            this.$fileProgress.value = 1;
            if (this.$transferStats) {
                this.$transferStats.textContent = 'Processing...';
            }
            setTimeout(() => this.setProgress(0), 500); // clear UI after small delay
        }

        if (progress > 0.5) {
            this.$progress.classList.add('over50');
        } else {
            this.$progress.classList.remove('over50');
        }
        const degrees = `rotate(${360 * progress}deg)`;
        this.$progress.style.setProperty('--progress', degrees);
    }

    _formatSpeedAndRemaining(bytesPerSec, remainingBytes) {
        let speedStr = '';
        if (bytesPerSec >= 1e6) {
            speedStr = (bytesPerSec / 1e6).toFixed(1) + ' MB/s';
        } else if (bytesPerSec >= 1000) {
            speedStr = Math.round(bytesPerSec / 1000) + ' KB/s';
        } else {
            speedStr = Math.round(bytesPerSec) + ' B/s';
        }

        let timeStr = '';
        if (bytesPerSec > 0) {
            const seconds = Math.round(remainingBytes / bytesPerSec);
            if (seconds > 60) {
                timeStr = Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
            } else {
                timeStr = seconds + 's';
            }
        } else {
            timeStr = '...';
        }
        
        return `${speedStr} • ${timeStr} left`;
    }

    async _onDrop(e) {
        e.preventDefault();
        this._onDragEnd();
        
        const items = e.dataTransfer.items;
        if (!items || items.length === 0) return;
        
        let hasFolder = false;
        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
            if (entry && entry.isDirectory) {
                hasFolder = true;
                break;
            }
        }
        
        if (hasFolder) {
            this.$el.querySelector('.status').textContent = 'Zipping folder...';
            const zip = window.JSZip ? new JSZip() : null;
            if (!zip) return; // safeguard if JSZip failed to load
            
            const promises = [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
                if (entry) {
                    promises.push(this._traverseEntry(entry, zip, ""));
                }
            }
            await Promise.all(promises);
            this.$el.querySelector('.status').textContent = 'Generating zip...';
            const blob = await zip.generateAsync({ type: 'blob' });
            blob.name = 'shared-folder.zip';
            Events.fire('files-selected', {
                files: [blob],
                to: this._peer.id
            });
            this.$el.querySelector('.status').textContent = '';
        } else {
            const files = e.dataTransfer.files;
            Events.fire('files-selected', {
                files: files,
                to: this._peer.id
            });
        }
    }

    _traverseEntry(entry, zip, path) {
        return new Promise((resolve, reject) => {
            if (entry.isFile) {
                entry.file(file => {
                    zip.file(path + file.name, file);
                    resolve();
                }, reject);
            } else if (entry.isDirectory) {
                const dirReader = entry.createReader();
                dirReader.readEntries(async entries => {
                    const promises = [];
                    for (let i = 0; i < entries.length; i++) {
                        promises.push(this._traverseEntry(entries[i], zip, path + entry.name + '/'));
                    }
                    await Promise.all(promises);
                    resolve();
                }, reject);
            }
        });
    }

    _onDragOver() {
        this.$el.setAttribute('drop', 1);
    }

    _onDragEnd() {
        this.$el.removeAttribute('drop');
    }

    _onChatClick(e) {
        e.preventDefault();
        Events.fire('open-chat', this._peer.id);
    }

    _onTouchStart(e) {
        // optionally keep touchstart for other purposes, but removing text-dialog right click equivalents
    }

    _onTouchEnd(e) {
        // removed long tap logic 
    }
}


class Dialog {
    constructor(id) {
        this.$el = $(id);
        this.$el.querySelectorAll('[close]').forEach(el => el.addEventListener('click', e => this.hide()))
        this.$autoFocus = this.$el.querySelector('[autofocus]');
    }

    show() {
        this.$el.setAttribute('show', 1);
        if (this.$autoFocus) this.$autoFocus.focus();
    }

    hide() {
        this.$el.removeAttribute('show');
        document.activeElement.blur();
        window.blur();
    }
}

class ReceiveDialog extends Dialog {

    constructor() {
        super('receiveDialog');
        Events.on('file-received', e => {
            this._nextFile(e.detail);
            window.blop.play();
        });
        this._filesQueue = [];
    }

    _nextFile(nextFile) {
        if (nextFile) this._filesQueue.push(nextFile);
        if (this._busy) return;
        this._busy = true;
        const file = this._filesQueue.shift();
        this._displayFile(file);
    }

    _dequeueFile() {
        if (!this._filesQueue.length) { // nothing to do
            this._busy = false;
            return;
        }
        // dequeue next file
        setTimeout(_ => {
            this._busy = false;
            this._nextFile();
        }, 300);
    }

    _displayFile(file) {
        const $a = this.$el.querySelector('#download');
        const url = URL.createObjectURL(file.blob);
        $a.href = url;
        $a.download = file.name;

        if(this._autoDownload()){
            $a.click()
            return
        }
        if(file.mime.split('/')[0] === 'image'){
            console.log('the file is image');
            this.$el.querySelector('.preview').style.visibility = 'inherit';
            this.$el.querySelector("#img-preview").src = url;
        }

        this.$el.querySelector('#fileName').textContent = file.name;
        this.$el.querySelector('#fileSize').textContent = this._formatFileSize(file.size);
        this.show();

        if (window.isDownloadSupported) return;
        // fallback for iOS
        $a.target = '_blank';
        const reader = new FileReader();
        reader.onload = e => $a.href = reader.result;
        reader.readAsDataURL(file.blob);
    }

    _formatFileSize(bytes) {
        if (bytes >= 1e9) {
            return (Math.round(bytes / 1e8) / 10) + ' GB';
        } else if (bytes >= 1e6) {
            return (Math.round(bytes / 1e5) / 10) + ' MB';
        } else if (bytes > 1000) {
            return Math.round(bytes / 1000) + ' KB';
        } else {
            return bytes + ' Bytes';
        }
    }

    hide() {
        this.$el.querySelector('.preview').style.visibility = 'hidden';
        this.$el.querySelector("#img-preview").src = "";
        super.hide();
        this._dequeueFile();
    }


    _autoDownload(){
        return !this.$el.querySelector('#autoDownload').checked
    }
}

class NameDialog extends Dialog {
    constructor() {
        super('nameDialog');
        this.$input = this.$el.querySelector('#nameInput');
        this.$saveBtn = this.$el.querySelector('#saveName');
        
        Events.on('show-name-dialog', e => this.show());
        
        this.$saveBtn.addEventListener('click', () => this._save());
        this.$input.addEventListener('keydown', e => {
            if (e.key === 'Enter') this._save();
        });
    }

    show() {
        if (_me && _me.displayName) {
            this.$input.value = _me.displayName;
        }
        super.show();
        setTimeout(() => this.$input.focus(), 100);
        setTimeout(() => this.$input.select(), 150);
    }

    _save() {
        const newName = this.$input.value;
        if (newName && newName.trim()) {
            const finalName = newName.trim();
            window.localStorage.setItem('santhushare-name', finalName);
            Events.fire('update-name', finalName);
            this.hide();
        }
    }
}


class ChatUI {
    constructor() {
        this.$el = document.getElementById('chatbox');
        this.$title = document.getElementById('chatbox-title');
        this.$messages = document.getElementById('chat-messages');
        this.$input = document.getElementById('chat-input');
        
        document.getElementById('chatbox-close').addEventListener('click', e => this.hide());
        document.getElementById('chat-form').addEventListener('submit', e => this._onSend(e));
        
        Events.on('text-received', e => this._onTextReceived(e.detail));
        Events.on('open-chat', e => this.show(e.detail));
        Events.on('peer-name-changed', e => this._onPeerNameChanged(e.detail));
        
        this._currentPeer = null;
        this._history = {};
    }
    
    show(peerId) {
        this._currentPeer = peerId;
        const $peer = document.getElementById(peerId);
        if ($peer && $peer.ui) {
            this.$title.textContent = 'Chat with ' + $peer.ui._displayName();
        }
        
        this.$el.classList.add('active');
        this._renderHistory();
        setTimeout(() => this.$input.focus(), 100);
    }
    
    hide() {
        this.$el.classList.remove('active');
        this._currentPeer = null;
    }
    
    _onPeerNameChanged(peer) {
        if (this._currentPeer === peer.id) {
            const h3 = this.$chatbox.querySelector('h3');
            if (h3) h3.textContent = peer.name.displayName;
        }
    }
    
    _onSend(e) {
        e.preventDefault();
        const text = this.$input.value.trim();
        if (!text || !this._currentPeer) return;
        
        Events.fire('send-text', {
            to: this._currentPeer,
            text: text
        });
        
        this._appendMessage(this._currentPeer, {text: text, sender: 'me'});
        this.$input.value = '';
    }
    
    _onTextReceived(detail) {
        const peerId = detail.sender;
        this._appendMessage(peerId, {text: detail.text, sender: peerId});
        
        if (this._currentPeer !== peerId) {
            const $peer = document.getElementById(peerId);
            if ($peer && $peer.ui) {
                 Events.fire('notify-user', 'New message from ' + $peer.ui._displayName());
            }
        }
        window.blop.play();
    }
    
    _appendMessage(peerId, message) {
        if (!this._history[peerId]) {
            this._history[peerId] = [];
        }
        this._history[peerId].push(message);
        
        if (this._currentPeer === peerId) {
            this._renderHistory();
        }
    }
    
    _renderHistory() {
        if (!this._currentPeer) return;
        
        this.$messages.innerHTML = '';
        const history = this._history[this._currentPeer] || [];
        
        for (let msg of history) {
            const msgEl = document.createElement('div');
            msgEl.className = 'chat-message ' + (msg.sender === 'me' ? 'me' : 'them');
            if (isURL(msg.text)) {
                const $a = document.createElement('a');
                $a.href = msg.text;
                $a.target = '_blank';
                $a.textContent = msg.text;
                msgEl.appendChild($a);
            } else {
                msgEl.textContent = msg.text;
            }
            this.$messages.appendChild(msgEl);
        }
        this.$messages.scrollTop = this.$messages.scrollHeight;
    }
}

class Toast extends Dialog {
    constructor() {
        super('toast');
        Events.on('notify-user', e => this._onNotfiy(e.detail));
    }

    _onNotfiy(message) {
        this.$el.textContent = message;
        this.show();
        setTimeout(_ => this.hide(), 3000);
    }
}


class Notifications {

    constructor() {
        // Check if the browser supports notifications
        if (!('Notification' in window)) return;

        // Check whether notification permissions have already been granted
        if (Notification.permission !== 'granted') {
            this.$button = $('notification');
            this.$button.removeAttribute('hidden');
            this.$button.addEventListener('click', e => this._requestPermission());
        }
        Events.on('text-received', e => this._messageNotification(e.detail.text));
        Events.on('file-received', e => this._downloadNotification(e.detail.name));
    }

    _requestPermission() {
        Notification.requestPermission(permission => {
            if (permission !== 'granted') {
                Events.fire('notify-user', Notifications.PERMISSION_ERROR || 'Error');
                return;
            }
            this._notify('Even more snappy sharing!');
            this.$button.setAttribute('hidden', 1);
        });
    }

    _notify(message, body) {
        const config = {
            body: body,
            icon: '/images/logo_transparent_128x128.png',
        }
        let notification;
        try {
            notification = new Notification(message, config);
        } catch (e) {
            // Android doesn't support "new Notification" if service worker is installed
            if (!serviceWorker || !serviceWorker.showNotification) return;
            notification = serviceWorker.showNotification(message, config);
        }

        // Notification is persistent on Android. We have to close it manually
        const visibilitychangeHandler = () => {                             
            if (document.visibilityState === 'visible') {    
                notification.close();
                Events.off('visibilitychange', visibilitychangeHandler);
            }                                                       
        };                                                                                
        Events.on('visibilitychange', visibilitychangeHandler);

        return notification;
    }

    _messageNotification(message) {
        if (document.visibilityState !== 'visible') {
            if (isURL(message)) {
                const notification = this._notify(message, 'Click to open link');
                this._bind(notification, e => window.open(message, '_blank', null, true));
            } else {
                const notification = this._notify(message, 'Click to copy text');
                this._bind(notification, e => this._copyText(message, notification));
            }
        }
    }

    _downloadNotification(message) {
        if (document.visibilityState !== 'visible') {
            const notification = this._notify(message, 'Click to download');
            if (!window.isDownloadSupported) return;
            this._bind(notification, e => this._download(notification));
        }
    }

    _download(notification) {
        document.querySelector('x-dialog [download]').click();
        notification.close();
    }

    _copyText(message, notification) {
        notification.close();
        if (!navigator.clipboard.writeText(message)) return;
        this._notify('Copied text to clipboard');
    }

    _bind(notification, handler) {
        if (notification.then) {
            notification.then(e => serviceWorker.getNotifications().then(notifications => {
                serviceWorker.addEventListener('notificationclick', handler);
            }));
        } else {
            notification.onclick = handler;
        }
    }
}


class NetworkStatusUI {

    constructor() {
        window.addEventListener('offline', e => this._showOfflineMessage(), false);
        window.addEventListener('online', e => this._showOnlineMessage(), false);
        if (!navigator.onLine) this._showOfflineMessage();
    }

    _showOfflineMessage() {
        Events.fire('notify-user', 'You are offline');
    }

    _showOnlineMessage() {
        Events.fire('notify-user', 'You are back online');
    }
}

class WebShareTargetUI {
    constructor() {
        const parsedUrl = new URL(window.location);
        const title = parsedUrl.searchParams.get('title');
        const text = parsedUrl.searchParams.get('text');
        const url = parsedUrl.searchParams.get('url');

        let shareTargetText = title ? title : '';
        shareTargetText += text ? shareTargetText ? ' ' + text : text : '';

        if(url) shareTargetText = url; // We share only the Link - no text. Because link-only text becomes clickable.

        if (!shareTargetText) return;
        window.shareTargetText = shareTargetText;
        history.pushState({}, 'URL Rewrite', '/');
        console.log('Shared Target Text:', '"' + shareTargetText + '"');
    }
}

class ThemeUI {
    constructor() {
        this.$button = document.getElementById('themeToggle');
        this.$icon = document.getElementById('themeIcon');
        
        // Restore theme from localStorage or system preference
        const savedTheme = localStorage.getItem('santhushare-theme');
        if (savedTheme) {
            this._setTheme(savedTheme);
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            this._setTheme('dark');
        } else {
            this._setTheme('light');
        }

        if (this.$button) {
            this.$button.addEventListener('click', e => this._toggle(e));
        }
    }

    _toggle(e) {
        e.preventDefault();
        const current = document.documentElement.getAttribute('theme');
        const next = current === 'dark' ? 'light' : 'dark';
        this._setTheme(next);
    }

    _setTheme(theme) {
        document.documentElement.setAttribute('theme', theme);
        localStorage.setItem('santhushare-theme', theme);
        if (this.$icon) {
            this.$icon.setAttribute('xlink:href', theme === 'dark' ? '#sun' : '#moon');
        }
    }
}


class Snapdrop {
    constructor() {
        const server = new ServerConnection();
        const peers = new PeersManager(server);
        const peersUI = new PeersUI();
        Events.on('load', e => {
            const receiveDialog = new ReceiveDialog();
            const nameDialog = new NameDialog();
            const chatUI = new ChatUI();
            const toast = new Toast();
            const notifications = new Notifications();
            const networkStatusUI = new NetworkStatusUI();
            const webShareTargetUI = new WebShareTargetUI();
            const themeUI = new ThemeUI();
        });
    }
}

const snapdrop = new Snapdrop();



if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(serviceWorker => {
            console.log('Service Worker registered');
            window.serviceWorker = serviceWorker
        });
}

window.addEventListener('beforeinstallprompt', e => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
        // don't display install banner when installed
        return e.preventDefault();
    } else {
        const btn = document.querySelector('#install')
        btn.hidden = false;
        btn.onclick = _ => e.prompt();
        return e.preventDefault();
    }
});

// Background Animation
Events.on('load', () => {
    let c = document.createElement('canvas');
    document.body.appendChild(c);
    let style = c.style;
    style.width = '100%';
    style.position = 'absolute';
    style.zIndex = -1;
    style.top = 0;
    style.left = 0;
    let ctx = c.getContext('2d');
    let x0, y0, w, h, dw;

    function init() {
        w = window.innerWidth;
        h = window.innerHeight;
        c.width = w;
        c.height = h;
        let offset = h > 380 ? 100 : 65;
        offset = h > 800 ? 116 : offset;
        x0 = w / 2;
        y0 = h - offset;
        dw = Math.max(w, h, 1000) / 13;
        drawCircles();
    }
    window.onresize = init;

    function drawCircle(radius) {
        ctx.beginPath();
        let color = Math.round(197 * (1 - radius / Math.max(w, h)));
        ctx.strokeStyle = 'rgba(' + color + ',' + color + ',' + color + ',0.1)';
        ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.lineWidth = 2;
    }

    let step = 0;

    function drawCircles() {
        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) {
            drawCircle(dw * i + step % dw);
        }
        step += 1;
    }

    let loading = true;

    function animate() {
        if (loading || step % dw < dw - 5) {
            requestAnimationFrame(function() {
                drawCircles();
                animate();
            });
        }
    }
    window.animateBackground = function(l) {
        loading = l;
        animate();
    };
    init();
    animate();
});

Notifications.PERMISSION_ERROR = `
Notifications permission has been blocked
as the user has dismissed the permission prompt several times.
This can be reset in Page Info
which can be accessed by clicking the lock icon next to the URL.`;

document.body.onclick = e => { // safari hack to fix audio
    document.body.onclick = null;
    if (!(/.*Version.*Safari.*/.test(navigator.userAgent))) return;
    blop.play();
}
