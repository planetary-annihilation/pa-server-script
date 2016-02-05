var main = require('main');
var server = require('server');
var sim = require('sim');
var utils = require('utils');
var simUtils = require('sim_utils');
var _ = require('thirdparty/lodash');
var Q = require('thirdparty/q');
var chat_utils = require('chat_utils');

_.assign(module, require('states/playing_shared').import(module));

// Timeout values, in seconds.
var TEAM_DISCONNECT_TIMEOUT = 600;
var RANKED_TEAM_DISCONNECT_TIMEOUT = 180;

var client_state = {
    armies: [],
    ranked: false,
    control: {
        paused: false,
        restart: false,
        view_replay: false,
        malformed: false,
        saving: false,
        valid_time_range: {
            'min': -1,
            'max': -1
        }
    }
};

var players = {};
var armies = [];
var game_options = {};
var diplomaticStates = {};

var cleanup = [];



var debugging = false;

function debug_log(object) {
    if (debugging)
        console.log(JSON.stringify(object, null, '\t'));
}

function isGalacticWar() {
    var result = game_options ? game_options.game_type === 'Galactic War' : false;
    return result;
}

function isAlly(army, targetArmy) {
    if (army === targetArmy)
        return true;

    var state = diplomaticStates[army.id][targetArmy.id].state;
    return state === "allied"
            || state === "allied_eco";
}

function isAI(army) {
    var result = army.sim.ai;
    return !!result
}

function spawnEffect(config) {
    var army = config.army && config.army.sim;
    var spec = config.spec;
    var planet = config.planet;
    var position = config.position;
    var orientation = config.orientation;
    var spawn = config.spawn;
    var retire = config.retire;

    var creationCheck = sim.effects.length;
    sim.effects.push({
        army: army,
        spec: spec,
        planet: planet,
        position: position,
        orientation: orientation,
        spawn: spawn,
        retire: retire
    });
    if (creationCheck !== sim.effects.length) {
        return _.last(sim.effects);
    }
    else
        console.error("Failed spawning effect", spec);
}

function selfDestructArmy(army) {
    if (client_state.ranked) {
        sim.paused = false;
        client_state.control.paused = sim.paused;
        updateControlState();
    }
    _.forEach(army.commanders, function (commander) { commander.dead = true; });
}

function checkArmySurrender(army) {
    var everyone_surrendered = army.players.length > 0 && _.every(army.players, function (player) {
        return player.has_surrendered;
    });

    if (everyone_surrendered) {
        var commanders_spawned = army.commanders.length > 0;
        if (commanders_spawned)
            selfDestructArmy(army);
    }
}

var updateArmyStateShared = updateArmyState;
var updateArmyState = function (transmit) {
    _.forEach(players, function (player) {
        if (player.client.connected) {
            if (player.army && !player.army.defeated)
                player.has_surrendered = false;
        }
    });

    updateArmyStateShared(transmit);

    _.forEach(armies, checkArmySurrender);
}

function updateControlState() {
    server.broadcast({
        message_type: 'control_state',
        payload: client_state.control
    });
}

function modifyControlState(delta) {
    _.assign(client_state.control, delta);
    updateControlState();
}

function checkControlState(key) {
    return !!client_state.control[key];
}

