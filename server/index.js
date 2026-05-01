var process = require('process')
// Handle SIGINT
process.on('SIGINT', () => {
  console.info("SIGINT Received, exiting...")
  process.exit(0)
})

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.info("SIGTERM Received, exiting...")
  process.exit(0)
})

const parser = require('ua-parser-js');
const { uniqueNamesGenerator, animals, colors } = require('unique-names-generator');

class SnapdropServer {

    constructor(port) {
        const express = require('express');
        const http = require('http');
        const path = require('path');
        const WebSocket = require('ws');
        
        const app = express();
        const server = http.createServer(app);
        
        // Serve static files from client directory
        app.use(express.static(path.join(__dirname, '../client')));

        this._wss = new WebSocket.Server({ server });
        this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
        this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

        this._rooms = {};
        this._peerRooms = {};
        this._peerCodes = {};
        this._peerNames = {};

        server.listen(port, () => {
            console.log('Santhushare is running on port', port);
        });
    }

    _onConnection(peer) {
        // Restore previous room and pairing code if the peer is reconnecting
        if (this._peerRooms[peer.id]) {
            peer.ip = this._peerRooms[peer.id];
        }
        if (this._peerCodes[peer.id]) {
            peer.pairingCode = this._peerCodes[peer.id];
        } else {
            this._peerCodes[peer.id] = peer.pairingCode;
        }
        if (this._peerNames[peer.id]) {
            peer.name.displayName = this._peerNames[peer.id];
        } else {
            this._peerNames[peer.id] = peer.name.displayName;
        }

        this._joinRoom(peer);
        peer.socket.on('message', message => this._onMessage(peer, message));
        peer.socket.on('error', console.error);
        peer.socket.on('close', () => this._leaveRoom(peer));
        this._keepAlive(peer);

        // send displayName and pairingCode
        this._send(peer, {
            type: 'display-name',
            message: {
                displayName: peer.name.displayName,
                deviceName: peer.name.deviceName,
                pairingCode: peer.pairingCode
            }
        });
    }

    _onHeaders(headers, response) {
        if (response.headers.cookie && response.headers.cookie.indexOf('peerid=') > -1) return;
        response.peerId = Peer.uuid();
        headers.push('Set-Cookie: peerid=' + response.peerId + "; SameSite=Strict; Secure");
    }

    _onMessage(sender, message) {
        // Try to parse message 
        try {
            message = JSON.parse(message);
        } catch (e) {
            return; // TODO: handle malformed JSON
        }

        switch (message.type) {
            case 'disconnect':
                this._leaveRoom(sender);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
            case 'update-name':
                if (message.name && message.name.length < 40) {
                    sender.name.displayName = message.name;
                    this._peerNames[sender.id] = message.name; // Save the updated name
                    this._send(sender, {
                        type: 'display-name',
                        message: sender.getInfo().name
                    });
                    
                    for (const otherPeerId in this._rooms[sender.ip]) {
                        if (otherPeerId === sender.id) continue;
                        const otherPeer = this._rooms[sender.ip][otherPeerId];
                        this._send(otherPeer, {
                            type: 'peer-updated',
                            peer: sender.getInfo()
                        });
                    }
                }
                break;
            case 'pair-with-code':
                if (message.code) {
                    let targetPeer = null;
                    // Find the peer with the matching pairing code
                    for (const room in this._rooms) {
                        for (const peerId in this._rooms[room]) {
                            if (this._rooms[room][peerId].pairingCode === message.code) {
                                targetPeer = this._rooms[room][peerId];
                                break;
                            }
                        }
                        if (targetPeer) break;
                    }
                    
                    if (targetPeer && targetPeer.id !== sender.id) {
                        // Create a new private room
                        const newRoom = 'pair-' + sender.pairingCode + '-' + targetPeer.pairingCode;
                        
                        // Leave current rooms
                        this._leaveRoom(sender);
                        this._leaveRoom(targetPeer);
                        
                        // Assign new room
                        sender.ip = newRoom;
                        targetPeer.ip = newRoom;
                        
                        // Remember the pairing so reconnects don't break it
                        this._peerRooms[sender.id] = newRoom;
                        this._peerRooms[targetPeer.id] = newRoom;
                        
                        // Join new room
                        this._joinRoom(sender);
                        this._joinRoom(targetPeer);
                        
                        console.log(`[Discovery] Peer ${sender.id} paired with ${targetPeer.id} via code ${message.code}. Room: ${newRoom}`);
                    } else {
                        this._send(sender, { type: 'pair-error', error: 'Code not found or invalid' });
                    }
                }
                break;
            case 'join-room':
                if (message.room) {
                    this._leaveRoom(sender);
                    sender.ip = 'room-' + message.room;
                    this._joinRoom(sender);
                    console.log(`[Discovery] Peer manually joined room: ${sender.ip}`);
                }
                break;
        }

        // relay message to recipient
        if (message.to && this._rooms[sender.ip]) {
            const recipientId = message.to; // TODO: sanitize
            const recipient = this._rooms[sender.ip][recipientId];
            delete message.to;
            // add sender id
            message.sender = sender.id;
            this._send(recipient, message);
            return;
        }
    }

