var main = require('main');
var server = require('server');
var sim = require('sim');
var utils = require('utils');
var _ = require('thirdparty/lodash');

var replay_file_info;

var cleanup = [];

var playing = false;
var players = {};
var armies = [];
var diplomaticStates = {};

function playerMsg_changeVisionFlags(msg) {
    var flags = msg.payload.vision_flags;
    if (flags)
        sim.armies.setVisionBits(msg.client, flags);
}


exports.url = 'coui://ui/main/game/live_game/live_game.html';
exports.enter = function (data, info) {

    replay_data = data.replay_data;
    replay_file_info = info;

    utils.pushCallback(server, 'onConnect', function (onConnect, client, reconnect) {

        client.giveFullVision();

        if (!main.keep_alive) {
            setInterval(function () {
                if (!server.connected) {
                    server.exit();
                }
            }, 1000);
        }

        return onConnect;
    });
    cleanup.push(function () {
        server.onConnect.pop();
    });

    var removeHandlers = server.setHandlers({
        change_vision_flags: playerMsg_changeVisionFlags
    });
    cleanup.push(removeHandlers);

    return data;
};

exports.exit = function(newState) {
    _.forEachRight(cleanup, function(c) { c(); });
    cleanup = [];
    return true;
};
