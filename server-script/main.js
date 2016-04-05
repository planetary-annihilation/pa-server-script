var env = require('env');
var server_utils = require('server_utils');
var sim_utils = require('sim_utils');
var utils = require('utils');
var content_manager = require('content_manager');
var _ = require('thirdparty/lodash');

// Timeout values, in seconds.
var EMPTY_TIMEOUT = 120;

exports.MAX_PLAYERS = 10;
exports.MAX_SPECTATORS = 3;

var envMaxPlayersIndex = env.indexOf('--max-players');
if (envMaxPlayersIndex != -1) {
    exports.MAX_PLAYERS = parseInt(env[envMaxPlayersIndex+1]);
}
var envMaxSpectatorsIndex = env.indexOf('--max-spectators');
if (envMaxSpectatorsIndex != -1) {
    exports.MAX_SPECTATORS = parseInt(env[envMaxSpectatorsIndex+1]);
}

function shutdownWhenEmpty() {
    var emptyTimeout;
    utils.pushCallback(server, 'onConnect', function(onConnect, client, reconnect) {
        if (!client.rejected && emptyTimeout) {
            clearTimeout(emptyTimeout);
            emptyTimeout = undefined;
        }
        return onConnect;
    });
    setInterval(function() {
        var before = server.connected;
        server_utils.refreshConnectionCount();
        if (server.connected != before) {
            console.error('Whoa!  Connection count got out of sync!  Something went wrong somewhere.  (before=', before, ', after=', server.connected, ')');
        }
        if (!emptyTimeout && server.connected === 0) {
            emptyTimeout = setTimeout(function() {
                sim.shutdown(true);
                server.exit();
            }, EMPTY_TIMEOUT * 1000);
        }
    }, 1000);
}

function setState(newState) {
    console.log("Changing state from", curState.name, "to", newState.name);

    if (newState === curState)
        return;

    if (curState.exit && !curState.exit(newState))
    {
        console.log("Cancelling state change");

        return;
    }

    curState = newState;
    server.setGameState(curState.name);

    // Calling both of these APIs is primarily a matter of getting test coverage
    // One or the other can be removed as deemed necessary
    server.incrementTitleStatistic("State_" + curState.name, 1);
    server.recordGameEvent("State_" + curState.name);

    var result;
    if (newState.enter)
        result = newState.enter.apply(this, Array.prototype.slice.call(arguments).slice(1));
    if (curState !== newState)
        return; // This means entering the state caused another state change.
    if (result !== undefined)
        curState.hello_response.data = result;
    else
        delete curState.hello_response.data;
    var stateMessage = {
        message_type: 'server_state',
        payload: curState.hello_response
    };

    if (!curState.getClientState) {
        server.broadcast(stateMessage);
        return;
    }

    if (!stateMessage.payload.data)
        stateMessage.payload.data = {};
    var numClients = server.clients.length;
    for (var c = 0; c < numClients; ++c) {
        var client = server.clients[c];
        if (client.connected) {
            stateMessage.payload.data.client = curState.getClientState(client);
            client.message(stateMessage);
        }
    }
    delete stateMessage.payload.data.client;
}

function updateStateData(data)
{
    curState.hello_response.data = data;
}

var states = {};
var gameModes = {};

// Note: Game Modes must be exported before loading the states, since states
// register their game mode as part of loading.
exports.gameModes = gameModes;
exports.gameMode = '';

function addState(state, name) {
    if (states.hasOwnProperty(name))
        return state[name];
    state.name = name;
    state.hello_response = {
        state: name,
        url: state.url
    };
    states[name] = state;
    return state;
}

var cmdlineAllowCheats = (env.indexOf('--allow-cheats') >= 0);
exports.cheats = {
    cheat_flags: {
        allow_change_vision: cmdlineAllowCheats,
        allow_change_control: cmdlineAllowCheats,
        allow_create_unit: cmdlineAllowCheats,
        allow_mod_data_updates: cmdlineAllowCheats,

        any_enabled: cmdlineAllowCheats
    }
}

function loadState(name) {
    if (states.hasOwnProperty(name))
        return states[name];
    var state = require('states/' + name);
    if (state)
        addState(state, name);
    return state;
}

