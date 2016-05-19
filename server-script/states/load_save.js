var main = require('main');
var server = require('server');
var sim = require('sim');
var utils = require('utils');
var content_manager = require('content_manager');
var _ = require('thirdparty/lodash');

var cleanup = [];

var saveFileName;
var saveSentinelFileName;
var loadTime;
var client_connected = false;
var armies_initialized = false;

var loaded_from_sandbox = false;
var view_replay = false;
var file_overrides = false;
var config;
var fileCheckTimeout;

/* expected for playing_shared */
var client_state = {
    armies: [],
    zone_radius: 0,
    ranked: false,
    control: {
        valid_time_range: {
            'min': -1,
            'max': -1
        }
    }
};
var playing = false;
var players = {};
var armies = [];
var diplomaticStates = {};

var memory_files_received = {
    /* client.id : bool */
}

/* mainly used for gw */
var replay_config;

var PLAYER_CONNECT_MINUTES = 10;

_.assign(module, require('states/playing_shared').import(module));

function playerMsg_heartbeat(msg) {
    var response = server.respond(msg);

    if (!memory_files_received[msg.client.id] && replay_config && replay_config.files) {
        msg.client.message({
            message_type: 'memory_files',
            payload: replay_config.files
        });
    }

    response.succeed();
}

function processReplayConfig (config) {

    if (!config || !config.files)
        return false;


    replay_config = config;

    file_overrides = true;

    var files = replay_config.files;
    var cookedFiles = _.mapValues(files, function(value) {
        if (typeof value !== 'string')
            return JSON.stringify(value);
        else
            return value;
    });
    file.mountMemoryFiles(cookedFiles);

    if (server.clients.length)
        server.broadcast({
            message_type: 'memory_files',
            payload: replay_config.files
        });

    return true;
}

function clientFilesAreReady() {
    if (!replay_config)
        return true;

    if (_.isEmpty(replay_config.files))
        return true;

    return _.every(server.clients, function (client) {
        return !!memory_files_received[client.id];
    });
}

function playerMsg_MemoryFilesReceived (msg) {
    memory_files_received[msg.client.id] = true;

    if (clientFilesAreReady())
        server.createSimFromReplay();
}

function tryToAdvanceState()
{
    if (!client_connected || !clientFilesAreReady() || !sim.ready || !armies_initialized)
        return;

    main.setState(main.states.playing, {
        players: players,
        armies: armies,
        diplomaticStates: diplomaticStates,
        armyDesc: client_state.armies,
        game_options: config.game.game_options,
        ranked: client_state.ranked,
        loaded_from_replay : true,
        loaded_from_sandbox: loaded_from_sandbox,
        view_replay: view_replay,
        file_overrides: file_overrides,
        valid_time_range: client_state.control.valid_time_range
    });
}

function fixConfigToUseCurrentClients(config) {
    var idToClientIndexMap = {};
    var used = 0;
    var usedClientIndex = {};
    var playerList = _.values(config.players);

    console.log('{{1}} fixConfigToUseCurrentClients');
    console.log(JSON.stringify(playerList));
    config.players = {};

    _.forEach(playerList, function (player) {
        if (player.ai)
            return;

        var clients = server.clients;
        if (clients.length > used) {
            var client = clients[used];
            var id = player.client ? player.client.id : -1;
            idToClientIndexMap[id] = used;
            usedClientIndex[used] = true;

            player.client = client;
            used = used + 1;

            console.log('{{2}} adding client to player with id: ' + id);
        }
     });

    _.forEach(playerList, function (player) {
        var id = player.client ? player.client.id : -1;
        config.players[id] = player;
        console.log('{{3}} adding client to player with id: ' + id);
    });

    _.forEach(config.armies, function (army, index) {
        _.forEach(army.slots, function (slot) {
            if (slot.ai)
                return;

            var id = slot.client ? slot.client.id : -1;
            var index = idToClientIndexMap[id];
            var client = server.clients[index];
            if (client) {
                console.log('{{4}} adding client to slot which previously held id: ' + id);
                slot.client = client;
                delete usedClientIndex[index];
            }
            else
                console.log('{{4}} could not find client with index: ' + index);
        });
    });

    /* map unused clients to any empty slots. */
    if (!_.isEmpty(usedClientIndex)) {
        var pool = _.keys(usedClientIndex);

        _.forEach(config.armies, function (army, index) {
            _.forEach(army.slots, function (slot) {
                if (slot.ai)
                    return;

                var id = slot.client ? slot.client.id : -1;
                var index = idToClientIndexMap[id];
                var client = server.clients[index];
                if (!client) {
                    console.log('{{5}} could not find client with index: ' + index);
                    var target = pool.pop();
                    slot.client = server.clients[target];
                }
            });
        });
    }
}