    _joinRoom(peer) {
        // if room doesn't exist, create it
        if (!this._rooms[peer.ip]) {
            this._rooms[peer.ip] = {};
        }

        // notify all other peers
        for (const otherPeerId in this._rooms[peer.ip]) {
            const otherPeer = this._rooms[peer.ip][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // notify peer about the other peers
        const otherPeers = [];
        for (const otherPeerId in this._rooms[peer.ip]) {
            otherPeers.push(this._rooms[peer.ip][otherPeerId].getInfo());
        }

        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        // add peer to room
        this._rooms[peer.ip][peer.id] = peer;
        
        // ensure keepalive is running for the new room
        this._keepAlive(peer);
    }

    _leaveRoom(peer) {
        if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
        this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

        // delete the peer
        delete this._rooms[peer.ip][peer.id];

        peer.socket.terminate();
        //if room is empty, delete the room
        if (!Object.keys(this._rooms[peer.ip]).length) {
            delete this._rooms[peer.ip];
        } else {
            // notify all other peers
            for (const otherPeerId in this._rooms[peer.ip]) {
                const otherPeer = this._rooms[peer.ip][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
    }

    _send(peer, message) {
        if (!peer) return;
        if (peer.socket.readyState !== 1) return; // 1 is WebSocket.OPEN
        message = JSON.stringify(message);
        peer.socket.send(message, error => '');
    }

    _keepAlive(peer) {
        this._cancelKeepAlive(peer);
        var timeout = 30000;
        if (!peer.lastBeat) {
            peer.lastBeat = Date.now();
        }
        if (Date.now() - peer.lastBeat > 2 * timeout) {
            this._leaveRoom(peer);
            return;
        }

        this._send(peer, { type: 'ping' });

        peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
    }

    _cancelKeepAlive(peer) {
        if (peer && peer.timerId) {
            clearTimeout(peer.timerId);
        }
    }
}



class Peer {

    constructor(socket, request) {
        // set socket
        this.socket = socket;

        // set peer id
        this._setPeerId(request)
        
        // completely isolate every new connection
        this.ip = 'isolated-' + this.id;

        // is WebRTC supported ?
        this.rtcSupported = request.url.indexOf('webrtc') > -1;
        // set name 
        this._setName(request);
        // generate unique 5-digit pairing code
        this.pairingCode = Math.floor(10000 + Math.random() * 90000).toString();
        // for keepalive
        this.timerId = 0;
        this.lastBeat = Date.now();
    }

    _setPeerId(request) {
        if (request.peerId) {
            this.id = request.peerId;
        } else {
            this.id = request.headers.cookie.replace('peerid=', '');
        }
    }

    toString() {
        return `<Peer id=${this.id} ip=${this.ip} rtcSupported=${this.rtcSupported}>`
    }

    _setName(req) {
        let ua = parser(req.headers['user-agent']);


        let deviceName = '';
        
        if (ua.os && ua.os.name) {
            deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
        }
        
        if (ua.device.model) {
            deviceName += ua.device.model;
        } else {
            deviceName += ua.browser.name;
        }

        if(!deviceName)
            deviceName = 'Unknown Device';

        const displayName = uniqueNamesGenerator({
            length: 2,
            separator: ' ',
            dictionaries: [colors, animals],
            style: 'capital',
            seed: this.id.hashCode()
        })

        this.name = {
            model: ua.device.model,
            os: ua.os.name,
            browser: ua.browser.name,
            type: ua.device.type,
            deviceName,
            displayName
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported
        }
    }

    // return uuid of form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    static uuid() {
        let uuid = '',
            ii;
        for (ii = 0; ii < 32; ii += 1) {
            switch (ii) {
                case 8:
                case 20:
                    uuid += '-';
                    uuid += (Math.random() * 16 | 0).toString(16);
                    break;
                case 12:
                    uuid += '-';
                    uuid += '4';
                    break;
                case 16:
                    uuid += '-';
                    uuid += (Math.random() * 4 | 8).toString(16);
                    break;
                default:
                    uuid += (Math.random() * 16 | 0).toString(16);
            }
        }
        return uuid;
    };
}

Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    var hash = 0, i, chr;
    for (i = 0; i < this.length; i++) {
      chr   = this.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }
});

const server = new SnapdropServer(process.env.PORT || 3000);