_.forEach([
        'empty',
        'config',
        'lobby',
        'landing',
        'playing',
        'game_over',
        'gw_lobby',
        'load_replay',
        'load_save',
        'replay',
        'ladder_lobby'
    ],
    loadState
);

var curState = states.empty;

server.handlers.hello = function(msg) {
    var helloMessage = curState.hello_response;
    var perClient = !!curState.getClientState;
    if (perClient) {
        helloMessage.data.client = curState.getClientState(msg.client);
    }
    server.respond(msg).succeed(helloMessage);
    if (perClient)
        delete helloMessage.data.client;
};

server_utils.debug_messages = env.indexOf('--squelch-messages') < 0;
server_utils.log_lobby_description = env.indexOf('--squelch-messages') < 0;
exports.keep_alive = env.indexOf('--keep-alive') >= 0;
var timeLimit = env.indexOf('--time-limit');
if (timeLimit >= 0) {
    exports.time_limit = Number(env[timeLimit + 1]);
    if (isNaN(exports.time_limit) || (exports.time_limit <= 0))
        delete exports.time_limit;
    else
        console.log("Time limit set to", exports.time_limit, "seconds.");
}
exports.no_players = env.indexOf('--no-players') >= 0;
var spectators = env.indexOf('--spectators');
if (spectators >= 0)
    exports.spectators = Number(env[spectators + 1]);
else
    exports.spectators = 0;

var gameModeIndex = env.indexOf('--game-mode');
if (gameModeIndex >= 0)
{
    var gameMode = env[gameModeIndex + 1];

    // Game mode can contain a content specification, in the form of
    // "content1,content2:gamemode". This is so that we can pass in
    // content requirements through UberNet.
    var contentSeparator = gameMode.indexOf(':');
    if (contentSeparator >= 0)
    {
        var content = gameMode.substr(0, contentSeparator).split(",");
        if (!_.isEmpty(content))
            content_manager.setRequiredContent(content);
        gameMode = gameMode.substr(contentSeparator + 1);
    }
    exports.gameMode = gameMode;
}

exports.setState = setState;
exports.updateStateData = updateStateData;
exports.states = states;
exports.loadState = loadState;
exports.shutdownWhenEmpty = shutdownWhenEmpty;
exports.setStateUrl = function(state, url) {
    state.hello_response.url = url;
};

var serverNameIndex = env.indexOf('--server-name');
if (serverNameIndex >= 0)
    exports.serverName = env[serverNameIndex + 1];

var stateIndex = env.indexOf('--state');
if (stateIndex >= 0) {
    var initialStateName = env[stateIndex + 1];
    var initialState = loadState(initialStateName);
    if (initialState)
        curState = initialState;
    else
        console.error("Unable to load state", initialStateName);
}

var initialStateEnterData = undefined;
var loadReplayIndex = env.indexOf('--load-replay');
var loadTimeIndex = env.indexOf('--load-time'); /* todo: specify load time with message instead of parameter */
if (loadReplayIndex >= 0) {

    var path = env[loadReplayIndex + 1];
    var split_index = path.lastIndexOf('#t=');
    var replayFileName = (split_index === -1) ? path : path.substr(0, split_index);
    var loadTime = loadTimeIndex >= 0 ? env[loadTimeIndex + 1] : -1;
    if (split_index !== -1)
        loadTime = Number(path.substr(split_index+3));
    if (_.isNaN(loadTime))
        loadTime = -1;

    loadTime = -1; /* server crashes if the load time is not -1. */

    var replaySentinelFileName = '';
    var replaySentinelFileNameIndex = env.indexOf('--load-replay-sentinel');
    if (replaySentinelFileNameIndex >= 0)
        replaySentinelFileName = env[replaySentinelFileNameIndex + 1];

    initialStateEnterData = {
        'name': replayFileName,
        'sentinel_name': replaySentinelFileName,
        'time': loadTime,
        'view_replay': exports.gameMode !== 'loadsave'
    };

    /* this is a little hacky */
    curState = states.load_save;
}

// Make sure our current state gets initialized.
var enter_result = curState.enter(initialStateEnterData);
if (enter_result)
    updateStateData(enter_result);