function defeatArmy(army, ally_defeat) {
    //update alliance
    if (game_options.dynamic_alliance_victory) {
        //make all dynamic alliance non mutable
        _.forEach(armies, function (target) {
            if (army != target && isAlly(army, target) && diplomaticStates[army.id][target.id].mutable) {
                updateDiplomaticState(army, target.id, 'allied');
                updateDiplomaticState(target, army.id, 'allied');
                diplomaticStates[army.id][target.id].mutable = false;
                diplomaticStates[target.id][army.id].mutable = false;
            }
        });
    }
    else {
        //break all mutable alliances
        _.forEach(armies, function (target) {
            if (army != target && isAlly(army, target) && diplomaticStates[army.id][target.id].mutable)
                updateDiplomaticState(army, target.id, 'hostile');
        });
    }

    var living_allies = [];
    if (!ally_defeat) {
        army.defeated = true;
        living_allies = _.filter(armies, function (target) {
            return isAlly(army, target) && !target.defeated;
        });
        if (_.isEmpty(living_allies)) {
            _.forEach(armies, function (target) {
                if (isAlly(army, target))
                    defeatArmy(target, true);
            });
        }
    }

    if (_.isEmpty(living_allies) || ally_defeat) {
        _.forEach(army.players, function (player) {
            delete player.army_id;
            sim.armies.setControlBits(player.client, false);
            sim.armies.setVisionBits(player.client, true);
            player.client.message({
                message_type: 'vision_bits',
                payload: sim.armies.getVisionBits(player.client)
            });;
        });
    }
    army.desc.defeated = true;
    army.sim.defeated = true;
    army.defeated = true;
    if (game_options.bounty_mode)
        army.sim.award_bounty_to_killer(game_options.bounty_value);
    updateArmyState(true);
}


function resurrectArmy(army) {
    var armyMask = Array(armies.length);
    for (var a = 0; a < armyMask.length; ++a)
        armyMask[a] = false;

    _.forEach(army.players, function (player) {
        player.has_surrendered = false;
        player.army_id = army.id;

        if (player.client) {
            var playerArmyIndex = player.army.index;
            armyMask[playerArmyIndex] = true;
            sim.armies.setControlBits(player.client, armyMask);
            sim.armies.setVisionBits(player.client, armyMask);
            armyMask[playerArmyIndex] = false;
            player.client.message({
                message_type: 'vision_bits',
                payload: sim.armies.getVisionBits(player.client)
            });

            player.client.message({
                message_type: 'resurrection',
                payload: { army_id: player.army_id }
            });
        }
    });

    army.desc.defeated = false;
    army.sim.defeated = false;
    army.defeated = false;
    updateArmyState(true);
}

function grantVictoryVisionForArmy(army) {
    _.forEach(army.players, function (player) {
        sim.armies.setVisionBits(player.client, true);
    });
}

function recordVictoryStats(army) {
    _.forEach(army.players, function (player) {
        player.client.incrementStatistic("GamesWon", 1);
    });
}

function executeToLoad(winners, losers) {
    var gameOverDesc = {};

    gameOverDesc.victor_players = [];
    gameOverDesc.victor_name = '';
    _.forEach(winners, function (winner) {
        gameOverDesc.victor_players = _.union(gameOverDesc.victor_players,
                                                _.map(winner.players, function (player) { return player.client.name; }));
        if (gameOverDesc.victor_name)
            gameOverDesc.victor_name += " ";
        gameOverDesc.victor_name += winner.desc.name;
        grantVictoryVisionForArmy(winner);
        recordVictoryStats(winner);

        _.forEach(winner.players, function (player) {
            player.client.message({ message_type: 'victory' });
        });
    });

    server.broadcast({
        message_type: 'victors',
        payload: gameOverDesc.victor_players
    });

    client_state.game_over = gameOverDesc;

    client_state.control.valid_time_range.max = sim.time;
    updateControlState();

    main.setState(main.states.game_over, {
        client_state: client_state,
        winners: winners,
        losers: losers,
        players: players,
        armies: armies,
        game_options: game_options,
        diplomaticStates: diplomaticStates
    });
}

