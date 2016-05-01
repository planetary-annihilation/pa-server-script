var _ = require('thirdparty/lodash');
var utils = require('utils');

server.respond = function(msg) {
    var result = function() {
        if (!msg.response_key)
        {
            return {
                succeed: function() {},
                fail: function() {}
            };
        }

        var response = {
            message_type: 'response',
            payload: {
                key: msg.response_key
            }
        };
        var client = msg.client;

        return {
            succeed: function(result) {
                response.payload.status = 'success';
                response.payload.result = result;
                if (exports.debug_messages)
                    console.log("Responding to client", client.name, ":", JSON.stringify(response));

                client.message(response);
            },
            fail: function(desc) {
                response.payload.status = 'error';
                response.payload.result = desc;
                client.message(response);
            }
        };
    }();

    if (!exports.debug_messages)
        return result;

    var actualFail = result.fail;
    result.fail = function(reason) {
        console.log("Sending failed response to message", msg.message_type, "from client", msg.client.name, "-", reason);
        return actualFail.apply(this, arguments);
    };

    return result;
};

server.broadcast = function(msg) {
    var numClients = server.clients.length;

    if (exports.debug_messages)
        console.log("Broadcast message to", server.connected, "clients:", JSON.stringify(msg));

    for (var c = 0; c < numClients; ++c)
    {
        if (server.clients[c].connected)
            server.clients[c].message(msg);
    }
};

server.broadcastEventMessage = function(target, msg, type) {
    var payload = {
        'target': target,
        'message': msg
    }

    if (type)
        payload['type'] = type;

    server.broadcast({
        message_type: 'event_message',
        payload: payload
    });
};

server.broadcastCountdownEvent = function(seconds) {
    server.broadcast({
        message_type: 'event_message',
        payload: {
            'type': 'countdown',
            'message': seconds
        }
    });
};

server.connected = 0;

server.handlers = {};

function refreshConnectionCount() {
    server.connected = 0;
    _.forEach(server.clients, function(client) {
        server.connected += client.connected;
    });
}
refreshConnectionCount();
exports.refreshConnectionCount = refreshConnectionCount;

server.onConnect = function(newClient, reconnect) {
    refreshConnectionCount();
    console.log(reconnect ? "Returning" : "New", "client:", newClient.name, server.connected.toString() + "/" + server.clients.length.toString(), "clients connected");
    newClient.rejected = false;

    if (!reconnect) {
        newClient.onDisconnect = function() {
            refreshConnectionCount();
            console.log(newClient.name, "disconnected.", server.connected.toString() + "/" + server.clients.length.toString(), "clients remaining");
        };
        newClient.onDisconnect.pop = function() {};

        newClient.onMessage = function(msg) {
            if (exports.debug_messages)
                console.log("Message from client", newClient.name, ":", JSON.stringify(msg));

            var handler = server.handlers[msg.message_type];
            if (handler)
            {
                msg.client = newClient;
                handler(msg);
            }
        };
        newClient.onMessage.pop = function() {};
    }
};
server.onConnect.pop = function() {};

server.rejectClient = function(client, reason) {
    console.log("Rejecting client:", reason);
    client.message({
        message_type: 'access_denied',
        payload: reason
    });

    client.rejected = true;

    // Give them a moment to let the rejection sink in
    setTimeout(function() {
        client.kill();
    }, 0);
};

var closeReason;
server.closed = false;

server.close = function(reason) {
    closeReason = reason;
    if (server.closed)
        return;

    server.closed = true;

    var oldConnect = server.onConnect;
    var oldPop = server.onConnect.pop;
    server.onConnect = function(newClient, reconnect) {
        if (!reconnect)
        {
            return server.rejectClient(newClient, closeReason);
        }

        oldConnect(newClient, reconnect);
    };
    if (oldPop)
    {
        server.onConnect.pop = function() {
            oldPop();
            server.closed = false;
            server.close(closeReason);
        };
    }
};

server.setHandlers = function(handlers) {
    var oldHandlers = {};
    _.forEach(handlers, function(handler, key) {
        oldHandlers[key] = server.handlers[key];
        if (handler)
            server.handlers[key] = handler;
        else
            delete server.handlers[key];
    });
    return function() { server.setHandlers(oldHandlers); };
};

var uuid = utils.createUUIDString();

server.uuid = function () {
    return uuid;
};

server.getModsPayload = function() {
    var mods = server.getMods();

    if (mods && mods.mounted_mods) {
        mods = mods.mounted_mods;
    } else {
        mods = undefined;
    }
    return mods;
}

server.getModsForBeacon = function() {

    var names = [];
    var identifiers = [];
    var mods = server.getModsPayload();
    if (mods) {
        _.forEach(mods, function (mod) {
            names.push(mod.display_name);
            identifiers.push(mod.identifier);
        });
    }
    
    var result = { names: names, identifiers: identifiers };
    
    return result;
}