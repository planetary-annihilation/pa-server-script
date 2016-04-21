var main = require('main');
var utils = require('utils');
var content_manager = require('content_manager');
var _ = require('thirdparty/lodash');

var cleanup = [];

var MAX_PLAYERS = main.MAX_PLAYERS;
var MAX_SPECTATORS = main.MAX_SPECTATORS;
var SERVER_PASSWORD = main.SERVER_PASSWORD;

var EMPTY_TIMEOUT = 5 * 60;

exports.url = '';
exports.enter = function() {

    if (main.no_players) {
        main.setState(main.states.config);
        return;
    }

    var modNames = [];
    var mods = server.getMods();
    if (mods !== undefined && mods.mounted_mods !== undefined) {
        _.forEach(mods.mounted_mods, function (element) {
            modNames.push(element.display_name);
        });
    }

    server.maxClients = 1;
    if (main.serverName)
        server.beacon = {
            uuid: server.uuid(),
            full: false,
            started: false,
            players: 0,
            creator: null,
            max_players: MAX_PLAYERS,
            spectators: 0,
            max_spectators: MAX_SPECTATORS,
            mode: 'Waiting',
            mod_names: modNames,
            cheat_config: main.cheats,
            player_names: [],
            spectator_names: [],
            require_password: !! SERVER_PASSWORD,
            whitelist: [],
            blacklist: [],
            tag: '',
            game_name: main.serverName,
            game: {
                name: main.serverName
            },
            required_content: content_manager.getRequiredContent(),
            bounty_mode: false,
            bounty_value: 0.5,
            sandbox: false
        };
    else
        server.beacon = undefined;

    utils.pushCallback(server, 'onConnect', function(onConnect, client, reconnect) {
        if (client.rejected)
        {
            console.log("Rejected connection from misconfigured client, and shutting down.");
            server.exit();
        }
        else
            main.setState(main.gameModes[main.gameMode] || main.states.lobby, client);
        return onConnect;
    });
    cleanup.push(function() { server.onConnect.pop(); });

    if (!main.keep_alive) {
        var timeout = setTimeout(function() { server.exit(); }, EMPTY_TIMEOUT * 1000);
        cleanup.push(function() { clearTimeout(timeout); });
    }
};

exports.exit = function(newState) {
    _.forEachRight(cleanup, function(c) { c(); });
    cleanup = [];

    if (server.clients.length && !main.keep_alive)
        main.shutdownWhenEmpty();

    return true;
};