function updateGameOverState(endGame) {
    if (client_state.game_over || checkControlState('restart'))
        return;

    var not_defeated = _.reject(armies, function (army) {
        return army.defeated
    });

    if (_.isEmpty(not_defeated)) {
        executeToLoad([], armies);
        return;
    }

    //check if surviving players are all in the same add hoc or premade alliance groups
    var group = [];
    var gameOver = true;
    var losers = [];
    _.forEach(armies, function (army) {
        if (army.defeated) {
            losers.push(army);
            return;
        }
        if (_.isEmpty(group))
            group.push(army);
        else {
            var isMember = true;
            _.forEach(group, function (target) {
                if (!isAlly(army, target))
                    isMember = false;
            });
            if (isMember)
                group.push(army);
            else {
                gameOver = false;
            }
        }
    });

    if (!gameOver && !endGame)
        return;

    var winners = [];
    //add all player (alive and dead) of an alliance group to winners
    _.forEach(armies, function (army) {
        var ally = true;
        _.forEach(group, function (member) {
            if (!isAlly(army, member))
                ally = false;
        });
        if (ally)
            winners.push(army);
    });

    executeToLoad(winners, losers);
}

function verifyArmyHasCommander(army) {
    var found = false;
    _.forEach(sim.units, function (unit) {
        if (unit.isUnitType("Commander")) {
            if (unit.army.index === army.index && !unit.dead) {
                found = true;
                return false; /* early out */
            }
        }
    });

    return found;
}

function refreshSpectators(army) {
    _.forEach(players, function (player) {
        if (player.army === army && player.client) {
            sim.armies.setControlBits(player.client, false);
            sim.armies.setVisionBits(player.client, true);
            player.client.message({
                message_type: 'vision_bits',
                payload: sim.armies.getVisionBits(player.client)
            });
        }
    });
}

function tickDefeatState(check_for_resurrection) {
    if (client_state.game_over)
        return;

    /* don't end the game if we are viewing a replay */
    if (checkControlState('view_replay'))
        return;

    _.forEach(armies, function (army) {

        if (!check_for_resurrection)
            if (army.defeated)
                return;

        var alive = _.some(army.commanders, function (commander) { return !commander.dead; });
        if (!alive) {
            if (isGalacticWar() && !isAI(army)) { /* in Galactic War, when the player is defeated we destroy all remaining subcommanders */
                console.log('player died, so delete all their allies.');
                var allies = _.filter(armies, function (target) {
                    return isAlly(army, target) && isAI(target) && !target.defeated;
                });

                _.forEach(allies, defeatArmy);
            }

            defeatArmy(army);
        }

        if (check_for_resurrection) {
            if (alive && verifyArmyHasCommander(army))
                resurrectArmy(army);
            else
                refreshSpectators(army);
        }
    });

    if (!check_for_resurrection)
        updateGameOverState(false);
}

function watchPlayerDisconnects() {
    function updateDisconnectPauseState() {
        var should_be_paused = _.any(armies, function (army) {
            if (_.all(army.players, function (player) { return player.has_surrendered; }))
                return false;
            return !!army.disconnectTimeout;
        });
        if (should_be_paused === sim.paused)
            return;

        /* always pause the game when someone disconnects, but don't automatically unpause unless they are playing ranked. */
        if (should_be_paused || (!should_be_paused && client_state.ranked)) {
            sim.paused = should_be_paused;
            client_state.control.paused = should_be_paused;
            updateControlState();
        }
    }

    function updateArmyDisconnect(army) {
        if (army.players.length === 0)
            return;

        var player_disconnected = _.any(army.players, function (player) {
            return !player.client.connected && !player.has_surrendered && player.army && !player.army.defeated;
        });
     
        if (player_disconnected && !army.disconnectTimeout) {
            var timeout = TEAM_DISCONNECT_TIMEOUT;
            if (client_state.ranked)
                timeout = army.rankedTimeoutRemaining;

            if (player_disconnected) {
                army.disconnectAt = _.now();
                army.disconnectTimeout = _.delay(function () {
                    var team_disconnected = _.every(army.players, function (player) {
                        return !player.client.connected && !player.has_surrendered && player.army && !player.army.defeated;
                    });
                    if (team_disconnected)
                        selfDestructArmy(army);
                }, timeout * 1000);
            }

            updateDisconnectPauseState();
        }
    }

    _.forEach(armies, updateArmyDisconnect);

    _.forEach(players, function (player) {
        utils.pushCallback(player.client, 'onDisconnect', function (onDisconnect) {
            updateConnectionState();
            server.broadcast({
                message_type: 'chat_message',
                payload: {
                    player_name: player.client.name,
                    message: '!LOC:__player__ has disconnected.',
                    type: 'server'
                }
            });

            updateArmyDisconnect(player.army);
            return onDisconnect;
        });
    });

    utils.pushCallback(server, 'onConnect', function (onConnect, client, reconnect) {

        updateConnectionState();
        server.broadcast({
            message_type: 'chat_message',
            payload: {
                player_name: client.name,
                message: '!LOC:__player__ has reconnected.',
                type: 'server'
            }
        });

        if (!reconnect)
            return onConnect;

        var player = players[client.id];
        if (!player)
            return onConnect;
        var army = player.army;
        if (!army)
            return onConnect;
        if (!army.disconnectTimeout)
            return onConnect;

        if (army.disconnectAt) {
            army.rankedTimeoutRemaining -= (_.now() - army.disconnectAt) / 1000;
            army.disconnectAt = null;
        }

        clearTimeout(army.disconnectTimeout);
        delete army.disconnectTimeout;

        updateDisconnectPauseState();

        return onConnect;
    });

    return function () {
        _.forEach(players, function (player) {
            if (player.client && player.client.onDisconnect)
                player.client.onDisconnect.pop();
        });
        server.onConnect.pop();
    };
}

