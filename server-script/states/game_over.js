var main = require('main');
var _ = require('thirdparty/lodash');
var chat_utils = require('chat_utils');
var content_manager = require('content_manager');

var REPLAY_FILENAME = main.REPLAY_FILENAME;

// Timeout values, in seconds.
var PAUSE_TIMEOUT = 30;
var REPLAY_TIMEOUT = main.REPLAY_TIMEOUT;

var winners = {};
var losers = {};

var cleanup = [];

var markComplete = _.once(function(w, l, t) { server.markLadderGameComplete(w, l, t); });

// stored data from playing state. needed if we rewinded back to the playing state.
var players = {};
var armies = [];
var game_options = {};
var diplomaticStates = {};
var client_state;

function playerMsg_surrender(msg) {
    return server.respond(msg).fail("Game has already ended");
}

function playerMsg_trim_history_and_restart(msg) {

    var allow = (server.clients.length === 1) || !!game_options.sandbox;
    if (!allow)
        return;

    var reject = main.gameMode === "Ladder1v1";
    if (reject)
        return;

    var time = Number(msg.payload.time);
    if (!time || time < 0)
        return;

    main.setState(main.states.playing, {
        players: players,
        armies: armies,
        diplomaticStates: diplomaticStates,
        armyDesc: client_state.armies,
        game_options: game_options,
        ranked: client_state.ranked,
        restart: true,
        restartTime: time /* in seconds */,
        valid_time_range: { min: client_state.control.valid_time_range.min, max: -1 }
    });
}

function playerMsg_controlSim(msg) {
    var response = server.respond(msg);

    var desc = msg.payload;
    if (desc.hasOwnProperty('paused')) {
        sim.paused = !!desc.paused;

        server.broadcast({
            message_type: 'control_state',
            payload: {
                paused: !!desc.paused
            }
        });
        sim.paused = !!desc.paused;
    }

    response.succeed();
}

 var playerMsg_writeReplay = function (msg) {
    var allow_save = (server.clients.length === 1) || !!game_options.sandbox;

    if (allow_save && msg.payload.name) 
        server.writeReplay(msg.payload.name, 'replay');
};

exports.url = 'coui://ui/main/game/game_over/game_over.html';
exports.enter = function (game_over_data) {
    var GAMEOVER_SHUTDOWN_TIMEOUT = 3600;

    var writeReplay = _.once(function() {
        if (REPLAY_FILENAME) {
            server.writeReplay(REPLAY_FILENAME, 'replay');
        } else {
            server.writeReplay();
        }
    });

    _.delay(function () {
        sim.paused = true;
    }, PAUSE_TIMEOUT * 1000);


    if (main.keep_alive) {
        setTimeout( function() {
            writeReplay();
        }, REPLAY_TIMEOUT * 1000 ); 
    } else {

        var timeouts = {
            replayTimeout: null,
            tenMinuteMark: null,
            forceShutdown: null,
            connectionPolling: null
        }

        timeouts.replayTimeout = setTimeout(function () {
            writeReplay();
        }, REPLAY_TIMEOUT * 1000);

        console.log("The server will shut down in " + GAMEOVER_SHUTDOWN_TIMEOUT / 60 + " minutes.");
        timeouts.tenMinuteMark = setTimeout(function () {
            writeReplay();
            server.incrementTitleStatistic("LobbyStillUp10MinsAfterGameOver", 1);
        }, 600 * 1000);

        timeouts.forceShutdown = setTimeout(function () {
            server.incrementTitleStatistic("ForcedServerShutdown", 1);
            _.delay(function () {
                console.log("Game over timeout reached. Server shutting down.");
                writeReplay();
                server.exit();
            }, 10 * 1000);
        }, GAMEOVER_SHUTDOWN_TIMEOUT * 1000);

        timeouts.connectionPolling = setInterval(function () {
            if (!server.connected) {
                writeReplay();
                sim.onShutdown = server.exit;
                sim.shutdown(true);
            }
        }, 1000);

        cleanup.push(function () {
            clearTimeout(timeouts.replayTimeout);
            clearTimeout(timeouts.tenMinuteMark);
            clearTimeout(timeouts.forceShutdown);
            clearInterval(timeouts.connectionPolling);
        });
    }

    function foreach_client_in_army(army_list, f) {
        _.forEach(army_list, function(army) {
            _.forEach(army.players, function(player) {
                f(player.client);
            });
        });
    };

    winners = {};
    var winner_clients = [];
    foreach_client_in_army(game_over_data.winners, function (client) {
        winners[client.id] = true;
        winner_clients.push(client);
    });

    losers = {};
    var loser_clients = [];
    foreach_client_in_army(game_over_data.losers, function (client) {
        losers[client.id] = true;
        loser_clients.push(client);
    });

    if (main.gameMode === "Ladder1v1")
    {
        console.log("Ladder game, marking as complete (" + winner_clients.length + " winner(s), " + loser_clients.length + " loser(s))");
        server.onLadderGameMarkedComplete = function(success) {
            console.log("Ratings updated on server, notifying clients to refresh.");
            server.broadcast({
                message_type: 'rating_updated',
                payload: {
                    'success': success,
                    'game_type': content_manager.getMatchmakingType(),
                }
            });
        };
        if (winner_clients.length + loser_clients.length > 0)
            markComplete(winner_clients, loser_clients, content_manager.getMatchmakingType());
    }

    var transientHandlers = {
        surrender: playerMsg_surrender,
        trim_history_and_restart: playerMsg_trim_history_and_restart,
        control_sim: playerMsg_controlSim,
        write_replay: playerMsg_writeReplay
    };
    _.assign(transientHandlers, chat_utils.getChatHandlers(game_over_data.players, { listen_to_spectators: true, ignore_defeated_state: true }));
    cleanup.push(server.setHandlers(transientHandlers));

    players = game_over_data.players;
    armies = game_over_data.armies;
    game_options = game_over_data.game_options;
    diplomaticStates = game_over_data.diplomaticStates;
    client_state = game_over_data.client_state;

    return game_over_data.client_state;
};

exports.exit = function(newState) {
    _.forEachRight(cleanup, function(c) { c(); });
    cleanup = [];
    return true;
};

exports.getClientState = function(client) {
    if (winners[client.id])
        return { winner: true };
    else if (losers[client.id])
        return { loser: true };
    else
        return {};
};