function loadSave() {
     // Fully initialize server/sim
    console.log("Loading Save [", saveFileName, "]  [", saveTime, "]");
    var playing_data = server.loadSave(saveFileName, saveTime);
    console.log("Load Save complete.");
    if (playing_data.required_content)
        content_manager.setRequiredContent(playing_data.required_content);
    else
        content_manager.setContentPending(false);

    config = server.getGameConfig();

    var full = server.getFullReplayConfig();

    var wait = processReplayConfig(full.config);
    if (!wait && clientFilesAreReady())
        server.createSimFromReplay();

    tryToAdvanceState();
}

function tryGenerateArmies() {
    if (!client_connected || !sim.ready)
        return;

    if (!_.isEmpty(config)) {
        fixConfigToUseCurrentClients(config);
        initArmyState(config, true);
        updateArmyState(true);
    }
    else {
        loaded_from_sandbox = true;
        config = {
            game: {
                game_options: {
                    listen_to_spectators: true,
                    dynamic_alliance_victory: false
                }
            }
        };
    }
    armies_initialized = true;
}

exports.url = 'coui://ui/main/game/replay_loading/replay_loading.html';
exports.enter = function (save_file_info) {
    console.log('enter load_save state');
    content_manager.setContentPending(true);

    saveFileName = save_file_info.name;
    sentinelFileName = save_file_info.sentinel_name;
    saveTime = save_file_info.time;
    view_replay = save_file_info.view_replay;

    var shutdownTimeout = null;
    utils.pushCallback(server, 'onConnect', function (onConnect, client, reconnect) {
        if (shutdownTimeout !== null)
        {
            clearTimeout(shutdownTimeout);
            shutdownTimeout = null;
        }
        if (client.rejected)
        {
            console.log("Rejected connection from misconfigured client, and shutting down.");
            server.exit();
        }
        else
        {
            client_connected = true;

            if (replay_config && replay_config.files) {
                client.message({
                    message_type: 'memory_files',
                    payload: replay_config.files
                });
            }

            tryGenerateArmies();
            tryToAdvanceState();
        }
        return onConnect;
    });

    /* don't expect this to occur */
    utils.pushCallback(sim.planets, 'onReady', function (onReady) {
        return onReady;
    });
    cleanup.push(function () { sim.planets.onReady.pop(); });

    utils.pushCallback(sim, 'onReady', function (onReady) {

        /* sim.getValidTimeRange() won't return real date before the onReady callback */
        client_state.control.valid_time_range = sim.getValidTimeRange();

        if (!client_connected)
        {
            shutdownTimeout = _.delay(function() {
                sim.shutdown(true);
                server.exit();
            }, PLAYER_CONNECT_MINUTES * 60 * 1000)
        }

        tryGenerateArmies();
        tryToAdvanceState();
        return onReady;
    });

    cleanup.push(function () {
        server.onConnect.pop();
        sim.onReady.pop();
        clearTimeout(fileCheckTimeout)
    });

    var removeHandlers = server.setHandlers({
        heartbeat: playerMsg_heartbeat,
        memory_files_received: playerMsg_MemoryFilesReceived
    });
    cleanup.push(removeHandlers);

    var startWait = _.now();

    // check if the replay file is ready every 250 ms
    var maybeProcessSave = function () {
        console.log('Waiting for replay file');
        var ready = server.checkReplayReady(saveFileName, sentinelFileName);
        if (!ready) {
            fileCheckTimeout = setTimeout(maybeProcessSave, 250);
            return;
        }
        console.log('Replay file is ready. Time elapsed: ' + (_.now() - startWait) + 'ms');
        loadSave();
    };

    maybeProcessSave();

    server.maxClients = 1;
    if (main.serverName)
        server.beacon = {
            uuid: server.uuid(),
            full: false,
            started: false,
            players: 0,
            creator: null,
            max_players: 1,
            spectators: 0,
            max_spectators: 0,
            mode: 'Waiting',
            mod_names: [],
            cheat_config: main.cheats,
            player_names: [],
            spectator_names: [],
            require_password: false,
            whitelist: [],
            blacklist: [],
            tag: '',
            game_name: main.serverName,
            game: {
                name: main.serverName,
                bounty_mode: false,
                bounty_value: 0.5,
                sandbox: false
            },
            required_content: content_manager.getRequiredContent()
        };
    else
        server.beacon = undefined;

    return {};
};

exports.exit = function(newState) {
    _.forEachRight(cleanup, function(c) { c(); });
    cleanup = [];
    return true;
};