function setPause(value) {
    if (sim.paused !== value) {
        sim.paused = value;
        client_state.control.paused = sim.paused;
        updateControlState();
    }
}

function playerMsg_controlSim(msg) {
    var response = server.respond(msg);

    var allow = (server.clients.length === 1) || !!game_options.sandbox;
    var reject = checkControlState('view_replay');

    var player = players[msg.client.id];
    if (player && player.army && !player.army.defeated)
        allow = true;

    if (!allow || reject)
        return response.fail("ControlSim not allowed");

    var desc = msg.payload;
    if (desc.hasOwnProperty('paused') && !client_state.ranked)
        setPause(!!desc.paused);

    response.succeed();
}

function playerMsg_surrender(msg) {
    var response = server.respond(msg);

    if (checkControlState('view_replay'))
        return response.fail("Surrender not allowed in when viewing a replay");

    var player = players[msg.client.id];
    if (!player)
        return response.fail("Player not found");

    if (player.has_surrendered)
        return response.fail("Player already surrendered");

    player.has_surrendered = true;
    checkArmySurrender(player.army);

    response.succeed();
}

function makeClientSpectator(client) {
    if (checkControlState('malformed')) {
        /* we don't have valid army/player data, so we can't use the sim.armies call. */
        client.setControlBits(false);
        client.setVisionBits(true);
    }
    else {
        sim.armies.setControlBits(client, false);
        sim.armies.setVisionBits(client, true);
    }
}

function makeAllPlayersSpectators() {
    _.forEach(server.clients, makeClientSpectator);
}

var ONE_SECOND = 1000; /* in ms */

var connnectionInterval = null;
function clearConnectionBasedExitCondition() {
    clearInterval(connnectionInterval);
}
function setupConnectionBasedExitCondition() {
    if (!main.keep_alive) {
        connnectionInterval = setInterval(function () {
            if (!server.connected) {
                console.log('no clients connected -> shutting down server.');
                server.exit();
            }
        }, ONE_SECOND);
        cleanup.push(clearConnectionBasedExitCondition);
    }
}

var defeatInterval = null;
function clearDefeatBasedExitCondition() {
    clearInterval(defeatInterval);
}
function setupDefeatBasedExitCondition() {
    defeatInterval = setInterval(tickDefeatState, ONE_SECOND);
    cleanup.push(clearDefeatBasedExitCondition);
}

