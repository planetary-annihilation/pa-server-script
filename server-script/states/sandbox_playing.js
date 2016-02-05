var main = require('main');
var server = require('server');
var sim = require('sim');
var utils = require('utils');
var content_manager = require('content_manager');
var _ = require('thirdparty/lodash');

var client_state = {
    armies: []
};

var players = {};
var armies = [];

var cleanup = [];

var playerMsg_writeReplay = function (msg) {
    /* todo: don't save before cmdr lands */

    if (server.clients.length === 1 && msg.payload.name)
        server.writeReplay(msg.payload.name);
};


function spawnUnit(army, spec, planet, position, orientation) {
    var creationCheck = sim.units.length;
    sim.units.push({
        army: army.sim,
        spec: spec,
        planet: planet,
        position: position,
        orientation: orientation
    });
    if (creationCheck !== sim.units.length) {
        return _.last(sim.units);
    }
    else
        console.error("Failed spawning unit", spec);
}

function updateArmyState(transmit) {
    if (transmit) {
        server.broadcast({
            message_type: 'army_state',
            payload: client_state.armies
        });
    }
}

function updateBeacon() {
    server.beacon = {
        uuid: server.uuid(),
        full: false,
        started: false,
        players: server.clients.length,
        creator: null,
        max_players: server.maxClients,
        spectators: 0,
        max_spectators: 0,
        mode: server.clients.length ? 'Sandbox' : 'Waiting',
        mod_names: '',
        cheat_config: main.cheats,
        player_names: [],
        spectator_names: [],
        require_password: false,
        whitelist: [],
        blacklist: [],
        tag: 'Testing',
        game_name: main.serverName,
        game: {
            name: main.serverName
        },
        required_content: content_manager.getRequiredContent(),
        bounty_mode: false,
        bounty_value: 0.5,
        sandbox: false
    };
}

function playerMsg_changeControlFlags(msg) {
    var response = server.respond(msg);
    var flags = msg.payload.control_flags;
    sim.armies.setControlBits(msg.client, flags);
    var armyIndex = flags.indexOf(true);
    players[msg.client.id].army = (armyIndex >= 0) ? armies[armyIndex] : undefined;
    response.succeed();
}

function playerMsg_changeVisionFlags(msg) {
    var response = server.respond(msg);
    var flags = msg.payload.vision_flags;
    sim.armies.setVisionBits(msg.client, flags);
    response.succeed();
}

function playerMsg_createUnit(msg) {
    var response = server.respond(msg);
    var desc = msg.payload;
    var army = _.select(armies, { id : desc.army })[0];
    if (!army)
        return response.fail("Invalid army id");
    var planet = sim.planets[desc.planet];
    var unit = spawnUnit(army, desc.what, planet, desc.location, desc.orientation);
    if (!unit)
        return response.fail("Failed spawning unit");
    response.succeed();
}

function playerMsg_controlSim(msg) {
    var response = server.respond(msg);
    var desc = msg.payload;
    if (desc.hasOwnProperty('paused'))
        sim.paused = desc.paused;
    else if (desc.step) {
        sim.step();
    }
    response.succeed();
}

var playerMsg_writeReplay = function (msg) {
    server.writeReplay(msg.payload.name);
};

exports.url = 'coui://ui/main/game/live_game/live_game.html';
exports.enter = function(config) {
    _.forEach(sim.planets, function (planet) {
        planet.genMetalSpots();
    });

    _.forEach(config.armies, function(army) {
        army = _.clone(army);
        var armyCreateCheck = sim.armies.length;
        sim.armies.push(army);
        if (armyCreateCheck === sim.armies.length) {
            console.error("Failed creating army", JSON.stringify(army));
            return;
        }
        var simArmy = _.last(sim.armies);
        army.id = simArmy.id;
        client_state.armies.push(army);
        armies.push({
            id: simArmy.id,
            sim: simArmy,
            desc: army
        });
    });

    _.forEach(config.units, function(unit) {
            sim.units.push({
                army: sim.armies[unit.army_index],
                spec: unit.spec,
                planet: sim.planets[unit.planet_index],
                position: unit.pos,
                orientation: unit.orient
            });
    });

    sim.initAlliances();

    sim.paused = !!config.paused;

    var removeHandlers = server.setHandlers({
        change_control_flags: playerMsg_changeControlFlags,
        change_vision_flags: playerMsg_changeVisionFlags,
        create_unit: playerMsg_createUnit,
        control_sim: playerMsg_controlSim,
        write_replay: playerMsg_writeReplay
    });
    cleanup.push(removeHandlers);

    function handleNewConnection(client) {
        players[client.id] = {
            client: client,
            army: armies[0]
        };
        sim.armies.setVisionBits(client, true);
        sim.armies.setControlBits(client, armies.length ? [true] : false);
        if (armies.length) {
            sim.players.push({
                army: armies[0].sim,
                client: client
            });
        }
    }

    utils.pushCallback(server, 'onConnect', function(onConnect, client, reconnect) {
        updateBeacon();

        if (!reconnect)
            handleNewConnection(client);
        return onConnect;
    });
    cleanup.push(function() { server.onConnect.pop(); });

    _.forEach(server.clients, handleNewConnection);

    server.maxClients = config.hasOwnProperty('maxClients') ? config.maxClients : 16;
    updateBeacon();

    if (main.time_limit) {
        var timeLimitTimeout = setTimeout(function() {
            delete timeLimitTimeout;
            server.exit();
        }, main.time_limit * 1000);
        cleanup.push(function() {
            clearTimeout(timeLimitTimeout);
        });
    }

    return client_state;
};

exports.exit = function(newState) {
    _.forEachRight(cleanup, function(c) { c(); });
    cleanup = [];
    return true;
};

exports.getClientState = function(client) {
    var player = players[client.id];
    if (!player)
        return;
    var army = player.army;
    return {
        army_id: army ? army.desc.id : undefined
    };
};