var timeLimitTimeout = null;
function clearTimeLimitBasedExitCondition() {
    clearTimeout(timeLimitTimeout);
}
function setupTimeLimitBasedExitCondition() {
    timeLimitTimeout = setTimeout(function () {
        console.log('time limit expired -> shutting down server.');

        if (checkControlState('view_replay'))
            server.exit();
        else {
            var force_game_over = true;
            updateGameOverState(force_game_over);
        }

    }, main.time_limit * ONE_SECOND);
    cleanup.push(clearTimeLimitBasedExitCondition);
}

exports.url = 'coui://ui/main/game/live_game/live_game.html';
exports.enter = function (config) {
    var loaded_from_replay = !!config.loaded_from_replay;
    var loaded_from_sandbox = !!config.loaded_from_sandbox;
    var restart = !!config.restart;
    var malformed = !sim.armies.length || (config.view_replay && config.file_overrides);

    if (config.valid_time_range)
        client_state.control.valid_time_range = sim.getValidTimeRange();

    game_options = config.game_options;

    modifyControlState({ 'malformed': malformed });

    if (main.time_limit > 0)
        setupTimeLimitBasedExitCondition();

    if (config.view_replay) {
        makeAllPlayersSpectators();
        modifyControlState({ view_replay: true });
        setPause(true);
        setupConnectionBasedExitCondition();
    }

    var maybeSetupAsSpectator = function (client) {
        var player = players[client.id];
        var spectate = !player || checkControlState('view_replay');
        if (spectate) {
            makeClientSpectator(client);
        }
    };

    utils.pushCallback(server, 'onConnect', function (onConnect, client, reconnect) {
        maybeSetupAsSpectator(client);
    });
    cleanup.push(function () { server.onConnect.pop(); });

    client_state.ranked = config.ranked;
    client_state.armies = config.armyDesc || [];
    players = config.players || {};
    armies = config.armies;
    diplomaticStates = config.diplomaticStates || {};

    var transientHandlers = {
        control_sim: playerMsg_controlSim,
        surrender: playerMsg_surrender,
    };
    _.assign(transientHandlers, chat_utils.getChatHandlers(players, { listen_to_spectators: game_options.listen_to_spectators }));

    cleanup.push(server.setHandlers(transientHandlers));
    cleanup.push(server.setHandlers(playerMsg_handlers));

    if (!restart) {
        utils.pushCallback(sim, 'onReady', function (onReady) {
            modifyControlState({ restart: false });
            tickDefeatState(true /* check for army resurrection */);
            clearConnectionBasedExitCondition();
            return onReady;
        });
        cleanup.push(function () { sim.onReady.pop(); });
    }

    if (restart) {
        client_state.game_over = null;
        client_state.control.paused = true;
        setPause(true);
        modifyControlState({ restart: true });

        utils.pushCallback(sim, 'onReady', function (onReady) {
            tickDefeatState(true /* check for army resurrection */);
            updateArmyState(true);
            modifyControlState({ restart: false });
            setupDefeatBasedExitCondition();

            return onReady;
        });
        cleanup.push(function () { sim.onReady.pop(); });

        sim.shutdown(false, false);
        sim.onShutdown = function () {
            server.trimHistoryAndStartSim(config.restartTime /* in seconds */);
        };

        return client_state;
    }

    _.forEach(server.clients, maybeSetupAsSpectator);

    prepare_start_location_radius = 120;
    commander_spawn_delay = 5; // In seconds.

    var commandersDone;
    if (!loaded_from_replay) {
        var commandersWaiting = 0;
        commandersDone = Q.defer();
        var spawnCommander = function (config) {
            var now = sim.time;
            spawnEffect({
                planet: config.planet,
                position: config.position,
                army: config.army,
                spec: '/pa/effects/specs/default_commander_landing_ent.json',
                spawn: now,
                retire: now + 25
            });
            commandersWaiting = commandersWaiting + 1;
            return simUtils.waitForSeconds(commander_spawn_delay).then(function () {
                commandersWaiting = commandersWaiting - 1;
                if (!commandersWaiting) {
                    // Note: Delay is necessary because we want to resolve after the
                    // dependent promises have fired.
                    _.delay(function () { commandersDone.resolve(); });
                }
            });
        };

        _.forEach(armies, function (army) {
            army.rankedTimeoutRemaining = RANKED_TEAM_DISCONNECT_TIMEOUT;
            _.forEach(army.ai, function (ai) {
                var planet = sim.planets[ai.spawn.planet_index];
                spawnCommander({
                    army: army,
                    planet: planet,
                    position: ai.spawn.location
                }).then(function () {
                    sim.prepareStartLocation(ai.spawn.planet_index, army, ai.spawn.location, prepare_start_location_radius);
                    var commander = spawnUnit({
                        army: army,
                        spec: ai.commander,
                        planet: planet,
                        position: ai.spawn.location
                    });
                    if (commander)
                        army.commanders.push(commander);
                });
            });
        });

        _.forEach(players, function (player) {
            var planet = sim.planets[player.spawn.planet_index];
            player.army.players.push(player);
            spawnCommander({
                army: player.army,
                planet: planet,
                position: player.spawn.location
            }).then(function () {
                player.commander = spawnUnit({
                    army: player.army,
                    spec: player.commander,
                    planet: planet,
                    position: player.spawn.location
                });
                sim.prepareStartLocation(player.spawn.planet_index, player.army, player.spawn.location, prepare_start_location_radius);
                if (player.commander)
                    player.army.commanders.push(player.commander);
                player.client.message({
                    message_type: 'event_message',
                    payload: {
                        planet_index: player.spawn.planet_index,
                        location: player.spawn.location,
                        units: [player.commander.id],
                        type: 'commander_spawn'
                    }
                });
            });
            player.spawn.effect = _.last(sim.effects);
            if (player.spawn.effect) {
                player.client.message({
                    message_type: 'event_message',
                    payload: {
                        planet_index: player.spawn.planet_index,
                        location: player.spawn.location,
                        effect: player.spawn.effect.id,
                        type: 'start'
                    }
                });
            }
        });

        commandersDone.promise.then(function () {
            _.forEach(armies, function (army) {
                army.sim.finalizeEconomy();
            });

            sim.enableSave();
            /* enable save will init the min valid time. we could also just look at sim.time, but this way is more consistant */
            client_state.control.valid_time_range = sim.getValidTimeRange();
            updateControlState();

            setupDefeatBasedExitCondition();
        });
    }
    else /* loaded_from_replay === true */ {
        if (loaded_from_sandbox) {
            /* we are loading a sandbox game.
               this block of code will just make up whatever data is required.
               I don't really like this, but I don't want to spend any more time supporting save/load of
               sandbox games... so here it is. --wj
            */

            // Save/Load Fixup
            armies = [];
            _.forEach(sim.armies, function (army, index) {
                // This makes me very cranky.
                armies.push({
                    id: army.id,
                    sim: army,
                    defeated: army.defeated,
                    desc: {},    // I have no idea if this is actually needed or not
                    commanders: [],
                    players: []
                }
                );

                // For now all armies after the first are considered AI...
                if (index >= 1)
                    army.createAIBrain({});
            });

            for (var i = 0; i < sim.players.length; i++) {
                var sim_player = sim.players[i];
                console.log("Fixing up: [", sim_player.name, "]  army[", sim_player.army.id, "]");

                var local_player = {
                    name: sim_player.name,
                    army: armies[sim_player.army.index],
                    client: server.clients[i],
                    has_surrendered: false
                };
                players[sim_player.name] = local_player;

                armies[sim_player.army.index].players.push(local_player);

                // $$$FTS - VISION BITS TEST
                console.log('{{svb}} F');
                server.clients[i].setVisionBits([1, 1]);
                server.clients[i].setControlBits([1, 1]);
            }

            // Initialize diplomacy
            _.forEach(sim.armies, function (army_a) {
                var diplomacySet = {};
                _.forEach(sim.armies, function (army_b) {
                    if (army_a === army_b)
                        return;

                    var state = army_a.getDiplomaticState(army_b.id);
                    var mutable = (army_a.alliance_group === 0 || army_a.alliance_group !== army_b.alliance_group);
                    diplomacySet[army_b.id] = {
                        state: state,
                        allianceRequest: false,
                        mutable: mutable
                    };
                });
                diplomaticStates[army_a.id] = diplomacySet;
            });

            _.forEach(armies, function (army) {
                army.diplomaticState = diplomaticStates[army.id];
            });

            // Initialize army commanders
            _.forEach(sim.units, function (unit) {
                if (unit.isUnitType("Commander")) {
                    armies[unit.army.index].commanders.push(unit);

                    _.forEach(players, function (player) {
                        if (player.army === unit.army) {
                            console.log("$$$FTS Found player for commander!!");
                            player.commander = unit;
                        }
                    });
                }
            });

            // Set army data in client_state
            _.forEach(sim.armies, function (army) {
                client_state.armies.push({
                    "id": army.id,
                    "primary_color": army.primary_color,
                    "defeated": army.defeated,
                    "disconnected": false,
                    "landing": false,
                    "replay": false,
                    "ai": army.ai
                });
            });
        }

        if (!loaded_from_sandbox) {
            // todo: convert other humans players to ai
            _.forEach(armies, function (army) {
                var desc = army.desc;
                if (desc.ai)
                    army.sim.createAIBrain(desc.personality);
            });

            // Initialize army commanders
            _.forEach(sim.units, function (unit) {
                if (unit.isUnitType("Commander")) {
                    armies[unit.army.index].commanders.push(unit);

                    var found = false;

                    _.forEach(players, function (player) {
                        if (player.army === unit.army) {
                            found = true;
                            player.commander = unit;
                        }
                    });
                }
            });

            for (var i = 0; i < sim.players.length; i++) {
                var sim_player = sim.players[i];
                var local_player = players[sim_player.name];

                if (!local_player) {
                    _.forEach(players, function (player) {
                        if (player.army.index === sim_player.army.index) {
                            local_player = player;
                        }
                    });
                }

                if (local_player) {
                    local_player.client = server.clients[i];
                    players[sim_player.name] = local_player;
                    armies[sim_player.army.index].players.push(local_player);
                }
                else
                    console.log('{{ERROR}} could not find player with name: ' + sim_player.name);
            }
        }

        // start with sim paused
        sim.paused = true;
        client_state.control.paused = sim.paused;
        updateControlState();

        if (!loaded_from_sandbox)
            setupDefeatBasedExitCondition();
    }


    if (!loaded_from_replay) {
        commandersDone.promise.then(function () {
            // We need the sim to tick at least once before we do this, so that the commander can spawn.
            simUtils.waitForSeconds(0.05).then(function () {
                // In case the state changed before the promise ran.
                if (!_.isEmpty(cleanup)) {
                    cleanup.push(watchPlayerDisconnects());
                    _.forEach(armies, checkArmySurrender);
                }
            });
        });
    }

    return client_state;
};

exports.exit = function (newState) {
    _.forEachRight(cleanup, function (c) { c(); });
    cleanup = [];
    return true;
};

exports.getClientState = function (client) {

    var player = players[client.id];
    if (!player) { //if there is no player you are a spectator
        return {
            vision_bits: sim.armies.getVisionBits(client),
            game_options: game_options
        };
    }
    var army = player.army;
    return {
        // Was { army_id : army.desc.id }  Not sure if change works in 100% of cases or not...
        army_id: army ? army.id : null,
        vision_bits: sim.armies.getVisionBits(client),
        game_options: game_options,
        commander: player.commander
    };
};
